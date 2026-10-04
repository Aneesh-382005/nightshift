// Identity and device checks for demo/doctor.sh. Prints one JSON line per check: {"name","ok","critical","detail"}.
// Uses the hub's gate token to probe gate-only reducers with a bad id: the error text tells gate from not-gate.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DbConnection } from '../../agents/common/src/module_bindings/index.js';

const ROOT = resolve(import.meta.dirname, '../..');
const out = (name: string, ok: boolean, detail: string, critical = true) => console.log(JSON.stringify({ name, ok, critical, detail }));
const tokenOf = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : undefined);

function connect(token?: string): Promise<DbConnection> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 6000);
    DbConnection.builder().withUri(process.env.NS_STDB_URI ?? 'ws://127.0.0.1:3000').withDatabaseName('nightshift').withToken(token)
      .onConnect(c => { clearTimeout(t); res(c); }).onConnectError((_c, e) => { clearTimeout(t); rej(new Error(String(e))); }).build();
  });
}
const sub = (c: DbConnection) => new Promise<void>((res, rej) => c.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('subscription'))).subscribeToAllTables());
const errText = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return String((e as Error).message ?? e); } };

try {
  const hubTok = tokenOf(resolve(ROOT, 'hub/.stdb-token'));
  const c = await connect(hubTok);
  await sub(c);
  out('database reachable', true, 'ws connect + subscribe ok');

  // gate: updateRequest is gate-only; a bad id gives "no such request" for the gate, "gate only" for anyone else
  const g = hubTok ? await errText(c.reducers.updateRequest({ id: 0n, status: 'x', result: '' })) : 'no hub token yet';
  out('gate claimed by the hub identity', /no such request/.test(g), /gate only/.test(g) ? 'someone else holds the gate (a test script?). Restart the hub: demo/up.sh restart hub' : g.slice(0, 120));

  // warden: requestRollback is warden-only
  const wTok = tokenOf(resolve(ROOT, 'agents/warden/.stdb-token'));
  if (wTok) {
    const w = await connect(wTok);
    const e = await errText(w.reducers.requestRollback({ changeId: 0n }));
    out('warden claimed by the warden process', /no such change/.test(e), /warden only/.test(e) ? 'someone else holds the warden (CLI identity or a test). Restart the warden: demo/up.sh restart warden' : e.slice(0, 120));
    w.disconnect();
  } else out('warden claimed by the warden process', false, 'agents/warden/.stdb-token missing (warden never ran)');

  const want = (process.env.NS_DEVICES ?? 'web-1,web-2,laptop,pixel').split(',');
  for (const id of want) {
    const d = c.db.device.id.find(id);
    out(`device ${id} online`, d?.status === 'online', d ? d.status : 'never registered', id === 'web-1' || id === 'web-2');
  }
  let open = 0; for (const i of c.db.incident.iter()) if (i.status === 'open') open++;
  out('no stale open incidents', open === 0, open ? `${open} open (they silence the monitor): demo/reset-all.sh --keep-db` : 'none', false);
  c.disconnect();
} catch (e) {
  out('database reachable', false, (e as Error).message);
}
process.exit(0);
