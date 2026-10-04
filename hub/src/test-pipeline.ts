// Free end-to-end pipeline test: /break -> incident -> request -> stub harness -> MCP -> gate -> executor -> health.
// Needs: hub serve running with NS_HARNESS=stub, executors up. It claims the WARDEN identity (dev secret) to approve
// pending grants, so stop any real warden first and restart it afterwards. No model calls.
//   npx tsx src/test-pipeline.ts [fault ...]      faults: web-1:service web-1:config web-1:disk web-1:folder web-1:poison web-2:service pixel:wifi laptop:folder alert
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { DbConnection } from '../../agents/common/src/module_bindings/index.js';
import { sleep } from './hub.js';

const ROOT = resolve(import.meta.dirname, '../..');
const TOKEN = resolve(import.meta.dirname, '../.stdb-warden-token');
const PIXEL = process.env.PIXEL_SERIAL ?? '54241FDAP002UZ';
const saved = existsSync(TOKEN) ? readFileSync(TOKEN, 'utf8').trim() : undefined;
const conn: DbConnection = await new Promise((res, rej) => {
  DbConnection.builder().withUri('ws://127.0.0.1:3000').withDatabaseName('nightshift').withToken(saved)
    .onConnect((c, _i, t) => { if (t && t !== saved) writeFileSync(TOKEN, t, { mode: 0o600 }); res(c); })
    .onConnectError((_c, e) => rej(new Error(String(e)))).build();
});
await new Promise<void>((res, rej) => conn.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('sub'))).subscribeToAllTables());
await conn.reducers.claimWarden({ secret: 'tally-warden-dev' });
const db = conn.db;

let presses = 0;
const decided = new Set<bigint>();
setInterval(() => {
  for (const g of db.accessGrant.iter()) {
    if (g.status === 'pending' && !decided.has(g.id)) {
      decided.add(g.id); presses++;
      conn.reducers.decideGrant({ grantId: g.id, approve: true, ttlSeconds: 60 }).catch(() => undefined);
    }
  }
}, 700);

const sh = (c: string, a: string[]) => spawnSync(c, a, { encoding: 'utf8', timeout: 30000 });
const healthy: Record<string, () => boolean> = {
  'web-1': () => sh('docker', ['exec', 'web-1', 'sh', '-c', 'health && test -d /srv/app']).status === 0,
  'web-2': () => sh('docker', ['exec', 'web-2', 'sh', '-c', 'health && test -d /srv/app']).status === 0,
  pixel: () => sh('adb', ['-s', PIXEL, 'shell', 'settings get global wifi_on']).stdout.trim() === '1',
  laptop: () => sh('docker', ['exec', 'laptop-sandbox', 'sh', '-c', 'cd /playground && sha256sum -c --quiet /snapshot/MANIFEST && for d in $(cat /snapshot/DIRS); do [ -d "$d" ] || exit 1; done']).status === 0,
};

// --- throwaway local host executor (device vps-test, kind host) for the host:<fault> cases. Vitals failing 2x in a row
// become an incident in the hub (no webhook). Uses a throwaway systemd user unit like agents/exec/src/test-host.ts.
const VPS = resolve(ROOT, 'demo/vps');
const HOST_ID = 'vps-test', HOST_PORT = '18090', HOST_UNIT = 'ns-demo-test';
let hostRoot = '', hostChild: ChildProcess | undefined;
const hostEnv = () => ({ ...process.env, NS_ROOT: hostRoot, NS_PORT: HOST_PORT, NS_UNIT: HOST_UNIT, PATH: `${VPS}/bin:${process.env.PATH}` });
const hostSh = (script: string, ...a: string[]) => spawnSync(script, a, { encoding: 'utf8', timeout: 60000, env: hostEnv() });
async function setupHost() {
  if (hostChild) return;
  hostRoot = fs.mkdtempSync(resolve(os.tmpdir(), 'ns-vps-pipe-'));
  hostSh(`${VPS}/seed.sh`);
  const unitFile = resolve(os.homedir(), '.config/systemd/user', `${HOST_UNIT}.service`);
  fs.mkdirSync(resolve(unitFile, '..'), { recursive: true });
  fs.writeFileSync(unitFile, `[Unit]\nDescription=ns demo pipeline test\n[Service]\nEnvironment=NS_ROOT=${hostRoot} NS_PORT=${HOST_PORT}\nExecStart=/usr/bin/python3 ${VPS}/demoapp.py\nRestart=always\nRestartSec=1\n`);
  spawnSync('systemctl', ['--user', 'daemon-reload']); hostSh('systemctl', '--user', 'restart', HOST_UNIT);
  hostChild = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(ROOT, 'agents/exec'), stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...hostEnv(), NS_DEVICE_ID: HOST_ID, NIGHTSHIFT_ALERT_URL: 'off' },
  });
  for (let i = 0; i < 40 && db.device.id.find(HOST_ID)?.status !== 'online'; i++) await sleep(500);
  await sleep(2000);
}
function teardownHost() {
  if (!hostChild) return;
  hostChild.kill('SIGINT');
  spawnSync('systemctl', ['--user', 'stop', HOST_UNIT]); spawnSync('systemctl', ['--user', 'disable', HOST_UNIT]);
  fs.rmSync(resolve(os.homedir(), '.config/systemd/user', `${HOST_UNIT}.service`), { force: true });
  spawnSync('systemctl', ['--user', 'daemon-reload']);
  fs.rmSync(hostRoot, { recursive: true, force: true });
}
healthy[HOST_ID] = () => hostSh('health').status === 0;

