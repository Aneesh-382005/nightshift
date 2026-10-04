// The gate: classify from policy, request grants, wait for results, keep the trust and incident books.
import { randomUUID } from 'node:crypto';
import { classify, capabilityFor, deviceTypeFor, type Fix, type Verdict } from './policy.js';
import { until, nowUs, sleep, type Conn } from './hub.js';

export const PROMOTE_AFTER = 3;
export const BREAKER_FAILS = 2;
export const BREAKER_PER_HOUR = 6;
const WAIT_MS = Number(process.env.NS_WAIT_MS ?? 45_000);
const HOUR_US = 3_600_000_000n;

export interface RunResult {
  status: 'done' | 'pending' | 'denied' | 'error';
  grantId?: number;
  class?: string;
  exitCode?: number;
  output?: string;
  healthOk?: boolean;
  rolledBack?: boolean;
  escalated?: boolean;
  reason?: string;
}

const ACTIVE_INCIDENT = ['open', 'rolled_back', 'escalated'];

export class Gateway {
  private grantLock: Promise<unknown> = Promise.resolve();
  private accounted = new Set<bigint>();
  constructor(readonly conn: Conn) {}

  private get db() { return this.conn.db; }

  // ---- queries on the local cache
  device(id: string) { return this.db.device.id.find(id) ?? undefined; }
  grant(id: bigint) { return this.db.accessGrant.id.find(id) ?? undefined; }
  result(id: bigint) { return this.db.runResult.grantId.find(id) ?? undefined; }
  listDevices() {
    return [...this.db.device.iter()].map(d => ({
      id: d.id, name: d.name, kind: d.kind, capabilities: d.capabilities, status: d.status,
      deviceType: deviceTypeFor(d.id, d.kind),
    }));
  }
  private activeIncident(device: string) {
    let best: ReturnType<typeof this.db.incident.iter> extends Iterable<infer R> ? R | undefined : never;
    for (const i of this.db.incident.iter()) {
      if (i.device === device && ACTIVE_INCIDENT.includes(i.status) && (!best || i.id > best.id)) best = i;
    }
    return best;
  }

  // ---- circuit breaker
  private breaker(device: string): string | undefined {
    const inc = this.activeIncident(device);
    if (inc && (inc.status === 'escalated' || inc.attempts >= BREAKER_FAILS)) return `${inc.attempts} failed fixes on ${device}`;
    const since = nowUs() - HOUR_US;
    let n = 0;
    for (const e of this.db.event.iter()) if (e.kind === 'fix.autonomous' && e.device === device && e.tsUs >= since) n++;
    if (n >= BREAKER_PER_HOUR) return `${n} autonomous actions in the last hour on ${device}`;
    return undefined;
  }

  // ---- grants
  // Serialised so the new grant id can be read back unambiguously.
  private async createGrant(a: {
    requester: string; target: string; capability: string; reason: string; command: string;
    plan: object; ttlSeconds: number; autoApprove: boolean;
  }): Promise<bigint> {
    const run = async () => {
      let max = 0n;
      for (const g of this.db.accessGrant.iter()) if (g.id > max) max = g.id;
      await this.conn.reducers.requestGrant({ ...a, plan: JSON.stringify(a.plan) });
      const row = await until(() => {
        for (const g of this.db.accessGrant.iter()) {
          if (g.id > max && g.requester === a.requester && g.target === a.target && g.command === a.command) return g;
        }
        return undefined;
      }, 5000, 50);
      if (!row) throw new Error('grant was created but not visible yet');
      return row.id;
    };
    const p = this.grantLock.then(run, run);
    this.grantLock = p.catch(() => undefined);
    return p;
  }

  async runCommand(a: { device: string; command: string; reason: string; requester?: string }): Promise<RunResult> {
    const requester = a.requester ?? 'agent';
    const dev = this.device(a.device);
    if (!dev) return { status: 'error', reason: `unknown device ${a.device}. Known: ${this.listDevices().map(d => d.id).join(', ') || 'none'}` };
    if (dev.status !== 'online') return { status: 'error', reason: `device ${a.device} is offline` };
    const deviceType = deviceTypeFor(dev.id, dev.kind);
    const reason = (a.reason || 'no reason given').slice(0, 300);
    const v: Verdict = classify(a.command, deviceType);

    if (v.cls === 'forbidden') {
      const id = await this.createGrant({
        requester, target: dev.id, capability: 'shell.destructive', reason, command: a.command.slice(0, 2000),
        plan: { deviceType }, ttlSeconds: 30, autoApprove: false,
      });
      await this.conn.reducers.gateDeny({ grantId: id, reason: v.reason });
      await this.conn.reducers.logEvent({ kind: 'policy.blocked', device: dev.id, grantId: id, detail: v.reason.slice(0, 200) });
      return { status: 'denied', grantId: Number(id), class: 'forbidden', reason: `blocked by policy: ${v.reason}` };
    }

    let command = a.command.trim();
    let capability = capabilityFor(v.cls);
    let autoApprove = v.cls === 'read';
    let ttl = v.cls === 'read' ? 120 : 120;
    let escalated = false;
    let plan: Record<string, unknown> = { timeoutS: 30, deviceType };
    let grantReason = reason;

    if (v.cls === 'read') plan = { timeoutS: 15, deviceType };

    if (v.cls === 'autonomous' && v.fix) {
      const fix: Fix = v.fix;
      command = fix.command; // the gate runs the policy command, never the agent's text
      capability = fix.capability;
      ttl = 60;
      plan = {
        snapshots: fix.snapshots, inverse: fix.inverse, health: fix.health, timeoutS: fix.timeoutS,
        runbookId: fix.id, deviceType,
      };
      const trust = this.db.runbookTrust.runbookId.find(fix.id);
      const level = trust ? trust.level : 2;
      const tripped = this.breaker(dev.id);
      if (tripped) {
        escalated = true;
        grantReason = `ESCALATED (${tripped}): ${reason}`;
        const inc = this.activeIncident(dev.id);
        if (inc && inc.status !== 'escalated') await this.conn.reducers.updateIncident({ id: inc.id, status: 'escalated', attempts: inc.attempts });
      } else if (level === 1) {
        autoApprove = true;
      }
    }

    const grantId = await this.createGrant({
      requester, target: dev.id, capability, reason: grantReason, command, plan, ttlSeconds: ttl, autoApprove,
    });
    if (v.cls === 'autonomous' && autoApprove) {
      await this.conn.reducers.logEvent({ kind: 'fix.autonomous', device: dev.id, grantId, detail: String(plan.runbookId) });
    }
    const out = await this.waitResult(grantId, WAIT_MS);
    out.class = v.cls;
    if (escalated) out.escalated = true;
    return out;
  }

