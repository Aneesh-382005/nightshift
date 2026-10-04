// Live test at the board. Starts its own warden on the real FREE-WILi, creates a pending demo grant on
// `test-box`, then walks you through: 1) press GREEN, 2) double shake. Prints what the warden received.
//   cd agents/warden && npx tsx src/live-test.ts            (real board)
//   npx tsx src/live-test.ts --backend sim                   (keyboard: g, then x)
// The board shows one word per state (8 chars max): APPROVE (amber) -> ACTIVE -> REVOKED (red).
// It acts as the gate, and claimGate replaces the gate identity, so it refuses to run while the hub
// (serve.ts) or another warden is running. Stop them first. Restart the hub afterwards (it re-claims the gate).
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../common/src/module_bindings/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const backend = argv.includes('--backend') ? argv[argv.indexOf('--backend') + 1] : 'onewili';
const STEP_TIMEOUT_MS = 90_000;

// True if a real process (not a shell line that merely mentions the name) matches.
const running = (pat: string) => spawnSync('pgrep', ['-af', pat]).stdout.toString().split('\n').filter(Boolean)
  .some(l => Number(l.split(' ')[0]) !== process.pid && !/\b(ba)?sh -c\b|live-test|pgrep/.test(l));
if (running('src/serve.ts')) { console.error('Stop the hub first (serve.ts is running): this test takes over the gate identity.'); process.exit(2); }
if (running('src/warden.ts')) { console.error('Another warden is running and owns the board. Stop it first.'); process.exit(2); }

const say = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- warden child ----
const warden = spawn(path.join(here, '../node_modules/.bin/tsx'), ['src/warden.ts', '--backend', backend], { cwd: path.join(here, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
const wlines: string[] = [];
let wardenReady = false, fellBack = false;
const waiters: Array<{ re: RegExp; resolve: (l: string) => void }> = [];
function onLine(l: string) {
  wlines.push(l);
  if (/subscribed\./.test(l)) wardenReady = true;
  if (/falling back to sim/.test(l)) fellBack = true;
  for (const w of [...waiters]) if (w.re.test(l)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(l); }
}
createInterface({ input: warden.stdout }).on('line', onLine);
createInterface({ input: warden.stderr }).on('line', onLine);
// Only lines after `from` count, so an earlier stray press cannot satisfy a later step.
const waitLine = (re: RegExp, ms: number, from = 0) => new Promise<string | undefined>(res => {
  const hit = wlines.slice(from).find(l => re.test(l)); if (hit) return res(hit);
  const w = { re, resolve: (l: string) => { clearTimeout(t); res(l); } };
  const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); res(undefined); }, ms);
  waiters.push(w);
});
if (backend === 'sim') process.stdin.pipe(warden.stdin);   // sim: your keys (g, x) go to the warden
const cleanup = (code: number) => { try { warden.kill('SIGTERM'); } catch { /* */ } setTimeout(() => process.exit(code), 600); };
process.on('SIGINT', () => cleanup(130));

// ---- gate ----
const TOKEN_FILE = path.resolve(here, '../.stdb-token-gate');
const conn = await new Promise<DbConnection>((resolve, reject) => {
  const saved = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : undefined;
  DbConnection.builder().withUri('ws://127.0.0.1:3000').withDatabaseName('nightshift').withToken(saved)
    .onConnect((c, _i, token) => { fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 }); resolve(c); })
    .onConnectError((_c, e) => reject(new Error(String(e)))).build();
});
await new Promise<void>(r => conn.subscriptionBuilder().onApplied(() => r()).subscribe([tables.device, tables.accessGrant]));
await conn.reducers.claimGate({ secret: 'tally-gate-dev' });
if (!conn.db.device.id.find('test-box')) {
  await conn.reducers.registerDevice({ id: 'test-box', name: 'Test box', kind: 'linux', capabilities: ['shell.write'] });
}

say('Starting the warden on the board...');
for (let i = 0; i < 40 && !wardenReady; i++) await sleep(500);
if (!wardenReady) { say('FAIL: warden did not start. Last output:\n' + wlines.slice(-5).join('\n')); cleanup(1); await sleep(2000); }
if (fellBack && backend !== 'sim') { say('FAIL: the board did not connect, the warden fell back to the simulator. Replug the board and retry.'); cleanup(1); await sleep(2000); }

const results: string[] = [];
const grantRow = (id: bigint) => conn.db.accessGrant.id.find(id);
async function waitGrant(id: bigint, want: string, ms: number) {
  for (let t = 0; t < ms; t += 250) { if (grantRow(id)?.status === want) return true; await sleep(250); }
  return false;
}

// ---- step 1: green ----
const mark = wlines.length;
await conn.reducers.requestGrant({
  requester: 'live-test', target: 'test-box', capability: 'shell.write', reason: 'live test',
  command: 'echo live-test', plan: '{}', ttlSeconds: 120, autoApprove: false,
});
await sleep(500);
const gid = [...conn.db.accessGrant.iter()].filter(g => g.requester === 'live-test').reduce((m, g) => (g.id > m ? g.id : m), 0n);
say('\n1/2  The board should show APPROVE with amber pulsing LEDs.');
say('     Press the GREEN button.   (red denies, so do not press it)');
const press = await waitLine(/button (green|blue|red|gray|yellow)/, STEP_TIMEOUT_MS, mark);
if (!press) results.push('1 FAIL: no button press received within 90 s');
else {
  const name = press.match(/button (\w+)/)![1];
  say(`     received: ${name}`);
  if (name === 'green' && await waitGrant(gid, 'active', 5000)) { say(`     grant #${gid} is now active (approved by the warden). PASS`); results.push('1 PASS: green press approved the grant'); }
  else results.push(`1 FAIL: got "${name}", grant is ${grantRow(gid)?.status}`);
}

// ---- step 2: double shake ----
if (grantRow(gid)?.status === 'active') {
  say('\n2/2  The board should show ACTIVE with solid amber LEDs.');
  say('     Shake the board twice, quickly (within about 1.5 s). Do not hold red.');
  const ok = await waitGrant(gid, 'revoked', STEP_TIMEOUT_MS);
  const seen = wlines.slice(mark).find(l => /double shake/.test(l));
  if (ok) { say(`\nREVOKED  grant #${gid} was revoked${seen ? ' by the double shake' : ' (but no shake line was seen: was it the red button?)'}. PASS`); results.push(seen ? '2 PASS: double shake revoked the grant' : '2 PASS?: revoked, but not by a shake'); }
  else results.push('2 FAIL: grant was not revoked within 90 s (expires on its own after 120 s)');
} else results.push('2 SKIPPED');

say('\nResult:\n  ' + results.join('\n  '));
say('Restart the hub now if you stopped it (it re-claims the gate).');
cleanup(results.every(r => r.includes('PASS')) ? 0 : 1);
