// Run: npm start   (all devices)   or   NIGHTSHIFT_DEVICES=web-1,pixel npm start
import { DeviceExecutor } from './executor.js';
import { connect } from './spacetime.js';
import { AdbTarget, DockerTarget, type Target } from './targets.js';

const PIXEL_SERIAL = process.env.PIXEL_SERIAL ?? '54241FDAP002UZ';
const ALL: Record<string, () => Target> = {
  'web-1': () => new DockerTarget('web-1'),
  'web-2': () => new DockerTarget('web-2'),
  pixel: () => new AdbTarget('pixel', PIXEL_SERIAL),
};
const wanted = (process.env.NIGHTSHIFT_DEVICES ?? Object.keys(ALL).join(',')).split(',').map(s => s.trim()).filter(Boolean);
const running = new Map<string, DeviceExecutor>();

async function tryStart(id: string) {
  const target = ALL[id]?.();
  if (!target) { console.error(`unknown device ${id}`); return; }
  const why = await target.available();
  if (why) { console.warn(`[${id}] not started: ${why} (will retry)`); return; }
  try {
    const conn = await connect(id, id);   // one identity per device, token persisted
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

for (const id of wanted) await tryStart(id);
setInterval(() => { for (const id of wanted) if (!running.has(id)) void tryStart(id); }, 15000);
process.on('SIGINT', () => { for (const e of running.values()) e.stop(); process.exit(0); });
