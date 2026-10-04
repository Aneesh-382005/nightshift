import {
  schema, table, t, SenderError,
  type InferSchema, type ReducerCtx,
} from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

// Dev secrets. Change before any real use. Only the warden (human device) and the gate
// (policy process) identities can approve anything. Executors and LLMs hold neither.
const WARDEN_SECRET = 'tally-warden-dev';
const GATE_SECRET = 'tally-gate-dev';
const CAPABILITIES = ['shell.read', 'shell.write', 'shell.destructive', 'screen.view', 'gui.control'];
const AUTO_OK = ['shell.read', 'shell.write'];   // the gate may auto-approve only these
const PENDING_TIMEOUT_US = 120_000_000n;
const DEVICE_STALE_US = 6_000_000n;

const warden = table({ name: 'warden' }, { id: t.u8().primaryKey(), identity: t.identity() });
const gate = table({ name: 'gate' }, { id: t.u8().primaryKey(), identity: t.identity() });

const device = table({ name: 'device', public: true }, {
  id: t.string().primaryKey(),
  name: t.string(),
  kind: t.string(),
  capabilities: t.array(t.string()),
  status: t.string(),              // online | offline
  lastHeartbeatUs: t.u64(),
  identity: t.identity(),
});

const trust = table({ name: 'trust', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  requester: t.string(),
  target: t.string(),
  capability: t.string(),
});

const accessGrant = table({ name: 'access_grant', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  requester: t.string(),
  target: t.string(),
  capability: t.string(),
  reason: t.string(),
  command: t.string(),
  plan: t.string(),                // JSON from the gate: snapshot steps, inverse, health check, timeout
  status: t.string(),              // pending | active | denied | expired | revoked | used
  singleUse: t.bool(),
  ttlSeconds: t.u32(),
  createdAtUs: t.u64(),
  expiresAtUs: t.u64(),
  decidedBy: t.string(),           // trust | gate | warden | ''
});

const event = table({ name: 'event', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  tsUs: t.u64(),
  kind: t.string(),
  device: t.string(),
  grantId: t.u64(),
  detail: t.string(),
});

const change = table({ name: 'change', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  grantId: t.u64(),
  device: t.string(),
  command: t.string(),
  preState: t.string(),
  inverseCommand: t.string(),
  status: t.string(),              // applied | rolled_back | irreversible
  tsUs: t.u64(),
});

const incident = table({ name: 'incident', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  device: t.string(),
  alert: t.string(),
  runbookId: t.string(),
  status: t.string(),              // open | healed | rolled_back | escalated
  attempts: t.u32(),
  tsUs: t.u64(),
});

const runbookTrust = table({ name: 'runbook_trust', public: true }, {
  runbookId: t.string().primaryKey(),
  deviceType: t.string(),
  successes: t.u32(),
  failures: t.u32(),
  level: t.u8(),                   // 2 = ask, 1 = heal alone
  updatedAtUs: t.u64(),
});

// One row per executed grant. Executors run each active grant's command exactly once and write this.
const runResult = table({ name: 'run_result', public: true }, {
  grantId: t.u64().primaryKey(),
  device: t.string(),
  exitCode: t.i32(),
  output: t.string(),              // truncated stdout+stderr
  healthOk: t.bool(),
  rolledBack: t.bool(),
  tsUs: t.u64(),
});

// Requests typed by a human (dashboard or phone). The hub picks them up and launches the harness.
const userRequest = table({ name: 'user_request', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  text: t.string(),
  status: t.string(),              // new | running | done | failed
  result: t.string(),
  tsUs: t.u64(),
});

