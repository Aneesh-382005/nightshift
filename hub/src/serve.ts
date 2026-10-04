// Long-running hub process: mock alert webhook, user_request watcher (launches the harness), trust bookkeeping sweep.
// The hub is the only long-running gate identity. Run it with: npx tsx src/serve.ts
import { createServer } from 'node:http';
import { connectGate, nowUs, until } from './hub.js';
import { Gateway } from './gateway.js';
import { deviceTypeFor } from './policy.js';
import { pickHarness, runHarness } from './harness.js';

const PORT = Number(process.env.NS_ALERT_PORT ?? 8787);
const conn = await connectGate();
const gw = new Gateway(conn);
const db = conn.db;

function runbookFor(alert: string, device: string): string {
  if (deviceTypeFor(device) === 'android') return /wi-?fi|connect/i.test(alert) ? 'wifi-enable' : '';
  if (/disk|log|full|space/i.test(alert)) return 'rotate-logs';
  if (/config|conf/i.test(alert)) return 'restore-config';
  if (/down|service|health|unreach|500|503/i.test(alert)) return 'restart-web';
  return '';
}

// ---- mock monitoring webhook. This stands in for a real monitor (Datadog, Prometheus, SolarWinds).
const http = createServer((req, res) => {
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method !== 'POST' || req.url !== '/alert') return send(404, { error: 'POST /alert {"device","alert"}' });
  let body = '';
  req.on('data', d => { body += d; if (body.length > 10_000) req.destroy(); });
  req.on('end', async () => {
    try {
      const { device, alert } = JSON.parse(body);
      if (typeof device !== 'string' || typeof alert !== 'string' || !gw.device(device)) return send(400, { error: 'need known "device" and "alert" strings' });
      let max = 0n; for (const i of db.incident.iter()) if (i.id > max) max = i.id;
      await conn.reducers.openIncident({ device, alert: alert.slice(0, 300), runbookId: runbookFor(alert, device) });
      const inc = await until(() => { for (const i of db.incident.iter()) if (i.id > max && i.device === device) return i; return undefined; }, 3000, 50);
      const text = `MOCK ALERT from monitoring on ${device}: ${alert.slice(0, 300)}. Incident #${inc?.id ?? '?'}. Investigate and fix it.`;
      await conn.reducers.submitRequest({ text });
      send(200, { mock: true, incident: inc ? Number(inc.id) : null, device, alert });
    } catch (e) { send(400, { error: (e as Error).message }); }
  });
});
http.listen(PORT, '127.0.0.1', () => console.error(`mock alert webhook (MOCK, not a real monitor) on http://127.0.0.1:${PORT}/alert`));

// ---- request watcher
const started = new Set<bigint>();
async function handle(id: bigint) {
  if (started.has(id)) return;
  started.add(id);
  const r = db.userRequest.id.find(id);
  if (!r || r.status !== 'new') return;
  const harness = pickHarness();
  if (!harness) { await conn.reducers.updateRequest({ id, status: 'failed', result: 'no harness (gemini, claude, codex) found on PATH' }); return; }
  await conn.reducers.updateRequest({ id, status: 'running', result: `${harness} started` });
  const t0 = nowUs();
  console.error(`[request ${id}] ${harness}: ${r.text.slice(0, 100)}`);
  const res = await runHarness(harness, r.text);
  const t1 = nowUs();
  let commands = 0, presses = 0;
  for (const g of db.accessGrant.iter()) {
    if (g.createdAtUs >= t0 && g.createdAtUs <= t1 && g.requester === 'agent') { commands++; if (g.decidedBy === 'warden') presses++; }
  }
  await conn.reducers.logEvent({
    kind: 'cost.update', device: 'hub', grantId: 0n,
    detail: JSON.stringify({ tokens: res.tokens, usd: Number(res.usd.toFixed(4)), seconds: Math.round(res.seconds), commands, presses, model: `${res.harness}:${res.model}` }),
  });
  await conn.reducers.updateRequest({ id, status: res.ok ? 'done' : 'failed', result: res.text });
  console.error(`[request ${id}] ${res.ok ? 'done' : 'failed'} ${res.seconds.toFixed(0)}s $${res.usd.toFixed(3)} ${commands} commands ${presses} presses`);
}
db.userRequest.onInsert((_c, row) => { if (row.status === 'new') void handle(row.id).catch(e => console.error('watcher', e)); });
for (const row of [...db.userRequest.iter()]) if (row.status === 'new') void handle(row.id).catch(e => console.error('watcher', e));

// ---- bookkeeping for fixes whose asker has gone away
setInterval(() => { void gw.sweep().catch(() => undefined); }, 5000);
process.on('SIGINT', () => { conn.disconnect(); http.close(); process.exit(0); });
