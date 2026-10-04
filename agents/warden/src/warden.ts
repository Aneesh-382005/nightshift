// Warden: the human's physical approval point. Connects to SpacetimeDB as the warden identity,
// drives the FREE-WILi (via bridge.py) and turns button presses into decideGrant / revokeAll /
// requestRollback. Run: npx tsx src/warden.ts [--backend sim|legacy|onewili]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../common/src/module_bindings/index.js';
import crypto from 'node:crypto';
import { startHttp } from './http.js';
import { Bridge, type Backend, type ButtonName, type LedMode } from './bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.resolve(here, '../.stdb-token');
const WARDEN_SECRET = 'tally-warden-dev';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const URI = arg('uri', 'ws://127.0.0.1:3000');
const DB = arg('db', 'nightshift');
const BACKEND = arg('backend', 'sim') as Backend;
const BRIDGE_ARGS = ['sound', 'leds-brightness', 'buttons', 'shake', 'shake-threshold'].flatMap(k => (process.argv.includes(`--${k}`) ? [`--${k}`, arg(k, '')] : []));
const HTTP_PORT = Number(arg('http-port', '0'));   // 0 = phone page off
const HTTP_HOST = arg('http-host', '127.0.0.1');  // use 0.0.0.0 for a phone on the same network

const COLS = 24;                 // display text width the wrapper targets
const MAX_CMD_LINES = 8;         // longer commands cannot be approved on the device
const APPROVE_LONG_S = 120;
const APPROVE_SHORT_S = 30;
const HOLD_CONFIRM_MS = 5000;
const EXPIRING_S = 15;
const PENDING_TIMEOUT_S = 120;   // mirrors the module
const HOLD_CAPS = new Set(['shell.destructive', 'gui.control']);

const nowUs = () => BigInt(Date.now()) * 1000n;
const secs = (us: bigint) => Number(us) / 1e6;

// ---------- view model ----------
type Rgb = [number, number, number];
interface View { lines: string[]; led: Rgb; mode: LedMode; dim?: boolean }
interface Overlay { view: View; untilMs: number }

const GREEN: Rgb = [0, 200, 0], DIM_GREEN: Rgb = [0, 40, 0], AMBER: Rgb = [255, 140, 0], RED: Rgb = [255, 0, 0];

function wrap(s: string, cols = COLS): string[] {
  const out: string[] = [];
  for (const raw of s.split('\n')) {
    let line = raw;
    if (line.length === 0) { out.push(''); continue; }
    while (line.length > cols) { out.push(line.slice(0, cols)); line = line.slice(cols); }
    out.push(line);
  }
  return out;
}
const clip = (s: string, n = COLS) => (s.length > n ? s.slice(0, n - 1) + '~' : s);

// ---------- state ----------
let overlay: Overlay | undefined;
let armed: { grantId: bigint; button: ButtonName; untilMs: number } | undefined;
let lastSig = '';
let lastLedRefresh = 0;
let applied = false;
const seenPending = new Set<bigint>();
let lastTone = 0;
let bridge: Bridge;
let conn: DbConnection;

function show(lines: string[], led: Rgb, mode: LedMode, ms: number) {
  overlay = { view: { lines, led, mode }, untilMs: Date.now() + ms };
}
function tone(hz: number, ms = 200, amp = 0.3) { if (bridge?.ready) bridge.tone(hz, ms, amp); }

function pendingGrants() {
  return [...conn.db.accessGrant.iter()].filter(g => g.status === 'pending')
    .sort((a, b) => (a.createdAtUs < b.createdAtUs ? -1 : 1));
}
function activeApproved() {
  return [...conn.db.accessGrant.iter()].filter(g => g.status === 'active' && g.decidedBy === 'warden')
    .sort((a, b) => (a.expiresAtUs < b.expiresAtUs ? -1 : 1));
}
function latestApplied() {
  const cs = [...conn.db.change.iter()].filter(c => c.status === 'applied');
  cs.sort((a, b) => (a.id < b.id ? 1 : -1));
  return cs[0];
}
function lastEvents(n: number) {
  const es = [...conn.db.event.iter()];
  es.sort((a, b) => (a.id < b.id ? 1 : -1));
  return es.slice(0, n);
}