const expireTick = table({ name: 'expire_tick' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});
const reapTick = table({ name: 'reap_tick' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const spacetimedb = schema({
  warden, gate, device, trust, accessGrant, event, change, incident, runbookTrust, runResult, userRequest, expireTick, reapTick,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const nowUs = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;

function log(ctx: Ctx, kind: string, dev: string, grantId: bigint, detail: string) {
  ctx.db.event.insert({ id: 0n, tsUs: nowUs(ctx), kind, device: dev, grantId, detail });
}
function isWarden(ctx: Ctx) {
  const w = ctx.db.warden.id.find(1);
  return !!w && w.identity.equals(ctx.sender);
}
function isGate(ctx: Ctx) {
  const g = ctx.db.gate.id.find(1);
  return !!g && g.identity.equals(ctx.sender);
}
function isDevice(ctx: Ctx) {
  for (const d of ctx.db.device.iter()) if (d.identity.equals(ctx.sender)) return true;
  return false;
}
function needWarden(ctx: Ctx) { if (!isWarden(ctx)) throw new SenderError('warden only'); }
function needGate(ctx: Ctx) { if (!isGate(ctx)) throw new SenderError('gate only'); }

export const init = spacetimedb.init(ctx => {
  ctx.db.expireTick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(1_000_000n) });
  ctx.db.reapTick.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(2_000_000n) });
});

export const claimWarden = spacetimedb.reducer({ secret: t.string() }, (ctx, { secret }) => {
  if (secret !== WARDEN_SECRET) throw new SenderError('bad secret');
  const w = ctx.db.warden.id.find(1);
  if (w) ctx.db.warden.id.update({ id: 1, identity: ctx.sender });
  else ctx.db.warden.insert({ id: 1, identity: ctx.sender });
  log(ctx, 'warden.claimed', 'warden', 0n, '');
});

export const claimGate = spacetimedb.reducer({ secret: t.string() }, (ctx, { secret }) => {
  if (secret !== GATE_SECRET) throw new SenderError('bad secret');
  const g = ctx.db.gate.id.find(1);
  if (g) ctx.db.gate.id.update({ id: 1, identity: ctx.sender });
  else ctx.db.gate.insert({ id: 1, identity: ctx.sender });
  log(ctx, 'gate.claimed', 'gate', 0n, '');
});

export const registerDevice = spacetimedb.reducer(
  { id: t.string(), name: t.string(), kind: t.string(), capabilities: t.array(t.string()) },
  (ctx, { id, name, kind, capabilities }) => {
    const existing = ctx.db.device.id.find(id);
    if (existing && !existing.identity.equals(ctx.sender) && !isGate(ctx)) {
      throw new SenderError('device id owned by another identity');
    }
    const row = { id, name, kind, capabilities, status: 'online', lastHeartbeatUs: nowUs(ctx), identity: ctx.sender };
    if (existing) ctx.db.device.id.update(row);
    else ctx.db.device.insert(row);
    log(ctx, 'device.online', id, 0n, kind);
  }
);

export const heartbeat = spacetimedb.reducer({ id: t.string() }, (ctx, { id }) => {
  const d = ctx.db.device.id.find(id);
  if (!d) throw new SenderError('unknown device');
  if (!d.identity.equals(ctx.sender)) throw new SenderError('not your device');
  const wasOffline = d.status !== 'online';
  ctx.db.device.id.update({ ...d, status: 'online', lastHeartbeatUs: nowUs(ctx) });
  if (wasOffline) log(ctx, 'device.online', id, 0n, 'heartbeat');
});

export const addTrust = spacetimedb.reducer(
  { requester: t.string(), target: t.string(), capability: t.string() },
  (ctx, { requester, target, capability }) => {
    needGate(ctx);
    if (!CAPABILITIES.includes(capability)) throw new SenderError('unknown capability');
    ctx.db.trust.insert({ id: 0n, requester, target, capability });
  }
);

