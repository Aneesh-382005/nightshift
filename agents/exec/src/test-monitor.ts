// Monitor test. Run: npm run test:monitor
// Does NOT claim the gate. Spawns its own executors for web-2 and pixel with NIGHTSHIFT_ALERT_URL pointing at a local
// fake webhook, so the real hub is never alerted. Do not run while another executor for web-2 or pixel is up.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { connect } from './spacetime.js';
import { capture, sleep } from './util.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PORT = 18787;
let failures = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failures++; };

const alerts: { device: string; alert: string; source: string; t: number }[] = [];
const hook = http.createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)).on('end', () => { try { alerts.push({ ...JSON.parse(b), t: Date.now() }); } catch { /* ignore */ } res.end('ok'); });
}).listen(PORT, '127.0.0.1');

const obs = await connect('observer');
await new Promise<void>((res, rej) => obs.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('sub'))).subscribeToAllTables());

const reset = () => capture(`${ROOT}/demo/reset.sh`, ['web-2'], 60000);
const web2Alerts = () => alerts.filter(a => a.device === 'web-2');
const lastVitals = (dev: string) => {
  let best: { id: bigint; detail: string } | undefined;
  for (const e of obs.db.event.iter()) if (e.kind === 'vitals' && e.device === dev && (!best || e.id > best.id)) best = e;
  return best && JSON.parse(best.detail);
};
async function until(f: () => boolean, ms: number) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(250); } return f(); }

await reset();
const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, NIGHTSHIFT_DEVICES: 'web-2,pixel', NIGHTSHIFT_ALERT_URL: `http://127.0.0.1:${PORT}/alert` },
});

try {
  console.log('[1] vitals');
  check('web-2 vitals event within 20s', await until(() => !!lastVitals('web-2'), 20000));
  const v = lastVitals('web-2');
  check('web-2 vitals: health 200, diskPct, uptimeS', v?.health === 200 && typeof v.diskPct === 'number' && typeof v.uptimeS === 'number', JSON.stringify(v));
  check('pixel vitals event within 25s', await until(() => !!lastVitals('pixel'), 25000));
  const pv = lastVitals('pixel');
  check('pixel vitals: wifi boolean, battery number', typeof pv?.wifi === 'boolean' && typeof pv.battery === 'number', JSON.stringify(pv));
  check('no alert while healthy', web2Alerts().length === 0);

  console.log('[2] service killed: one alert, debounced, not repeated');
  await capture(`${ROOT}/demo/break.sh`, ['web-2', 'service'], 20000);
  const t0 = Date.now();
  check('alert arrives within 15s', await until(() => web2Alerts().length >= 1, 15000), `${Date.now() - t0}ms`);
  const a = web2Alerts()[0];
  check('alert body: device, source monitor, probe text', a?.source === 'monitor' && /down|not responding/.test(a.alert), JSON.stringify(a));
  check('not before 2 failed probes (>= 3s)', Date.now() - t0 >= 3000);
  await sleep(12000);
  check('no repeat while still failing', web2Alerts().length === 1, `${web2Alerts().length} alerts`);

  console.log('[3] recover, then a config fault alerts again with the probe text');
  await reset();
  await sleep(7000);
  await capture(`${ROOT}/demo/break.sh`, ['web-2', 'config'], 20000);
  check('second alert after recovery', await until(() => web2Alerts().length >= 2, 15000));
  check('alert text carries the probe result', /500.*bad config/.test(web2Alerts()[1]?.alert ?? ''), web2Alerts()[1]?.alert);
} finally {
  await reset();
  child.kill('SIGINT');
  await sleep(500);
  child.kill('SIGKILL');
  hook.close();
  obs.disconnect();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
