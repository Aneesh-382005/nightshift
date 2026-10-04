// Security smoke test. Run: npx tsx src/test-auth.ts
// Expects the module published as `nightshift` on ws://127.0.0.1:3000 and the CLI identity
// to be the warden (claimed with: spacetime call nightshift claim_warden '"tally-warden-dev"').
import { DbConnection } from './module_bindings/index.js';

const URI = 'ws://127.0.0.1:3000';
const DB = 'nightshift';

function connect(label: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect(conn => resolve(conn))
      .onConnectError((_c, err) => reject(new Error(`${label}: ${err}`)))
      .build();
  });
}

async function expectFail(label: string, p: Promise<unknown>) {
  try { await p; console.log(`FAIL  ${label}: call succeeded but should have been rejected`); process.exitCode = 1; }
  catch (e) { console.log(`ok    ${label}: rejected (${(e as Error).message ?? e})`); }
}
async function expectOk(label: string, p: Promise<unknown>) {
  try { await p; console.log(`ok    ${label}`); }
  catch (e) { console.log(`FAIL  ${label}: ${(e as Error).message ?? e}`); process.exitCode = 1; }
}

const gate = await connect('gate');
const impostor = await connect('impostor');
const exec = await connect('executor');

// 1. wrong secrets are refused
await expectFail('impostor claims gate with wrong secret', impostor.reducers.claimGate({ secret: 'nope' }));
await expectFail('impostor claims warden with wrong secret', impostor.reducers.claimWarden({ secret: 'nope' }));

// 2. real gate claims, executor registers a device
await expectOk('gate claims gate', gate.reducers.claimGate({ secret: 'tally-gate-dev' }));
await expectOk('executor registers device', exec.reducers.registerDevice({
  id: 'test-box', name: 'Test box', kind: 'linux', capabilities: ['shell.read', 'shell.write'],
}));

// 3. only the gate may request grants
await expectFail('impostor requests a grant', impostor.reducers.requestGrant({
  requester: 'agent', target: 'test-box', capability: 'shell.write', reason: 'x',
  command: 'systemctl restart nginx', plan: '{}', ttlSeconds: 60, autoApprove: true,
}));
await expectOk('gate requests a shell.write grant (pending)', gate.reducers.requestGrant({
  requester: 'agent', target: 'test-box', capability: 'shell.write', reason: 'restart',
  command: 'systemctl restart nginx', plan: '{}', ttlSeconds: 60, autoApprove: false,
}));
await expectOk('gate requests a destructive grant with autoApprove (must stay pending)', gate.reducers.requestGrant({
  requester: 'agent', target: 'test-box', capability: 'shell.destructive', reason: 'delete',
  command: 'rm -rf /var/log/old', plan: '{}', ttlSeconds: 60, autoApprove: true,
}));

// 4. nobody but the warden can approve or kill
await expectFail('impostor decides grant', impostor.reducers.decideGrant({ grantId: 1n, approve: true, ttlSeconds: 60 }));
await expectFail('gate decides grant (gate is not the warden)', gate.reducers.decideGrant({ grantId: 1n, approve: true, ttlSeconds: 60 }));
await expectFail('executor decides grant', exec.reducers.decideGrant({ grantId: 1n, approve: true, ttlSeconds: 60 }));
await expectFail('impostor revokes all', impostor.reducers.revokeAll({}));

// 5. executor cannot consume a pending grant
await expectFail('executor consumes a pending grant', exec.reducers.consumeGrant({ grantId: 1n }));

console.log('\nNext, as the CLI warden:');
console.log('  spacetime call nightshift decide_grant 1 true 60');
console.log('  spacetime sql nightshift "SELECT id, capability, status, decided_by FROM access_grant"');
for (const c of [gate, impostor, exec]) c.disconnect();