// Gate only. The MCP gateway classifies the command from policy files, then calls this.
// autoApprove is honoured only for shell.read and shell.write. Destructive, screen and gui
// grants always wait for the warden.
export const requestGrant = spacetimedb.reducer(
  {
    requester: t.string(), target: t.string(), capability: t.string(), reason: t.string(),
    command: t.string(), plan: t.string(), ttlSeconds: t.u32(), autoApprove: t.bool(),
  },
  (ctx, a) => {
    needGate(ctx);
    if (!CAPABILITIES.includes(a.capability)) throw new SenderError('unknown capability');
    if (!ctx.db.device.id.find(a.target)) throw new SenderError('unknown target device');
    const now = nowUs(ctx);
    let trusted = false;
    if (a.capability === 'shell.read') {
      for (const tr of ctx.db.trust.iter()) {
        if (tr.requester === a.requester && tr.target === a.target && tr.capability === a.capability) trusted = true;
      }
    }
    const auto = (a.autoApprove && AUTO_OK.includes(a.capability)) || trusted;
    const row = ctx.db.accessGrant.insert({
      id: 0n, requester: a.requester, target: a.target, capability: a.capability, reason: a.reason,
      command: a.command, plan: a.plan, status: auto ? 'active' : 'pending',
      singleUse: a.capability !== 'shell.read', ttlSeconds: a.ttlSeconds,
      createdAtUs: now, expiresAtUs: auto ? now + BigInt(a.ttlSeconds) * 1_000_000n : 0n,
      decidedBy: auto ? (trusted ? 'trust' : 'gate') : '',
    });
    log(ctx, 'grant.requested', a.target, row.id, `${a.capability}: ${a.command || a.reason}`);
    if (auto) log(ctx, 'grant.approved', a.target, row.id, trusted ? 'trust' : 'gate policy');
  }
);

// Gate only: deny something policy forbids (hostile text, forbidden pattern).
export const gateDeny = spacetimedb.reducer({ grantId: t.u64(), reason: t.string() }, (ctx, { grantId, reason }) => {
  needGate(ctx);
  const g = ctx.db.accessGrant.id.find(grantId);
  if (!g || g.status !== 'pending') throw new SenderError('grant not pending');
  ctx.db.accessGrant.id.update({ ...g, status: 'denied', decidedBy: 'gate' });
  log(ctx, 'grant.denied', g.target, grantId, `policy: ${reason}`);
});

// Warden only. This is the physical press.
export const decideGrant = spacetimedb.reducer(
  { grantId: t.u64(), approve: t.bool(), ttlSeconds: t.u32() },
  (ctx, { grantId, approve, ttlSeconds }) => {
    needWarden(ctx);
    const g = ctx.db.accessGrant.id.find(grantId);
    if (!g || g.status !== 'pending') throw new SenderError('grant not pending');
    const now = nowUs(ctx);
    if (approve) {
      const ttl = ttlSeconds > 0 ? ttlSeconds : g.ttlSeconds;
      ctx.db.accessGrant.id.update({
        ...g, status: 'active', ttlSeconds: ttl, expiresAtUs: now + BigInt(ttl) * 1_000_000n, decidedBy: 'warden',
      });
      log(ctx, 'grant.approved', g.target, grantId, `warden, ${ttl}s`);
    } else {
      ctx.db.accessGrant.id.update({ ...g, status: 'denied', decidedBy: 'warden' });
      log(ctx, 'grant.denied', g.target, grantId, 'warden');
    }
  }
);

// Warden only: the kill switch.
export const revokeAll = spacetimedb.reducer(ctx => {
  needWarden(ctx);
  let n = 0;
  for (const g of [...ctx.db.accessGrant.iter()]) {
    if (g.status === 'active' || g.status === 'pending') {
      ctx.db.accessGrant.id.update({ ...g, status: 'revoked' });
      log(ctx, 'grant.revoked', g.target, g.id, 'kill switch');
      n++;
    }
  }
  log(ctx, 'killswitch', 'warden', 0n, `${n} grants revoked`);
});