/** Pure render: what the Lantern shows right now. Priority: pending > overlay > active > idle. */
function computeView(): View {
  const now = nowUs();
  const pend = pendingGrants();
  if (pend.length) {
    const g = pend[0];
    const left = Math.max(0, Math.ceil(PENDING_TIMEOUT_S - secs(now - g.createdAtUs)));
    const cmdLines = wrap(`$ ${g.command || g.reason}`);
    const long = cmdLines.length > MAX_CMD_LINES;
    const lines = [
      HOLD_CAPS.has(g.capability) ? 'HOLD' : 'APPROVE',
      `${g.target} ${left}s`,
      g.capability + (HOLD_CAPS.has(g.capability) ? ' (HOLD)' : ''),
      ...cmdLines.slice(0, MAX_CMD_LINES),
    ];
    if (long) lines.push('TOO LONG: red denies');
    else if (armed && armed.grantId === g.id && armed.untilMs > Date.now()) lines.push('PRESS AGAIN TO CONFIRM');
    else lines.push(HOLD_CAPS.has(g.capability) ? 'g/b twice: approve' : 'green 120s  blue 30s');
    if (pend.length > 1) lines.push(`+${pend.length - 1} more waiting`);
    if (armed && armed.grantId === g.id && armed.untilMs > Date.now()) lines[0] = 'CONFIRM';
    return { lines, led: AMBER, mode: 'pulse' };
  }
  if (overlay && overlay.untilMs > Date.now()) return overlay.view;
  const act = activeApproved()[0];
  if (act) {
    const left = Math.max(0, Math.ceil(secs(act.expiresAtUs - now)));
    const expiring = left <= EXPIRING_S;
    return {
      lines: ['ACTIVE', act.target, clip(act.capability), ...wrap(`$ ${act.command}`).slice(0, 4), `${left}s left  red=revoke`],
      led: expiring ? RED : AMBER, mode: expiring ? 'blink' : 'solid',
    };
  }
  return { lines: ['IDLE', 'Nightshift idle'], led: DIM_GREEN, mode: 'solid', dim: true };
}

function setLeds(v: View) {
  if (v.dim) {   // idle: one dim LED, the rest off
    bridge.led(0, 0, 0, 'solid', 'all');
    bridge.led(v.led[0], v.led[1], v.led[2], v.mode, [0]);
  } else bridge.led(v.led[0], v.led[1], v.led[2], v.mode, 'all');
}

function render(force = false) {
  const v = computeView();
  // countdown lines change every second; signature includes them so the display refreshes
  const sig = JSON.stringify([v.lines, v.led, v.mode]);
  if (sig !== lastSig || force) {
    lastSig = sig;
    console.log(`[warden] ${v.lines.join(' | ')}  led=${v.led.join(',')} ${v.mode}`);
    if (bridge?.ready) {
      bridge.text(v.lines.join('\n'));
      setLeds(v);
      lastLedRefresh = Date.now();
    }
  } else if (bridge?.ready && Date.now() - lastLedRefresh > 2000) {
    // LED duration semantics on OneWili are unverified, so keep re-asserting the state
    setLeds(v);
    lastLedRefresh = Date.now();
  }
}

