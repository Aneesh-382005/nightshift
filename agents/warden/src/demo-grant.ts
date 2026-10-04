// Test helper: acts as the GATE to create grants, changes and events so the warden can be tested
// end to end in sim. WARNING: claimGate replaces the current gate identity, so stop the real hub
// gateway first (it will have to claim the gate again).
//   npx tsx src/demo-grant.ts grant [--cap shell.write] [--cmd "systemctl restart web"] [--device demo-box]
//   npx tsx src/demo-grant.ts change [--cmd ...] [--inverse ...]     records an applied change (for the undo button)
//   npx tsx src/demo-grant.ts block "delete files in /home"          pending grant then gateDeny (red, policy)
//   npx tsx src/demo-grant.ts auto | escalate | healthy | promote     emit the matching event
//   npx tsx src/demo-grant.ts status                                 print grants and changes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../common/src/module_bindings/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.resolve(here, '../.stdb-token-gate');
const cmdName = process.argv[2] ?? 'grant';
const rest = process.argv.slice(3);
function arg(name: string, def: string): string {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
}
const device = arg('device', 'demo-box');

const conn = await new Promise<DbConnection>((resolve, reject) => {
  const saved = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : undefined;
  DbConnection.builder().withUri('ws://127.0.0.1:3000').withDatabaseName('nightshift').withToken(saved)
    .onConnect((c, _id, token) => { fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 }); resolve(c); })
    .onConnectError((_c, e) => reject(new Error(String(e)))).build();
});
await new Promise<void>(r => conn.subscriptionBuilder().onApplied(() => r())
  .subscribe([tables.device, tables.accessGrant, tables.change, tables.event]));

if (cmdName !== 'status') {
  await conn.reducers.claimGate({ secret: 'tally-gate-dev' });
  if (!conn.db.device.id.find(device)) {   // never touch a real device row
    await conn.reducers.registerDevice({ id: device, name: 'Demo box', kind: 'linux', capabilities: ['shell.read', 'shell.write'] });
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const newestGrantId = () => [...conn.db.accessGrant.iter()].reduce((m, g) => (g.id > m ? g.id : m), 0n);

if (cmdName === 'grant') {
  const cap = arg('cap', 'shell.write');
  const command = arg('cmd', 'systemctl restart web');
  await conn.reducers.requestGrant({
    requester: 'agent', target: device, capability: cap, reason: 'demo', command,
    plan: '{}', ttlSeconds: 60, autoApprove: false,
  });
  await sleep(400);
  console.log(`created grant #${newestGrantId()} (${cap}) pending: ${command}`);
} else if (cmdName === 'change') {
  await conn.reducers.recordChange({
    grantId: 0n, device, command: arg('cmd', 'systemctl restart web'), preState: '{}',
    inverseCommand: arg('inverse', 'systemctl start web'), irreversible: false,
  });
  await sleep(400);
  console.log('recorded an applied change');
} else if (cmdName === 'block') {
  const command = rest[0] ?? 'rm -rf /home';
  await conn.reducers.requestGrant({
    requester: 'agent', target: device, capability: 'shell.destructive', reason: 'hostile log line', command,
    plan: '{}', ttlSeconds: 60, autoApprove: false,
  });
  await sleep(300);
  await conn.reducers.gateDeny({ grantId: newestGrantId(), reason: `forbidden pattern: ${command}` });
  console.log('grant created and denied by policy');
} else if (cmdName === 'auto') {
  await conn.reducers.logEvent({ kind: 'fix.autonomous', device, grantId: 0n, detail: 'restart-web' });
} else if (cmdName === 'healthy') {
  await conn.reducers.logEvent({ kind: 'health.passed', device, grantId: 0n, detail: 'exit 0' });
} else if (cmdName === 'promote') {
  await conn.reducers.logEvent({ kind: 'trust.promoted', device: 'linux-server', grantId: 0n, detail: 'restart-web' });
} else if (cmdName === 'escalate') {
  await conn.reducers.logEvent({ kind: 'incident.escalated', device, grantId: 0n, detail: '#1' });
} else if (cmdName === 'status') {
  for (const g of conn.db.accessGrant.iter()) console.log(`grant #${g.id} ${g.target} ${g.capability} ${g.status} by=${g.decidedBy} :: ${g.command}`);
  for (const c of conn.db.change.iter()) console.log(`change #${c.id} ${c.device} ${c.status} :: ${c.command} (undo: ${c.inverseCommand})`);
  const evs = [...conn.db.event.iter()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 8);
  for (const e of evs) console.log(`event #${e.id} ${e.kind} ${e.device} ${e.detail}`);
} else console.log('unknown command');
await sleep(300);
conn.disconnect();
process.exit(0);