// An executor calls this right before it runs a command. It only succeeds for the target
// device's own identity and an active, unexpired grant.
export const consumeGrant = spacetimedb.reducer({ grantId: t.u64() }, (ctx, { grantId }) => {
  const g = ctx.db.accessGrant.id.find(grantId);
  if (!g) throw new SenderError('no such grant');
  const d = ctx.db.device.id.find(g.target);
  if (!d || !d.identity.equals(ctx.sender)) throw new SenderError('not the target device');
  if (g.status !== 'active' || g.expiresAtUs <= nowUs(ctx)) throw new SenderError('grant not active');
  if (g.singleUse) ctx.db.accessGrant.id.update({ ...g, status: 'used' });
  log(ctx, 'grant.used', g.target, grantId, g.command);
});

export const logEvent = spacetimedb.reducer(
  { kind: t.string(), device: t.string(), grantId: t.u64(), detail: t.string() },
  (ctx, a) => {
    if (!isGate(ctx) && !isWarden(ctx) && !isDevice(ctx)) throw new SenderError('not allowed');
    log(ctx, a.kind, a.device, a.grantId, a.detail);
  }
);

export const recordChange = spacetimedb.reducer(
  { grantId: t.u64(), device: t.string(), command: t.string(), preState: t.string(), inverseCommand: t.string(), irreversible: t.bool() },
  (ctx, a) => {
    if (!isGate(ctx) && !isDevice(ctx)) throw new SenderError('not allowed');
    const row = ctx.db.change.insert({
      id: 0n, grantId: a.grantId, device: a.device, command: a.command, preState: a.preState,
      inverseCommand: a.inverseCommand, status: a.irreversible ? 'irreversible' : 'applied', tsUs: nowUs(ctx),
    });
    log(ctx, 'change.recorded', a.device, a.grantId, `#${row.id} ${a.command}`);
  }
);

export const markChange = spacetimedb.reducer({ changeId: t.u64(), status: t.string() }, (ctx, { changeId, status }) => {
  if (!isGate(ctx) && !isWarden(ctx) && !isDevice(ctx)) throw new SenderError('not allowed');
  const c = ctx.db.change.id.find(changeId);
  if (!c) throw new SenderError('no such change');
  ctx.db.change.id.update({ ...c, status });
  if (status === 'rolled_back') log(ctx, 'change.rolled_back', c.device, c.grantId, `#${changeId}`);
});

export const openIncident = spacetimedb.reducer(
  { device: t.string(), alert: t.string(), runbookId: t.string() },
  (ctx, a) => {
    needGate(ctx);
    const row = ctx.db.incident.insert({ id: 0n, device: a.device, alert: a.alert, runbookId: a.runbookId, status: 'open', attempts: 0, tsUs: nowUs(ctx) });
    log(ctx, 'incident.opened', a.device, 0n, `#${row.id} ${a.alert}`);
  }
);

export const updateIncident = spacetimedb.reducer(
  { id: t.u64(), status: t.string(), attempts: t.u32() },
  (ctx, a) => {
    needGate(ctx);
    const i = ctx.db.incident.id.find(a.id);
    if (!i) throw new SenderError('no such incident');
    ctx.db.incident.id.update({ ...i, status: a.status, attempts: a.attempts });
    if (a.status === 'escalated') log(ctx, 'incident.escalated', i.device, 0n, `#${a.id}`);
  }
);

// Gate only: earned trust. After `threshold` verified successes a fix moves from ask to alone.
export const recordFixResult = spacetimedb.reducer(
  { runbookId: t.string(), deviceType: t.string(), success: t.bool(), threshold: t.u32() },
  (ctx, a) => {
    needGate(ctx);
    const now = nowUs(ctx);
    const r = ctx.db.runbookTrust.runbookId.find(a.runbookId)
      ?? ctx.db.runbookTrust.insert({ runbookId: a.runbookId, deviceType: a.deviceType, successes: 0, failures: 0, level: 2, updatedAtUs: now });
    const successes = r.successes + (a.success ? 1 : 0);
    const failures = r.failures + (a.success ? 0 : 1);
    let level = r.level;
    if (!a.success) level = 2;
    else if (successes >= a.threshold && level === 2) {
      level = 1;
      log(ctx, 'trust.promoted', a.deviceType, 0n, a.runbookId);
    }
    ctx.db.runbookTrust.runbookId.update({ ...r, successes, failures, level, updatedAtUs: now });
  }
);

