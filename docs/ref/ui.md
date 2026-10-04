# UI cheat sheet: Vite + React + TS dashboard on SpacetimeDB (phone over LAN)

Tags: VERIFIED = text seen in fetched docs on 2026-10-03. UNVERIFIED = from memory or inference, test it.
Sources:
- S1 https://spacetimedb.com/docs/clients/typescript (also fetched with trailing slash)
- S2 https://spacetimedb.com/docs/quickstarts/react
- V1 https://vite.dev/guide/
- V2 https://vite.dev/config/server-options
- https://spacetimedb.com/docs/clients/react returned 404 (React docs live inside S1)

## 1. Scaffold (VERIFIED, V1)
```bash
npm create vite@latest ui -- --template react-ts
cd ui && npm install
npm install spacetimedb
```
Vite needs Node 20.19+ or 22.12+ (V1).
Fastest alternative (VERIFIED, S2): `spacetime dev --template react-ts` creates server + client, runs local server and Vite. Layout: `spacetimedb/src/index.ts`, `src/App.tsx`, `module_bindings/`.

## 2. Generate bindings (VERIFIED, S1)
```bash
mkdir -p src/module_bindings
spacetime generate --lang typescript \
  --out-dir src/module_bindings \
  --module-path PATH-TO-MODULE-DIRECTORY
```
Re-run after every schema or reducer change. Exports used below: `DbConnection`, `tables`, `reducers`.

## 3. Official React integration EXISTS (VERIFIED, S1)
Import path is `spacetimedb/react` (same npm package, no extra install).
```tsx
import { SpacetimeDBProvider, useTable, useReducer } from 'spacetimedb/react';
import { DbConnection, tables, reducers } from './module_bindings';

const connectionBuilder = DbConnection.builder()
  .withUri('ws://192.168.1.50:3000')      // laptop LAN IP
  .withDatabaseName('my-module')
  .onConnect((conn, identity, token) => {
    conn.subscriptionBuilder().subscribe(tables.player);
  });

<SpacetimeDBProvider connectionBuilder={connectionBuilder}><App/></SpacetimeDBProvider>
```
- `useTable(tables.x)` returns `[rows, isReady]` tuple; `isReady` = subscription applied (VERIFIED).
- `useReducer(reducers.createPlayer)` returns a callable, `fn({ name: 'Alice' })` (VERIFIED).
- `tables.x.where(r => r.online.eq(true))` filters; ops eq/ne/lt/lte/gt/gte, `.and() .or() .not()` (VERIFIED).
- Note: the doc's provider example calls `.onConnect((conn, identity, token)` with `conn` as first arg, while the plain example uses `(ctx, identity, token)`. Both are the same object type in practice. UNVERIFIED which is exact, so check types in the generated bindings.
- UNVERIFIED: whether useTable alone subscribes. Safe: also subscribe in onConnect as in the doc, then useTable just reads the cache.

## 4. Plain (non-React) connection (VERIFIED, S1)
```ts
const conn = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withDatabaseName('my-module')   // older SDKs: withModuleName (UNVERIFIED which your version has)
  .withToken(localStorage.getItem('spacetime_token') ?? undefined)   // withToken VERIFIED, ?? undefined UNVERIFIED
  .onConnect((ctx, identity, token) => localStorage.setItem('spacetime_token', token))
  .onDisconnect((ctx, error) => console.log('Disconnected'))
  .build();
conn.subscriptionBuilder()
  .onApplied(ctx => console.log('ready'))
  .subscribe([tables.devices, tables.grants, tables.events, tables.changes]);   // array form VERIFIED
```
Token storage: docs say save token from onConnect and pass to `withToken` (VERIFIED). Using localStorage is the doc's own example. Without it each page load is a new identity.
Row callbacks (VERIFIED): `conn.db.user.onInsert((ctx,row)=>..)`, `onDelete`, `onUpdate((ctx,old,new)=>..)`, remove with `removeOnInsert(fn)`.
Unsubscribe removes rows from cache and fires onDelete (VERIFIED).

## 5. LAN setup so the phone works
Vite dev server (VERIFIED, V2): default host is localhost. Use CLI `vite --host` or `--host 0.0.0.0`, or in config:
```ts
// vite.config.ts   (server.host true/'0.0.0.0' VERIFIED)
export default defineConfig({ plugins: [react()], server: { host: true, port: 5173 } })
```
```bash
npm run dev -- --host        # prints Network: http://192.168.x.x:5173
```
SpacetimeDB must also accept LAN connections. UNVERIFIED: `spacetime start --listen-addr 0.0.0.0:3000` (default listens on 127.0.0.1:3000 I believe; check `spacetime start --help`).
Derive host so one build works on laptop and phone (UNVERIFIED but plain browser JS):
```ts
const HOST = import.meta.env.VITE_STDB_HOST ?? window.location.hostname; // page loaded from laptop IP
const URI = `ws://${HOST}:3000`;
```
Pitfalls:
- Never use `localhost` in the URI; on the phone it means the phone.
- Page served over http, so ws:// (not wss://) is allowed. If you ever serve the page over https, browsers block ws:// (mixed content). UNVERIFIED for your setup, but standard browser rule.
- Vite `server.allowedHosts` and `server.cors` (VERIFIED, V2): defaults allow IP addresses, so hitting http://IP:5173 works. A custom hostname (mDNS name, tunnel) needs `allowedHosts` entry. Do not set true.
- CORS does not apply to the Vite page connecting to SpacetimeDB over a WebSocket; browsers do not enforce CORS on ws. I found no doc on SpacetimeDB origin checks. UNVERIFIED: expect none.
- Laptop firewall must allow inbound 5173 and 3000 (ufw: `sudo ufw allow 3000,5173/tcp`). Phone and laptop must be on the same subnet (some venue Wi-Fi uses client isolation; use phone hotspot or laptop hotspot instead).
- iOS Safari throttles background tabs, so reconnect on `visibilitychange` (UNVERIFIED pattern).
- Alternative that avoids port 3000 exposure: Vite proxy with `ws: true` (VERIFIED feature in V2): `server.proxy: { '/v1': { target: 'ws://localhost:3000', ws: true } }`, then URI `ws://${location.host}`. The `/v1` route prefix is UNVERIFIED.

