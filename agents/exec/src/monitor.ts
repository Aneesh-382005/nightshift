import type { DbConnection } from '../../common/src/module_bindings/index.js';
import type { Target } from './targets.js';
import { shq } from './util.js';

export interface Probe { ok: boolean; alert: string; vitals: Record<string, unknown> }

const kv = (out: string) => Object.fromEntries(
  out.split('\n').map(l => /^(\w+)=(.*)$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map(m => [m[1], m[2]]));
const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s.trim()) ? Number(s) : null);

// Containers: the app's own /health (status code and body), df on /var/log, log folder size, PID 1 age.
const DOCKER_PROBE = `
out=$(python -c ${shq(`import urllib.request as u,urllib.error as e
try:
    r=u.urlopen('http://127.0.0.1:8080/health',timeout=2); print(r.status, r.read().decode().strip())
except e.HTTPError as x: print(x.code, x.read().decode().strip())
except Exception: print(0, 'no response')`)} 2>/dev/null)
echo "health=$out"
echo "disk=$(df -P /var/log | awk 'NR==2{gsub("%","",$5);print $5}')"
echo "logkb=$(du -sk /var/log/app 2>/dev/null | cut -f1)"
echo "up=$(( $(cut -d. -f1 /proc/uptime) - $(awk '{print int($22/100)}' /proc/1/stat) ))"
`;

export async function probeDocker(t: Target): Promise<Probe> {
  const r = await t.run(DOCKER_PROBE, 8);
  if (r.code !== 0) return { ok: false, alert: `container ${t.id} unreachable: ${r.output.slice(0, 120)}`, vitals: { ok: false, health: -1 } };
  const m = kv(r.output);
  const [codeS, ...rest] = (m.health ?? '0 no response').split(' ');
  const code = Number(codeS) || 0;
  const body = rest.join(' ');
  const vitals = { ok: code === 200, health: code, diskPct: num(m.disk), logMB: num(m.logkb) === null ? null : Math.round(num(m.logkb)! / 1024), uptimeS: num(m.up) };
  const alert = code === 200 ? '' : code === 0 ? 'service down: /health not responding' : `health check failed: HTTP ${code} ${body}`;
  return { ok: code === 200, alert, vitals };
}

// Phone: adb liveness, wifi_on, battery level, uptime. One adb call.
const ADB_PROBE = `echo wifi=$(settings get global wifi_on); echo battery=$(dumpsys battery | grep -m1 'level:' | tr -dc 0-9); echo up=$(cut -d. -f1 /proc/uptime)`;

export async function probeAdb(t: Target): Promise<Probe> {
  const r = await t.run(ADB_PROBE, 10);
  if (r.code !== 0) return { ok: false, alert: `phone unreachable over adb: ${r.output.slice(0, 120)}`, vitals: { ok: false, alive: false } };
  const m = kv(r.output);
  const wifi = m.wifi?.trim() === '1';
  const vitals = { ok: wifi, alive: true, wifi, battery: num(m.battery), uptimeS: num(m.up) };
  return { ok: wifi, alert: wifi ? '' : 'wifi is off', vitals };
}

// Sandbox laptop: dirs from the known-good snapshot that are missing, and files that are missing or changed.
const SANDBOX_PROBE = `miss=""
for d in $(cat /snapshot/DIRS); do [ -d "/playground/$d" ] || miss="$miss $d"; done
echo "missing=$miss"
echo "bad=$(cd /playground && sha256sum -c --quiet /snapshot/MANIFEST 2>&1 | grep -c FAILED)"
echo "files=$(find /playground -type f | wc -l)"
echo "up=$(( $(cut -d. -f1 /proc/uptime) - $(awk '{print int($22/100)}' /proc/1/stat) ))"
`;

export async function probeSandbox(t: Target): Promise<Probe> {
  const r = await t.run(SANDBOX_PROBE, 8);
  if (r.code !== 0) return { ok: false, alert: `sandbox unreachable: ${r.output.slice(0, 120)}`, vitals: { ok: false } };
  const m = kv(r.output);
  const missing = (m.missing ?? '').trim().split(/\s+/).filter(Boolean);
  const bad = num(m.bad) ?? 0;
  const ok = missing.length === 0 && bad === 0;
  const alert = missing.length ? `folder missing in sandbox: ${missing.slice(0, 3).join(', ')}` : bad ? `sandbox: ${bad} file(s) missing or changed vs snapshot` : '';
  return { ok, alert, vitals: { ok, missing, filesBad: bad, files: num(m.files), uptimeS: num(m.up) } };
}