// ---------- events -> overlays and sounds ----------
function onEvent(e: { kind: string; device: string; detail: string; grantId: bigint }) {
  switch (e.kind) {
    case 'grant.denied':
      if (e.detail.startsWith('policy')) {
        show(['BLOCKED', 'policy', e.device, ...wrap(e.detail.replace(/^policy:\s*/, ''))], RED, 'solid', 4000);
        tone(180, 500);
      } else if (e.detail === 'warden') {
        show(['DENIED'], RED, 'blink', 2000);
        tone(220, 300);
      } else {
        show(['DENIED', ...wrap(e.detail)], RED, 'blink', 2000);
        tone(220, 300);
      }
      break;
    case 'killswitch':
      show(['REVOKED', e.detail], RED, 'blink', 2000);
      tone(180, 400);
      break;
    case 'fix.autonomous':
      show(['AUTOFIX', e.device, ...wrap(e.detail).slice(0, 3)], AMBER, 'solid', 1500);
      tone(1200, 40, 0.2);
      break;
    case 'health.passed':
      show(['HEALTHY', e.device], GREEN, 'solid', 3000);
      tone(1320, 120, 0.25);
      break;
    case 'health.failed':
      show(['FAILED', e.device, 'rolling back'], RED, 'blink', 4000);
      tone(200, 400);
      break;
    case 'change.rolled_back':
      show(['ROLLBACK', e.device, e.detail], GREEN, 'solid', 3000);
      tone(660, 150);
      break;
    case 'trust.promoted':
      show(['TRUSTED', e.detail, 'now heals alone'], GREEN, 'solid', 4000);
      tone(990, 120); setTimeout(() => tone(1320, 160), 160);
      break;
    case 'incident.escalated':
      show(['ESCALATE', e.device, 'human needed'], AMBER, 'pulse', 8000);
      tone(880, 250);
      break;
  }
  render();
}

function onNewPending() {
  for (const g of pendingGrants()) {
    if (!seenPending.has(g.id)) {
      seenPending.add(g.id);
      if (Date.now() - lastTone > 300) { tone(880, 180); setTimeout(() => tone(1175, 220), 220); lastTone = Date.now(); }
    }
  }
}

// ---------- buttons ----------
async function call(label: string, p: Promise<unknown>) {
  try { await p; } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error(`[warden] ${label} failed: ${msg}`);
    show(['ERROR', label, ...wrap(msg).slice(0, 3)], RED, 'solid', 3000);
    tone(160, 400);
    render();
  }
}

function approve(ttl: number, button: ButtonName) {
  const g = pendingGrants()[0];
  if (!g) { show(['NONE', 'Nothing to approve'], DIM_GREEN, 'solid', 1200); render(); return; }
  if (wrap(`$ ${g.command || g.reason}`).length > MAX_CMD_LINES) { tone(160, 300); render(); return; }  // cannot show it all
  if (HOLD_CAPS.has(g.capability)) {
    // Buttons give no hold duration, so "press and hold" is a deliberate second press of the same button.
    if (!armed || armed.grantId !== g.id || armed.button !== button || armed.untilMs < Date.now()) {
      armed = { grantId: g.id, button, untilMs: Date.now() + HOLD_CONFIRM_MS };
      tone(660, 100); render();
      return;
    }
    armed = undefined;
  }
  tone(1320, 80, 0.2);
  void call('approve', conn.reducers.decideGrant({ grantId: g.id, approve: true, ttlSeconds: ttl }));
}

function onButton(name: ButtonName) {
  if (!applied) return;
  console.log(`[warden] button ${name}`);
  switch (name) {
    case 'green': approve(APPROVE_LONG_S, 'green'); break;
    case 'blue': approve(APPROVE_SHORT_S, 'blue'); break;
    case 'red': {
      armed = undefined;
      const g = pendingGrants()[0];
      if (g) void call('deny', conn.reducers.decideGrant({ grantId: g.id, approve: false, ttlSeconds: 0 }));
      else void call('revoke all', conn.reducers.revokeAll({}));
      break;
    }
    case 'gray': {
      const c = latestApplied();
      if (!c) { show(['NONE', 'Nothing to undo'], DIM_GREEN, 'solid', 1500); render(); break; }
      show(['UNDO', '#' + c.id, c.device, ...wrap(c.command).slice(0, 3)], AMBER, 'pulse', 3000);
      tone(520, 150);
      void call('rollback', conn.reducers.requestRollback({ changeId: c.id }));
      break;
    }
    case 'yellow':
      show(['AUDIT', 'last 5', ...lastEvents(5).map(e => clip(`${e.kind} ${e.device}`))], GREEN, 'solid', 8000);
      break;
  }
  render();
}

