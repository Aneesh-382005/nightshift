// Connection to SpacetimeDB as the gate identity, plus small polling helpers.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '../../agents/common/src/module_bindings/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOKEN_FILE = resolve(HERE, '../.stdb-token');
const URI = process.env.NS_STDB_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.NS_STDB_DB ?? 'nightshift';
const GATE_SECRET = process.env.NS_GATE_SECRET ?? 'tally-gate-dev';

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const nowUs = () => BigInt(Date.now()) * 1000n;

export type Conn = DbConnection;

export async function connectGate(): Promise<Conn> {
  let saved: string | undefined;
  try { if (existsSync(TOKEN_FILE)) saved = readFileSync(TOKEN_FILE, 'utf8').trim() || undefined; } catch { /* no token yet */ }
  const conn = await new Promise<Conn>((resolveConn, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out connecting to ${URI} (is spacetime running? --server local)`)), 10_000);
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(saved)
      .onConnect((c, _identity, token) => {
        if (token && token !== saved) {
          try { writeFileSync(TOKEN_FILE, token, { mode: 0o600 }); } catch (e) { console.error('could not persist token', e); }
        }
        clearTimeout(timer);
        resolveConn(c);
      })
      .onConnectError((_c, err) => { clearTimeout(timer); reject(new Error(`connect error: ${err}`)); })
      .build();
  });
  await new Promise<void>((res, rej) => {
    conn.subscriptionBuilder().onApplied(() => res()).onError(() => rej(new Error('subscription failed'))).subscribeToAllTables();
  });
  await conn.reducers.claimGate({ secret: GATE_SECRET });
  return conn;
}

// Poll until fn returns something other than undefined, or the timeout passes.
export async function until<T>(fn: () => T | undefined, timeoutMs: number, stepMs = 120): Promise<T | undefined> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() >= end) return undefined;
    await sleep(stepMs);
  }
}