// Executor (target device) or gate records the outcome of a grant's command.
export const recordResult = spacetimedb.reducer(
  { grantId: t.u64(), device: t.string(), exitCode: t.i32(), output: t.string(), healthOk: t.bool(), rolledBack: t.bool() },
  (ctx, a) => {
    if (!isGate(ctx) && !isDevice(ctx)) throw new SenderError('not allowed');
    const row = { grantId: a.grantId, device: a.device, exitCode: a.exitCode, output: a.output.slice(0, 4000), healthOk: a.healthOk, rolledBack: a.rolledBack, tsUs: nowUs(ctx) };
    if (ctx.db.runResult.grantId.find(a.grantId)) ctx.db.runResult.grantId.update(row);
    else ctx.db.runResult.insert(row);
    log(ctx, a.healthOk ? 'health.passed' : 'health.failed', a.device, a.grantId, `exit ${a.exitCode}`);
  }
);

// Warden only (the undo button). The target's executor sees the event and runs the inverse command.
export const requestRollback = spacetimedb.reducer({ changeId: t.u64() }, (ctx, { changeId }) => {
  needWarden(ctx);
  const c = ctx.db.change.id.find(changeId);
  if (!c) throw new SenderError('no such change');
  if (c.status !== 'applied') throw new SenderError('change is not reversible or already rolled back');
  log(ctx, 'rollback.requested', c.device, c.grantId, String(changeId));
});

// Anyone may type a request. The gate (hub) updates its status.
export const submitRequest = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  if (text.trim().length === 0 || text.length > 2000) throw new SenderError('bad request text');
  const row = ctx.db.userRequest.insert({ id: 0n, text, status: 'new', result: '', tsUs: nowUs(ctx) });
  log(ctx, 'request.submitted', 'user', 0n, `#${row.id} ${text.slice(0, 80)}`);
});

export const updateRequest = spacetimedb.reducer(
  { id: t.u64(), status: t.string(), result: t.string() },
  (ctx, a) => {
    needGate(ctx);
    const r = ctx.db.userRequest.id.find(a.id);
    if (!r) throw new SenderError('no such request');
    ctx.db.userRequest.id.update({ ...r, status: a.status, result: a.result.slice(0, 4000) });
  }
);

export const expireGrants = spacetimedb.reducer(
  { onSchedule: expireTick },
  { timer: expireTick.rowType },
  ctx => {
    const now = nowUs(ctx);
    for (const g of [...ctx.db.accessGrant.iter()]) {
      if (g.status === 'active' && g.expiresAtUs <= now) {
        ctx.db.accessGrant.id.update({ ...g, status: 'expired' });
        log(ctx, 'grant.expired', g.target, g.id, g.capability);
      } else if (g.status === 'pending' && g.createdAtUs + PENDING_TIMEOUT_US <= now) {
        ctx.db.accessGrant.id.update({ ...g, status: 'expired' });
        log(ctx, 'grant.expired', g.target, g.id, 'no decision');
      }
    }
  }
);

export const reapDevices = spacetimedb.reducer(
  { onSchedule: reapTick },
  { timer: reapTick.rowType },
  ctx => {
    const now = nowUs(ctx);
    for (const d of [...ctx.db.device.iter()]) {
      if (d.status === 'online' && d.lastHeartbeatUs + DEVICE_STALE_US < now) {
        ctx.db.device.id.update({ ...d, status: 'offline' });
        log(ctx, 'device.offline', d.id, 0n, 'heartbeat timeout');
      }
    }
  }
);