## 6. Rendering live tables efficiently (patterns, UNVERIFIED unless noted)
```tsx
function Devices() {
  const [devices, ready] = useTable(tables.devices);          // VERIFIED shape
  if (!ready) return <p>Connecting...</p>;
  return <ul>{devices.map(d => <DeviceRow key={d.id.toString()} d={d}/>)}</ul>;
}
const DeviceRow = React.memo(DeviceRowImpl);
```
- Use stable `key` (primary key; bigint needs `.toString()`; Identity needs `.toHexString()` VERIFIED).
- Subscribe narrowly: use `.where()` filters (VERIFIED) to keep payload small; subscribe once at the provider level, not per component.
- Events/changes logs: sort and slice client side, `useMemo(() => [...events].sort((a,b)=>Number(b.id-a.id)).slice(0,50), [events])`. Numbers in generated bindings: u64 is `bigint`; Timestamp objects have `.toDate()` (UNVERIFIED, check bindings).
- One `useTable` per table; derive joins (device to grant) with a `Map` in `useMemo`.
- No charting needed: tallies and sparklines can be CSS or plain SVG. If a chart is wanted later: uPlot (tiny) UNVERIFIED.

## 7. Reducers from buttons
```tsx
const grantAccess = useReducer(reducers.grantAccess);     // VERIFIED hook
<button onClick={() => grantAccess({ deviceId: d.id, level: 2 })}>Grant</button>
```
Non-React (VERIFIED): `await conn.reducers.setName({ name: 'Alice' })` inside try/catch; args are one object with named fields. Reducer names are camelCase in TS bindings (snake_case in module becomes camelCase, UNVERIFIED but implied by `setName`/`onSetName`). Result observed through table updates, not return values. Disable button on touch for 300ms to avoid double taps (UNVERIFIED pattern).

## 8. Animated tally light driven by rows (UNVERIFIED, plain React + CSS)
```tsx
type Status = 'live' | 'armed' | 'off';
function Tally({ status }: { status: Status }) {
  return <span className={`tally ${status}`} aria-label={status} />;
}
```
```css
.tally{display:inline-block;width:20px;height:20px;border-radius:50%;
  background:#333;transition:background .25s, box-shadow .25s;}
.tally.live{background:#ff2d2d;box-shadow:0 0 14px 4px #ff2d2d;animation:pulse 1.2s infinite;}
.tally.armed{background:#ffb000;box-shadow:0 0 10px 2px #ffb000;}
@keyframes pulse{50%{box-shadow:0 0 4px 1px #ff2d2d}}
@media (prefers-reduced-motion:reduce){.tally.live{animation:none}}
```
Derive status from rows, e.g. `const status = grants.some(g => g.deviceId === d.id && g.active) ? 'live' : 'off'`. A one-shot flash on a new event row: key the element by the event id so React remounts and replays a CSS animation, or use `conn.db.events.onInsert` to set a transient state. Animate only `opacity`, `transform`, `box-shadow` for phone performance.

## 9. Free fonts (UNVERIFIED, from memory; all OFL, self-host via Fontsource so no internet is needed on venue LAN)
`npm i @fontsource-variable/inter @fontsource/jetbrains-mono @fontsource/space-grotesk`
then `import '@fontsource-variable/inter'` in main.tsx. Good picks: Inter (UI), JetBrains Mono (ids, logs), Space Grotesk (headings), IBM Plex Mono. Self-hosting matters: Google Fonts CDN will fail on an offline hotspot.

## 10. Minimal main.tsx with token reuse (UNVERIFIED composite of verified parts)
```tsx
const builder = DbConnection.builder()
  .withUri(URI).withDatabaseName('my-module')
  .withToken(localStorage.getItem('stdb_token') ?? undefined)
  .onConnect((conn, _id, token) => {
    localStorage.setItem('stdb_token', token);
    conn.subscriptionBuilder().subscribe([tables.devices, tables.grants, tables.events, tables.changes]);
  });
createRoot(document.getElementById('root')!).render(
  <SpacetimeDBProvider connectionBuilder={builder}><App/></SpacetimeDBProvider>);
```
Create the builder at module scope (as in docs), not inside a component, or StrictMode will reconnect twice.

## 11. Checklist
1. `spacetime generate` after schema change.
2. `npm run dev -- --host`; open the Network URL on phone.
3. URI uses laptop IP, `ws://`, port 3000, server listening on 0.0.0.0.
4. Firewall open; same subnet; no client isolation.
5. Verify `withDatabaseName` vs `withModuleName` against installed version: `grep -n "withDatabaseName\|withModuleName" node_modules/spacetimedb/dist/*.d.ts`.