/** Double shake = the kill switch: revoke every active and pending grant (distinct from red, which denies a pending grant). */
function onShake() {
  if (!applied) return;
  console.log('[warden] double shake: revoke all');
  armed = undefined;
  show(['REVOKED', 'double shake'], RED, 'solid', 3000);
  tone(180, 400);
  void call('revoke all', conn.reducers.revokeAll({}));
  render();
}

// ---------- keyboard (always on: the sim input, and a fallback if the Lantern is unplugged) ----------
const KEYS: Record<string, ButtonName> = {
  g: 'green', b: 'blue', r: 'red', w: 'gray', y: 'yellow',
  '1': 'gray', '2': 'yellow', '3': 'green', '4': 'blue', '5': 'red',
};
function setupKeys() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (s: string) => {
    for (const ch of s) {
      if (ch === '\x03' || ch === 'q') shutdown(0);
      if (ch === 'x') { onShake(); continue; }   // simulated double shake
      const b = KEYS[ch];
      if (b) onButton(b);
    }
  });
  process.stdin.resume();
  console.log('[warden] keyboard: g/3=green b/4=blue r/5=red w/1=undo y/2=audit q=quit');
}

// ---------- bridge ----------
async function startBridge() {
  bridge = new Bridge(BACKEND, BRIDGE_ARGS);
  try { await bridge.start(); }
  catch (e) {
    console.error(`[warden] bridge ${BACKEND} failed: ${(e as Error).message}`);
    bridge.kill();
    if (BACKEND !== 'sim') {
      console.error('[warden] falling back to sim bridge. The keyboard is the Lantern now.');
      bridge = new Bridge('sim', BRIDGE_ARGS);
      await bridge.start();
    }
  }
  bridge.on('button', onButton);
  bridge.on('shake', onShake);
  bridge.on('exit', () => console.error('[warden] bridge exited, console only'));
}

function shutdown(code: number) {
  try { bridge?.kill(); } catch { /* ignore */ }
  try { conn?.disconnect(); } catch { /* ignore */ }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ---------- main ----------
await startBridge();

conn = await new Promise<DbConnection>((resolve, reject) => {
  const saved = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : undefined;
  DbConnection.builder()
    .withUri(URI)
    .withDatabaseName(DB)
    .withToken(saved)
    .onConnect((c, identity, token) => {
      fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
      console.log(`[warden] connected as ${identity.toHexString().slice(0, 12)}...`);
      resolve(c);
    })
    .onConnectError((_c, err) => reject(new Error(`connect: ${err}`)))
    .onDisconnect(() => { console.error('[warden] disconnected from SpacetimeDB'); shutdown(1); })
    .build();
});

await conn.reducers.claimWarden({ secret: WARDEN_SECRET });
console.log('[warden] warden identity claimed');

conn.db.event.onInsert((_ctx, e) => { if (applied) onEvent(e); });
conn.db.accessGrant.onInsert(() => { if (applied) { onNewPending(); render(); } });
conn.db.accessGrant.onUpdate(() => { if (applied) { onNewPending(); render(); } });

await new Promise<void>(resolve => {
  conn.subscriptionBuilder()
    .onApplied(() => resolve())
    .onError(ctx => { console.error('[warden] subscription error', ctx.event); shutdown(1); })
    .subscribe([tables.accessGrant, tables.change, tables.device, tables.event]);
});
applied = true;
for (const g of pendingGrants()) seenPending.add(g.id);   // do not chime for grants that predate us (still shown)
console.log(`[warden] subscribed. ${pendingGrants().length} pending at start`);
tone(1000, 80, 0.2);
render(true);
setInterval(render, 250);
setupKeys();
if (HTTP_PORT > 0) {
  const token = crypto.randomBytes(12).toString('hex');
  startHttp({
    host: HTTP_HOST, port: HTTP_PORT, token,
    state: () => { const v = computeView(); return { lines: v.lines, led: v.led, mode: v.mode }; },
    press: onButton,
  });
  console.log(`[warden] phone Lantern: http://<this-laptop-ip>:${HTTP_PORT}/?t=${token}  (bound to ${HTTP_HOST})`);
}