const maxReq = () => { let m = 0n; for (const r of db.userRequest.iter()) if (r.id > m) m = r.id; return m; };
let failures = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const args = process.argv.slice(2);
const todo = args.length ? args : ['web-1:service', 'web-1:config', 'web-1:disk', 'web-1:folder', 'web-1:poison', 'web-2:service', 'pixel:wifi', 'laptop:folder', 'alert', 'host:service', 'host:disk'];
sh(`${ROOT}/demo/reset.sh`, []); sh(`${ROOT}/demo/reset.sh`, ['laptop']);

for (const item of todo) {
  const before = maxReq();
  const blockedBefore = [...db.event.iter()].filter(e => e.kind === 'policy.blocked').length;
  const pressesBefore = presses;
  let device: string, body: any, url: string, rjOverride: any;
  if (item.startsWith('host:')) {
    await setupHost();
    device = HOST_ID; url = '';
    hostSh(`${VPS}/break.sh`, item.split(':')[1]);
    let inc0: any;
    for (let i = 0; i < 40 && !inc0; i++) { await sleep(2000); for (const q of db.userRequest.iter()) if (q.id > before && q.text.includes(`monitoring on ${HOST_ID}`)) inc0 = q; }
    check(`${item}: hub raised an incident from failing vitals`, !!inc0, inc0?.text.slice(0, 120));
    if (!inc0) continue;
    const m = /Incident #(\d+)/.exec(inc0.text);
    body = null; rjOverride = { incident: Number(m?.[1]) };
  } else if (item === 'alert') {
    device = 'web-2'; url = 'alert';
    sh(`${ROOT}/demo/break.sh`, ['web-2', 'service']);
    body = { device, alert: 'service down: /health not responding', source: 'monitor' };
  } else {
    const [d, f] = item.split(':'); device = d; url = 'break'; body = { device: d, fault: f };
  }
  const r = rjOverride ? { ok: true } : await fetch(`http://127.0.0.1:8787/${url}`, { method: 'POST', body: JSON.stringify(body) });
  const rj: any = rjOverride ?? await (r as Response).json();
  if (!r.ok) { check(`${item}: webhook`, false, JSON.stringify(rj)); continue; }
  let req: ReturnType<typeof db.userRequest.id.find> | undefined = undefined as any;
  for (let i = 0; i < 100 && !(req && (req.status === 'done' || req.status === 'failed')); i++) {
    await sleep(2000);
    for (const q of db.userRequest.iter()) if (q.id > before && q.text.includes(`Incident #${rj.incident}`)) req = q;
  }
  await sleep(1500);
  const inc = [...db.incident.iter()].find(i => Number(i.id) === rj.incident);
  const mine = [...db.event.iter()].filter(e => e.kind === 'policy.blocked').length - blockedBefore;
  check(`${item}: request done`, req?.status === 'done', (req?.result ?? 'no request').slice(0, 200));
  check(`${item}: target healthy`, healthy[device]());
  check(`${item}: incident healed`, inc?.status === 'healed', inc?.status);
  if (item.endsWith(':poison')) check(`${item}: hostile command blocked by policy`, mine >= 1, `${mine} blocked`);
  console.log(`      presses used: ${presses - pressesBefore}`);
}
teardownHost();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
conn.disconnect();
process.exit(failures ? 1 : 0);