// Host (VPS): the demo service's /health, disk use of the root, tmp folder size, machine uptime, service state via svc.
const HOST_PROBE = `out=$(python3 -c ${shq(`import urllib.request as u,urllib.error as e,os
url='http://127.0.0.1:%s/health' % os.environ.get('NS_PORT','8080')
try:
    r=u.urlopen(url,timeout=2); print(r.status, r.read().decode().strip())
except e.HTTPError as x: print(x.code, x.read().decode().strip())
except Exception: print(0, 'no response')`)} 2>/dev/null)
echo "health=$out"
echo "disk=$(df -P . | awk 'NR==2{gsub("%","",$5);print $5}')"
echo "tmpkb=$(du -sk tmp 2>/dev/null | cut -f1)"
echo "up=$(cut -d. -f1 /proc/uptime)"
echo "svc=$(svc status web 2>/dev/null | head -1)"
`;

export async function probeHost(t: Target): Promise<Probe> {
  const r = await t.run(HOST_PROBE, 8);
  if (r.code !== 0) return { ok: false, alert: `host ${t.id} probe failed: ${r.output.slice(0, 120)}`, vitals: { ok: false, health: -1 } };
  const m = kv(r.output);
  const [codeS, ...rest] = (m.health ?? '0 no response').split(' ');
  const code = Number(codeS) || 0;
  const tmp = num(m.tmpkb);
  const vitals = { ok: code === 200, health: code, diskPct: num(m.disk), tmpMB: tmp === null ? null : Math.round(tmp / 1024), uptimeS: num(m.up), service: m.svc || null };
  const alert = code === 200 ? '' : code === 0 ? 'service down: /health not responding' : `health check failed: HTTP ${code} ${rest.join(' ')}`;
  return { ok: code === 200, alert, vitals };
}

export interface MonitorOpts {
  busy: () => boolean;                 // a grant or rollback is running on this device
  incidentOpen: () => boolean;         // an incident for this device has status open
  alertUrl: string;
  probeEveryMs?: number; vitalsEveryMs?: number; failuresToAlert?: number;
}

/** Probes every 3 s, logs a "vitals" event every 10 s, POSTs one alert per healthy-to-failing transition. */
export class Monitor {
  private timer?: NodeJS.Timeout;
  private fails = 0;
  private alerted = false;
  private lastVitals = 0;
  private running = false;
  alertsSent = 0;

  constructor(private t: Target, private conn: DbConnection, private o: MonitorOpts) {}

  start() { this.timer = setInterval(() => void this.tick(), this.o.probeEveryMs ?? 3000); }
  stop() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    if (this.o.busy()) { this.fails = 0; return; }   // our own fix is running, do not alert on it
    this.running = true;
    try {
      const p = await (this.t.flavor === 'android' ? probeAdb(this.t) : this.t.kind === 'laptop' ? probeSandbox(this.t) : this.t.kind === 'host' ? probeHost(this.t) : probeDocker(this.t));
      if (this.o.busy()) { this.fails = 0; return; }  // a job started while we probed
      const now = Date.now();
      if (now - this.lastVitals >= (this.o.vitalsEveryMs ?? 10000)) {
        this.lastVitals = now;
        this.conn.reducers.logEvent({ kind: 'vitals', device: this.t.id, grantId: 0n, detail: JSON.stringify(p.vitals) }).catch(() => {});
      }
      if (p.ok) { this.fails = 0; this.alerted = false; return; }
      this.fails++;
      if (this.fails >= (this.o.failuresToAlert ?? 2) && !this.alerted && !this.o.incidentOpen()) {
        if (await this.post(p.alert)) { this.alerted = true; this.alertsSent++; }
      }
    } catch (e: any) {
      console.log(`[${this.t.id}] monitor error: ${e?.message ?? e}`);
    } finally { this.running = false; }
  }

  private async post(alert: string): Promise<boolean> {
    if (this.o.alertUrl === 'off') { console.log(`[${this.t.id}] monitor alert (webhook off, vitals only): ${alert}`); return true; }
    try {
      const r = await fetch(this.o.alertUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device: this.t.id, alert, source: 'monitor' }), signal: AbortSignal.timeout(3000),
      });
      console.log(`[${this.t.id}] monitor alert sent (${r.status}): ${alert}`);
      return r.ok;
    } catch (e: any) {
      console.log(`[${this.t.id}] monitor alert not delivered (will retry): ${e?.message ?? e}`);
      return false;
    }
  }
}