  async getResult(grantId: bigint, waitMs = WAIT_MS): Promise<RunResult> {
    if (!this.grant(grantId)) return { status: 'error', reason: `no grant ${grantId}` };
    return this.waitResult(grantId, waitMs);
  }

  private async waitResult(grantId: bigint, waitMs: number): Promise<RunResult> {
    const settled = await until(() => {
      const r = this.result(grantId);
      if (r) return 'result' as const;
      const g = this.grant(grantId);
      if (g && ['denied', 'expired', 'revoked'].includes(g.status)) return 'ended' as const;
      return undefined;
    }, waitMs);
    const g = this.grant(grantId);
    const id = Number(grantId);
    if (settled === 'result') {
      const r = this.result(grantId)!;
      await this.account(grantId).catch(e => console.error('accounting failed', e));
      return { status: 'done', grantId: id, exitCode: r.exitCode, output: r.output, healthOk: r.healthOk, rolledBack: r.rolledBack };
    }
    if (settled === 'ended' && g) {
      const why = g.status === 'expired' ? 'expired with no decision' : g.status === 'revoked' ? 'revoked' : g.decidedBy === 'gate' ? 'blocked by policy' : 'denied by the human';
      return { status: 'denied', grantId: id, reason: why };
    }
    return { status: 'pending', grantId: id, reason: 'waiting for a human press or for the executor; call get_result later' };
  }

  // ---- books: runbook trust and incident status, exactly once per grant even across processes
  private async claimAccounting(grantId: bigint, device: string): Promise<boolean> {
    if (this.accounted.has(grantId)) return false;
    this.accounted.add(grantId);
    const claimed = () => [...this.db.event.iter()].filter(e => e.kind === 'fix.accounted' && e.grantId === grantId);
    if (claimed().length > 0) return false;
    const nonce = randomUUID();
    await this.conn.reducers.logEvent({ kind: 'fix.accounted', device, grantId, detail: nonce });
    const mine = await until(() => claimed().find(e => e.detail === nonce), 3000, 50);
    if (!mine) return false;
    const first = claimed().reduce((a, b) => (b.id < a.id ? b : a));
    return first.detail === nonce;
  }

  async account(grantId: bigint): Promise<void> {
    const g = this.grant(grantId);
    const r = this.result(grantId);
    if (!g || !r) return;
    let plan: any = {};
    try { plan = JSON.parse(g.plan || '{}'); } catch { /* not a fix */ }
    if (!plan.runbookId) return;
    if (g.requester !== 'agent' && g.requester !== 'cli') return; // only grants the gate itself issued
    if (!(await this.claimAccounting(grantId, g.target))) return;
    const success = r.exitCode === 0 && r.healthOk;
    await this.conn.reducers.recordFixResult({ runbookId: plan.runbookId, deviceType: plan.deviceType ?? 'unknown', success, threshold: PROMOTE_AFTER });
    const inc = this.activeIncident(g.target);
    if (!inc) return;
    if (success) {
      await this.conn.reducers.updateIncident({ id: inc.id, status: 'healed', attempts: inc.attempts });
    } else {
      const attempts = inc.attempts + 1;
      const status = attempts >= BREAKER_FAILS ? 'escalated' : r.rolledBack ? 'rolled_back' : 'open';
      await this.conn.reducers.updateIncident({ id: inc.id, status, attempts });
    }
  }

  // Sweep for finished fixes nobody accounted for (the process that asked has exited).
  async sweep(minAgeUs = 5_000_000n): Promise<void> {
    const now = nowUs();
    for (const r of [...this.db.runResult.iter()]) {
      if (now - r.tsUs < minAgeUs) continue;
      await this.account(r.grantId).catch(() => undefined);
      await sleep(0);
    }
  }
}
