// Run: npm start   (all default devices)   or   NIGHTSHIFT_DEVICES=web-1,pixel npm start
// VPS / any host: NS_DEVICE_ID=vps-1 [NS_ROOT=~/ns-demo] [STDB_URI=ws://100.x.y.z:3000] npm start   (runs ON the machine)
// Or a targets file (NS_TARGETS=path, default agents/exec/targets.json if present):
//   [{"id":"vps-1","type":"host","root":"~/ns-demo"}, {"id":"web-1","type":"docker"}, {"id":"pixel","type":"adb","serial":"..."}]
import fs from 'node:fs';
import path from 'node:path';
import { DeviceExecutor } from './executor.js';
import { connect } from './spacetime.js';
import { AdbTarget, DockerTarget, HostTarget, type Target } from './targets.js';
import { capture } from './util.js';

const PIXEL_SERIAL = process.env.PIXEL_SERIAL ?? '54241FDAP002UZ';
const HERE = import.meta.dirname;

interface Entry { id: string; type: 'docker' | 'adb' | 'host'; root?: string; serial?: string; name?: string; container?: string }
function build(e: Entry): Target {
  if (e.type === 'host') return new HostTarget(e.id, e.root ?? process.env.NS_ROOT ?? '~/ns-demo', e.name);
  if (e.type === 'adb') return new AdbTarget(e.id, e.serial ?? PIXEL_SERIAL, e.name);
  if (e.id === 'laptop') return new DockerTarget('laptop', e.name ?? 'laptop (SANDBOX ~/nightshift-playground)', e.container ?? 'laptop-sandbox', 'laptop');
  return new DockerTarget(e.id, e.name, e.container);
}

const defaults: Entry[] = [
  { id: 'web-1', type: 'docker' }, { id: 'web-2', type: 'docker' }, { id: 'pixel', type: 'adb' },
  { id: 'laptop', type: 'docker' },   // SANDBOX only: a container mounting just ~/nightshift-playground
];
const targetsFile = process.env.NS_TARGETS ?? path.resolve(HERE, '..', 'targets.json');
let entries: Entry[];
if (process.env.NS_DEVICE_ID) entries = [{ id: process.env.NS_DEVICE_ID, type: 'host', root: process.env.NS_ROOT }];
else if (fs.existsSync(targetsFile)) entries = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
else entries = defaults;

const ALL = new Map(entries.map(e => [e.id, e]));
const wanted = (process.env.NIGHTSHIFT_DEVICES ?? [...ALL.keys()].join(',')).split(',').map(s => s.trim()).filter(Boolean);
const running = new Map<string, DeviceExecutor>();

async function tryStart(id: string) {
  const entry = ALL.get(id);
  if (!entry) { console.error(`unknown device ${id}`); return; }
  const target = build(entry);
  if (id === 'laptop' && entry.type === 'docker') await capture('sh', [path.resolve(HERE, '..', '..', '..', 'demo', 'laptop-setup.sh')], 20000);
  const why = await target.available();
  if (why) { console.warn(`[${id}] not started: ${why} (will retry)`); return; }
  try {
    const conn = await connect(id, id, true);   // one identity per device, token persisted
    const ex = new DeviceExecutor(target, conn);
    await ex.start();
    running.set(id, ex);
  } catch (e: any) {
    console.error(`[${id}] start failed: ${e?.message ?? e}`);
    if (/owned by another identity/.test(String(e?.message))) {
      console.error(`[${id}] the token in agents/exec/.state/${id}.token is not the one that registered this device. Delete it only if the DB was reset.`);
    }
  }
}

process.on('unhandledRejection', e => { console.error(`unhandledRejection: ${(e as Error)?.stack ?? e}`); process.exit(1); });
process.on('uncaughtException', e => { console.error(`uncaughtException: ${e?.stack ?? e}`); process.exit(1); });

for (const id of wanted) await tryStart(id);
const startedAt = Date.now();
setInterval(() => console.log(`[exec] alive up=${Math.round((Date.now() - startedAt) / 1000)}s devices=${[...running.keys()].join(',') || 'none'}`), 60000);
setInterval(() => { for (const id of wanted) if (!running.has(id)) void tryStart(id); }, 15000);
process.on('SIGINT', () => { for (const e of running.values()) e.stop(); process.exit(0); });
process.on('SIGTERM', () => { for (const e of running.values()) e.stop(); process.exit(0); });
