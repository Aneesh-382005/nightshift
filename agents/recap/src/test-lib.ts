// Aggregation test with fixture rows, no database.
import { buildRecap, type Rows } from './recap-lib.js';

const S = 1_000_000;
const t0 = 1_791_000_000 * S;
const rows: Rows = {
  incidents: [
    { id: 1n, device: 'web-1', alert: 'service down', runbookId: 'restart-web', status: 'healed', attempts: 0, tsUs: BigInt(t0) },
    { id: 2n, device: 'web-1', alert: 'service down', runbookId: 'restart-web', status: 'healed', attempts: 0, tsUs: BigInt(t0 + 600 * S) },
    { id: 3n, device: 'pixel', alert: 'wifi off', runbookId: 'wifi-enable', status: 'escalated', attempts: 1, tsUs: BigInt(t0 + 900 * S) },
    { id: 4n, device: 'web-2', alert: 'old thing', runbookId: 'x', status: 'healed', attempts: 0, tsUs: BigInt(t0 - 99 * 3600 * S) },
  ],
  events: [
    { id: 1n, tsUs: BigInt(t0), kind: 'incident.opened', device: 'web-1', grantId: 0n, detail: '' },
    { id: 2n, tsUs: BigInt(t0 + 5 * S), kind: 'cost.update', device: 'hub', grantId: 0n, detail: '{"tokens":1000,"usd":0.002,"seconds":10,"commands":2,"presses":1}' },
    { id: 3n, tsUs: BigInt(t0 + 700 * S), kind: 'cost.update', device: 'hub', grantId: 0n, detail: '{"tokens":500,"usd":0.001,"seconds":5,"commands":1,"presses":0}' },
    { id: 4n, tsUs: BigInt(t0 + 800 * S), kind: 'trust.promoted', device: 'linux-server', grantId: 0n, detail: 'restart-web' },
    { id: 5n, tsUs: BigInt(t0 + 800 * S), kind: 'vitals', device: 'web-1', grantId: 0n, detail: '{}' },
  ],
  changes: [{ id: 1n, grantId: 11n, device: 'pixel', command: 'svc wifi enable', status: 'rolled_back', tsUs: BigInt(t0 + 910 * S) }],
  grants: [
    { id: 10n, target: 'web-1', capability: 'shell.write', command: 'svc restart web', status: 'used', decidedBy: 'warden', createdAtUs: BigInt(t0 + 2 * S) },
    { id: 11n, target: 'web-1', capability: 'shell.write', command: 'svc restart web', status: 'used', decidedBy: 'gate', createdAtUs: BigInt(t0 + 601 * S) },
    { id: 12n, target: 'pixel', capability: 'shell.destructive', command: 'rm -rf /', status: 'denied', decidedBy: 'gate', createdAtUs: BigInt(t0 + 905 * S) },
    { id: 13n, target: 'web-1', capability: 'shell.read', command: 'health', status: 'active', decidedBy: 'trust', createdAtUs: BigInt(t0 + 1 * S) },
  ],
  results: [
    { grantId: 10n, device: 'web-1', exitCode: 0, healthOk: true, rolledBack: false, tsUs: BigInt(t0 + 20 * S) },
    { grantId: 11n, device: 'web-1', exitCode: 0, healthOk: true, rolledBack: false, tsUs: BigInt(t0 + 612 * S) },
  ],
  trust: [{ runbookId: 'restart-web', deviceType: 'linux-server', successes: 3, failures: 0, level: 1 }, { runbookId: 'wifi-enable', deviceType: 'android', successes: 0, failures: 1, level: 2 }],
};
const r = buildRecap(rows, { hours: 12, nowUs: t0 + 2000 * S });
let bad = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  lib: ${name}${extra ? '  ' + extra : ''}`); if (!ok) bad++; };
check('old incident outside the window is dropped', r.incidents.length === 3);
check('first incident approved by you, 20 s', r.incidents[0].how === 'approved' && r.incidents[0].seconds === 20, JSON.stringify(r.incidents[0]));
check('second incident fixed alone, 12 s', r.incidents[1].how === 'alone' && r.incidents[1].seconds === 12);
check('escalated incident', r.incidents[2].how === 'escalated' && r.incidents[2].fixed === 'needed a human');
check('counts', r.counts.fixedAlone === 1 && r.counts.approved === 1 && r.counts.blocked === 1 && r.counts.undone === 1 && r.counts.escalated === 1, JSON.stringify(r.counts));
check('cost sums cost.update events', r.cost.usd === 0.003 && r.cost.tokens === 1500 && r.cost.commands === 3 && r.cost.presses === 1 && r.cost.runs === 2, JSON.stringify(r.cost));
check('trust', r.trust.trusted === 1 && r.trust.total === 2 && r.trust.promotedTonight === 1);
check('hours 0 keeps everything', buildRecap(rows, { hours: 0, nowUs: t0 }).incidents.length === 4);
process.exit(bad ? 1 : 0);
