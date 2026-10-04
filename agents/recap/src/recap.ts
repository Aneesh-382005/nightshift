// Read-only viewer. Usage: npx tsx src/recap.ts [--out recap.json] [--hours 12]   (hours 0 = everything)
// Connects with a throwaway identity, claims nothing, calls no reducers.
import fs from 'node:fs';
import { DbConnection } from '../../common/src/module_bindings/index.js';
import { buildRecap } from './recap-lib.js';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('out', 'recap.json');
const hours = Number(arg('hours', '12'));
const URI = process.env.STDB_URI ?? process.env.NIGHTSHIFT_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.NIGHTSHIFT_DB ?? 'nightshift';

const conn = await new Promise<DbConnection>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no connection to ${URI} in 10s`)), 10000);
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { clearTimeout(t); resolve(c); })
    .onConnectError((_c, e) => { clearTimeout(t); reject(new Error(String(e))); })
    .build();
});
await new Promise<void>((res, rej) => {
  const t = setTimeout(() => rej(new Error('subscription timed out')), 15000);
  conn.subscriptionBuilder().onApplied(() => { clearTimeout(t); res(); }).onError(() => rej(new Error('subscription error'))).subscribeToAllTables();
});

const recap = buildRecap({
  incidents: [...conn.db.incident.iter()],
  events: [...conn.db.event.iter()],
  changes: [...conn.db.change.iter()],
  grants: [...conn.db.accessGrant.iter()],
  results: [...conn.db.runResult.iter()],
  trust: [...conn.db.runbookTrust.iter()],
}, { hours, nowUs: Date.now() * 1000 });
fs.writeFileSync(out, JSON.stringify(recap, null, 2));
console.log(`recap.json: ${recap.incidents.length} incidents, fixed alone ${recap.counts.fixedAlone}, approved ${recap.counts.approved}, blocked ${recap.counts.blocked}, undone ${recap.counts.undone}, $${recap.cost.usd}`);
conn.disconnect();
process.exit(0);
