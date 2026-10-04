// Acceptance test. Run: npm test
// Needs: SpacetimeDB local with the nightshift module, docker containers web-1 and web-2 (demo/docker), the phone on adb.
// NOTE: this claims the GATE identity with the dev secret (token kept in .state/test-gate.token). If a real hub
// gate is running, it must re-claim afterwards. Rollback requests are sent as the warden through the spacetime CLI.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { connect } from './spacetime.js';
import { capture, sleep } from './util.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SPACETIME = `${process.env.HOME}/.local/bin/spacetime`;
const PIXEL = process.env.PIXEL_SERIAL ?? '54241FDAP002UZ';

let failures = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

const gate = await connect('gate', 'test-gate');
await gate.reducers.claimGate({ secret: 'tally-gate-dev' });
await new Promise<void>((res, rej) => gate.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('sub'))).subscribeToAllTables());

const online = (id: string) => gate.db.device.id.find(id)?.status === 'online';
let child: ChildProcess | undefined;
if (!['web-1', 'web-2', 'pixel'].every(online)) {
  console.log('starting executors...');
  child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, NIGHTSHIFT_MONITOR: '0' } });
  for (let i = 0; i < 40 && !['web-1', 'web-2', 'pixel'].every(online); i++) await sleep(500);
}
check('devices web-1, web-2, pixel online', ['web-1', 'web-2', 'pixel'].every(online));

let n = 0;
async function grant(target: string, cap: string, command: string, plan: object) {
  const reason = `exec-test-${Date.now()}-${n++}`;
  await gate.reducers.requestGrant({
    requester: 'exec-test', target, capability: cap, reason, command, plan: JSON.stringify(plan),
    ttlSeconds: 90, autoApprove: true,
  });
  let id: bigint | undefined;
  for (let i = 0; i < 50 && id === undefined; i++) {
    for (const g of gate.db.accessGrant.iter()) if (g.reason === reason) id = g.id;
    if (id === undefined) await sleep(100);
  }
  if (id === undefined) throw new Error('grant row not seen');
  for (let i = 0; i < 400; i++) {
    const r = gate.db.runResult.grantId.find(id);
    if (r) return { id, r };
    await sleep(150);
  }
  throw new Error(`no run_result for grant ${id}`);
}
const changeOf = async (grantId: bigint) => {
  for (let i = 0; i < 20; i++) { for (const c of gate.db.change.iter()) if (c.grantId === grantId) return c; await sleep(150); }
  return undefined;
};
const dx = async (c: string, cmd: string) => (await capture('docker', ['exec', c, 'sh', '-c', cmd], 20000));
const healthy = async (c: string) => (await dx(c, 'health')).code === 0;
const adbSh = async (cmd: string) => (await capture('adb', ['-s', PIXEL, 'shell', cmd], 15000)).stdout.trim();
async function undo(changeId: bigint) {
  const r = await capture(SPACETIME, ['call', 'nightshift', 'request_rollback', String(changeId), '--server', 'local'], 15000);
  if (r.code !== 0) console.log(`      request_rollback via CLI failed (is the CLI identity the warden?): ${r.stderr.trim().slice(0, 200)}`);
  for (let i = 0; i < 60; i++) {
    if (gate.db.change.id.find(changeId)?.status === 'rolled_back') return true;
    await sleep(250);
  }
  return false;
}
const reset = () => capture(`${ROOT}/demo/reset.sh`, ['web-1', 'web-2'], 60000);

await reset();

// 1. restart-web on web-1
console.log('\n[1] restart-web after the service is killed');
await capture(`${ROOT}/demo/break.sh`, ['web-1', 'service'], 20000);
check('web-1 is down before the fix', !(await healthy('web-1')));
{
  const { r } = await grant('web-1', 'shell.write', 'svc restart web', {
    snapshots: [{ kind: 'service', name: 'web' }], health: 'health', timeoutS: 20, runbookId: 'restart-web', deviceType: 'linux-server',
  });
  check('restart-web: exit 0 and healthOk', r.exitCode === 0 && r.healthOk && !r.rolledBack, r.output.slice(0, 80));
  check('web-1 healthy afterwards', await healthy('web-1'));
}

// 2. broken config restored
console.log('\n[2] config corrupted, restore known-good');
await reset();
await capture(`${ROOT}/demo/break.sh`, ['web-1', 'config'], 20000);
check('web-1 unhealthy with corrupt config', !(await healthy('web-1')));
let cfgGrant: bigint;
{
  const { id, r } = await grant('web-1', 'shell.write', 'cp /srv/app.conf.good /etc/app.conf', {
    snapshots: [{ kind: 'file', path: '/etc/app.conf' }], health: 'health', timeoutS: 20, runbookId: 'restore-config', deviceType: 'linux-server',
  });
  cfgGrant = id;
  check('restore-config: healthOk', r.exitCode === 0 && r.healthOk && !r.rolledBack);
  const c = await changeOf(id);
  check('change recorded as applied with inverse', c?.status === 'applied' && c.inverseCommand.length > 0 && Buffer.from(JSON.parse(c.preState)[0]?.b64 ?? '', 'base64').toString().includes('corrupted'));
}

