import fs from 'node:fs';
import path from 'node:path';
import { DbConnection } from '../../common/src/module_bindings/index.js';

export const URI = process.env.STDB_URI ?? process.env.NIGHTSHIFT_URI ?? 'ws://127.0.0.1:3000';
export const DB = process.env.NIGHTSHIFT_DB ?? 'nightshift';
export const STATE_DIR = path.resolve(import.meta.dirname, '..', '.state');

/** Connect with a persisted token so the identity (and device ownership) survives restarts. */
/** exitOnLost: the executor wants a restart (systemd or demo/up.sh) rather than a zombie. Tests leave it off. */
export function connect(label: string, tokenName?: string, exitOnLost = false): Promise<DbConnection> {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tokenFile = tokenName ? path.join(STATE_DIR, `${tokenName}.token`) : undefined;
  const saved = tokenFile && fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : undefined;
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .withToken(saved)
      .onConnect((conn, _identity, token) => {
        if (tokenFile) fs.writeFileSync(tokenFile, token, { mode: 0o600 });
        resolve(conn);
      })
      .onDisconnect((_c, err) => {
        if (!exitOnLost) return;
        console.error(`[${label}] db connection lost${err ? `: ${err}` : ''}`);
        process.exit(1);
      })
      .onConnectError((_c, err) => reject(new Error(`${label}: ${err}`)))
      .build();
  });
}