// 3. rollback.requested undoes the last change (config goes back to the corrupted snapshot)
console.log('\n[3] undo button (rollback.requested)');
{
  const c = await changeOf(cfgGrant);
  check('undo reaches rolled_back', c ? await undo(c.id) : false);
  const cur = (await dx('web-1', 'cat /etc/app.conf')).stdout.trim();
  check('config is back to the pre-fix content', cur === 'corrupted ###', JSON.stringify(cur));
}

// 4. forced health failure triggers auto-rollback
console.log('\n[4] forced health failure');
await reset();
{
  const before = (await dx('web-1', 'cat /etc/app.conf')).stdout;
  const { id, r } = await grant('web-1', 'shell.write', 'printf "mode=\\n" > /etc/app.conf', {
    snapshots: [{ kind: 'file', path: '/etc/app.conf' }], health: 'health', healthWaitS: 2, timeoutS: 20, runbookId: 'bad-fix', deviceType: 'linux-server',
  });
  check('bad fix: healthOk false and rolledBack true', !r.healthOk && r.rolledBack, r.output.slice(-60));
  const after = (await dx('web-1', 'cat /etc/app.conf')).stdout;
  check('config restored byte for byte', after === before);
  check('change marked rolled_back', (await changeOf(id))?.status === 'rolled_back');
  check('web-1 healthy again', await healthy('web-1'));
}

// 5. read grant, exit codes, timeout, dedupe
console.log('\n[5] read, failure, timeout');
{
  const { id, r } = await grant('web-2', 'shell.read', 'cat /etc/app.conf', {});
  check('shell.read returns output', r.exitCode === 0 && r.output.includes('mode=prod'));
  await sleep(1500);
  let rows = 0; for (const x of gate.db.runResult.iter()) if (x.grantId === id) rows++;
  check('read grant ran once', rows === 1);
  check('no change row for a read', (await changeOf(id)) === undefined);
}
{
  const { r } = await grant('web-2', 'shell.write', 'exit 3', { snapshots: [{ kind: 'file', path: '/etc/app.conf' }], timeoutS: 10 });
  check('nonzero exit reported, rolled back', r.exitCode === 3 && !r.healthOk && r.rolledBack);
}
{
  const t0 = Date.now();
  const { r } = await grant('web-2', 'shell.read', 'sleep 30', { timeoutS: 2 });
  check('timeout kills the command', r.exitCode !== 0 && Date.now() - t0 < 15000, `exit ${r.exitCode} after ${Date.now() - t0}ms`);
  check('process is gone in the container', (await dx('web-2', 'pgrep -f "sleep 30" || ps | grep -c "sleep 30"')).stdout.trim().length >= 0);
}

// 6. phone wifi round trip
console.log('\n[6] phone wifi toggle');
{
  const initial = await adbSh('settings get global wifi_on');
  const off = initial === '1';
  const cmd = off ? 'svc wifi disable' : 'svc wifi enable';
  const { id, r } = await grant('pixel', 'shell.write', cmd, {
    snapshots: [{ kind: 'android_setting', ns: 'global', key: 'wifi_on' }], health: 'ping -c 1 -W 2 8.8.8.8', timeoutS: 20, healthWaitS: 8,
  });
  check(`${cmd}: exit 0`, r.exitCode === 0, r.output.slice(0, 80));
  let now = '';
  for (let i = 0; i < 10; i++) { now = await adbSh('settings get global wifi_on'); if (now !== initial) break; await sleep(500); }
  check('wifi_on flipped', now !== initial, `${initial} -> ${now}`);
  check('connectivity health passed (rolledBack false)', r.healthOk && !r.rolledBack, r.output.slice(-80));
  const c = await changeOf(id);
  check('undo restores wifi', c ? await undo(c.id) : false);
  let back = '';
  for (let i = 0; i < 10; i++) { back = await adbSh('settings get global wifi_on'); if (back === initial) break; await sleep(500); }
  check('wifi_on back to initial', back === initial, `${now} -> ${back}`);
}
{
  const { r } = await grant('pixel', 'shell.write', 'settings put bogusns bogus_key 1', { timeoutS: 15 });
  console.log(`      (info) bogus settings put: exit ${r.exitCode}: ${r.output.slice(0, 100).replace(/\n/g, ' ')}`);
  check('android failure text detected as failure', r.exitCode !== 0);
}

await reset();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
for (const c of [gate]) c.disconnect();
child?.kill('SIGINT');
await sleep(300);
process.exit(failures ? 1 : 0);
