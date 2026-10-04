# SpacetimeDB cheat sheet (TypeScript module + Node client)

Fetched 2026-10-03. Tags: VERIFIED = copied from docs page (URL given). UNVERIFIED = inferred or written from memory, test before relying on it.
Sources:
- S1 https://spacetimedb.com/docs/quickstarts/typescript
- S2 https://spacetimedb.com/docs/databases/cheat-sheet
- S3 https://spacetimedb.com/docs/clients/typescript
- S4 https://spacetimedb.com/docs/tables/schedule-tables
- S5 https://spacetimedb.com/docs/cli-reference
- S6 https://spacetimedb.com/docs/functions/reducers/lifecycle
- S7 https://spacetimedb.com/docs/functions/reducers/reducer-context
- S8 https://spacetimedb.com/docs/tables/column-types
- S9 https://spacetimedb.com/docs/core-concepts/authentication
- S10 https://spacetimedb.com/install
- S11 https://spacetimedb.com/docs/databases/developing

NOTE: the docs fetcher summarized pages, so snippets are verbatim only where noted; prose around them is paraphrase.

## 1. CLI install (VERIFIED, S10, Linux)
```
curl -sSf https://install.spacetimedb.com | sh
```
Requires Node 18+ for TS (S1).

## 2. Local server, init, publish, generate
Start local server (VERIFIED command name, S2/S5; `--listen-addr` / cli.toml `listen_addr = "0.0.0.0:4000"` per S5):
```
spacetime start
```
Default listen port is 3000 (UNVERIFIED; S3 example uses ws://localhost:3000). Offline: `spacetime start` is a local standalone process; docs do not state a login requirement for local. UNVERIFIED that no `spacetime login` is needed. If publish prompts for login, S5 shows `spacetime publish -y skip-login` (VERIFIED flag value list: all, remote, migrate, break-clients, skip-login, delete-data) and `spacetime login --token <TOKEN>` / `--no-browser`. Server-issued-login option is UNVERIFIED.

Init a project (VERIFIED, S1, interactive scaffold with server in `spacetimedb/` and client in `src/`; also runs local server):
```
spacetime dev --template basic-ts
```
`spacetime init [PROJECT_NAME]` also exists (S5, VERIFIED listing; flags like `--lang typescript` UNVERIFIED).
`spacetime dev` rebuilds and republishes on save; "unstable" (S11).

Build / publish (VERIFIED forms, S2/S5):
```
spacetime build
spacetime publish <NAME>                         # -s/--server <SERVER>, -p/--module-path <PATH>
spacetime publish <NAME> --delete-data           # reset DB; -c/--delete-data takes always|on-conflict|never (S5)
```
Add `--server local` to target local explicitly (UNVERIFIED; `-s, --server` is verified, the name "local" is a default server nickname, UNVERIFIED).

Generate client bindings (VERIFIED, S2):
```
spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb
```
(S3 form: `--out-dir client/src/module_bindings --module-path PATH-TO-MODULE-DIRECTORY`.) Re-run after every schema or reducer signature change.

## 3. Module: tables (VERIFIED, S2)
```ts
import { table, t, schema } from 'spacetimedb/server';

const player = table(
  { name: 'player', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string().unique(),
    score: t.i32().index('btree'),
  }
);

const status = t.enum('Status', ['Active', 'Inactive']);   // enum type builder
```
Multi-column index: `table({ name:'score', indexes:[{ accessor:'idx', algorithm:'btree', columns:['playerId','level'] }] }, {...})` (S2).
Type builders (S2): `t.bool() t.string() t.f32() t.f64() t.i8..t.i128() t.u8..t.u128() t.option(T) t.array(T) t.identity() t.connectionId() t.timestamp() t.timeDuration() t.scheduleAt() t.object('Name',{...}) t.enum('Name',[...])`.
Private by default; add `public: true` for clients to subscribe (UNVERIFIED wording, standard behaviour).

Arrays of strings (UNVERIFIED snippet; `t.array(T)` itself is VERIFIED):
```ts
tags: t.array(t.string()),
```
Status field options: `t.enum('Status',['Pending','Done'])` (enum value in TS is a tagged object like `{ tag: 'Pending' }`, UNVERIFIED), or simply `t.string()` with checks in reducer (simplest for a hackathon).
Timestamp column: `t.timestamp()`; duration: `t.timeDuration()`. Both are microsecond based (VERIFIED, S8). Timestamp has `now()`, `fromDate()`, `toDate()`, `microsSinceUnixEpoch` (S8 names; usage shapes UNVERIFIED). `ctx.timestamp.microsSinceUnixEpoch` is a bigint (VERIFIED in S4 snippet).

## 4. Module: reducers (VERIFIED, S2/S1)
```ts
const spacetimedb = schema({ player });   // schema first
export default spacetimedb;

export const createPlayer = spacetimedb.reducer({ username: t.string() }, (ctx, { username }) => {
  ctx.db.player.insert({ id: 0n, username, score: 0 });   // autoInc: pass 0n
});

export const updateScore = spacetimedb.reducer({ id: t.u64(), points: t.i32() }, (ctx, { id, points }) => {
  const p = ctx.db.player.id.find(id);
  if (!p) throw new Error('Player not found');
  p.score += points;
  ctx.db.player.id.update(p);
});
// no-arg reducer: spacetimedb.reducer(ctx => { ... })
```
Queries (S2): `ctx.db.player.id.find(123n)`, `.username.find('Alice')`, `.score.filter(100)`, `ctx.db.player.iter()`, `ctx.db.player.id.delete(123n)`, `ctx.db.player.count()` (returns bigint per S6 `=== 0n`).
Reducer name comes from the export name; CLI/clients use snake_case / camelCase respectively (S1: `sayHello` called as `say_hello`).

## 5. Lifecycle reducers (VERIFIED, S2/S6)
```ts
export const init = spacetimedb.init(ctx => { /* runs on first publish or DB clear */ });
export const onConnect = spacetimedb.clientConnected(ctx => { /* ctx.sender, ctx.connectionId (nullable), ctx.timestamp */ });
export const onDisconnect = spacetimedb.clientDisconnected(ctx => { /* ... */ });
```
Throwing in clientConnected rejects the connection (UNVERIFIED for TS, standard behaviour).

## 6. Scheduled reducers (VERIFIED, S4)
```ts
import { ScheduleAt } from 'spacetimedb';            // NOT 'spacetimedb/server'
import { schema, table, t } from 'spacetimedb/server';

const reminder = table(
  { name: 'reminder' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    message: t.string(),
  }
);
const spacetimedb = schema({ reminder });
export default spacetimedb;

export const sendReminder = spacetimedb.reducer(
  { onSchedule: reminder },
  { arg: reminder.rowType },
  (_ctx, { arg }) => { /* arg.message ... */ }
);

// schedule from any reducer
ctx.db.reminder.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(5_000_000n), message: 'x' }); // every 5s, micros
ctx.db.reminder.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 10_000_000n), message: 'y' }); // once
```
One-shot rows are deleted after firing (UNVERIFIED); interval rows repeat until deleted. Cancel by deleting the row: `ctx.db.reminder.scheduledId.delete(id)` (UNVERIFIED but follows index API).
Docs say prefer `onSchedule` over legacy `scheduled` table option.

## 7. Restricting a reducer to one claimed identity (mostly UNVERIFIED)
`ctx.sender` is the caller Identity (VERIFIED, S7: `const caller = ctx.sender; ctx.db.player.identity.find(caller)`). Pattern, UNVERIFIED:
```ts
const owner = table({ name: 'owner' }, { id: t.u8().primaryKey(), identity: t.identity() });
// claim reducer: if row exists throw new SenderError('already claimed'); else insert {id:1, identity: ctx.sender}
// guarded reducer:
const o = ctx.db.owner.id.find(1);
if (!o || !o.identity.isEqual(ctx.sender)) throw new SenderError('not authorized');
```
Docs do not show Identity equality in TS (S7 fetch said so). `identity.isEqual(other)` and `toHexString()` exist in the SDK (toHexString VERIFIED in S3 examples; isEqual UNVERIFIED). Do not rely on `===` between Identity objects. Safe fallback: compare `a.toHexString() === b.toHexString()`.
`SenderError` import location in module is UNVERIFIED (try `import { SenderError } from 'spacetimedb/server'`). Docs: throw SenderError, plain Error surfaces as internal error (S2 mistake 12).
In `init`, `ctx.sender` is the module owner (S6).
Also available: `ctx.senderAuth` (JWT claims), `ctx.random()` (use instead of Math.random for determinism, S7).

## 8. Node client (S3)
Install and run (VERIFIED):
```
npm install spacetimedb
npx tsx src/script.ts
```
Connect (builder methods VERIFIED, S3; Node specifics and file token store are UNVERIFIED):
```ts
import { DbConnection, tables } from './module_bindings';   // S3: import from './module_bindings/index'
import fs from 'node:fs';

const TOKEN_FILE = '.stdb-token';
const saved = fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : undefined;

const conn = DbConnection.builder()
  .withUri('ws://localhost:3000')
  .withDatabaseName('my-module')
  .withToken(saved)                                  // undefined => new identity issued
  .onConnect((conn, identity, token) => {            // signature VERIFIED
    fs.writeFileSync(TOKEN_FILE, token);             // persist long-lived token (S9 says save server-issued token)
    console.log('id', identity.toHexString());
    conn.subscriptionBuilder()
      .onApplied(ctx => console.log('subscribed'))
      .onError((ctx, err) => console.error(err))
      .subscribe([tables.player, tables.player.where(r => r.score.gt(100))]);
  })
  .onConnectError((ctx, err) => console.error(err))
  .onDisconnect((ctx, err) => console.log('bye', err))
  .build();
```
Other builder: `.withConfirmedReads(bool)`; `conn.disconnect()`; `subscribeToAllTables()` (VERIFIED, S3).
Query builder (VERIFIED, S3): `tables.user`, `tables.user.where(r => r.online.eq(true))`, ops `eq ne lt lte gt gte`, combinators `.and() .or() .not()` or standalone `and/or/not` imported from `./module_bindings`. Semijoins exist (`leftSemijoin`, `rightSemijoin`).
Table callbacks (VERIFIED signatures, S3):
```ts
conn.db.player.onInsert((ctx, row) => {});
conn.db.player.onUpdate((ctx, oldRow, newRow) => {});   // only fires for tables with a primary key (UNVERIFIED)
conn.db.player.onDelete((ctx, row) => {});
// removeOnInsert/removeOnDelete/removeOnUpdate; conn.db.player.iter(), .count()
```
`ctx.event.tag` is 'Reducer' | 'SubscribeApplied' | 'UnsubscribeApplied' | 'Error' | 'Transaction' (VERIFIED).
Register callbacks before or inside onApplied; initial rows arrive as onInsert on subscribe (UNVERIFIED).
Calling reducers (VERIFIED, S3: object args, returns Promise):
```ts
try { await conn.reducers.setName({ name: newName }); }
catch (err) { if (err instanceof SenderError) {...} else if (err instanceof InternalError) {...} }
```
Generated reducer method names are camelCase of the export (UNVERIFIED but implied by S3 `setName`, `createPlayer`).
Node needs a global WebSocket: Node 22+ has one; on older Node the SDK may need `ws` (UNVERIFIED).
Row fields are camelCase (`trip_id` -> `tripId`) and u64/i64 are `bigint` (S2 + S2 `0n`).

## 9. CLI debugging (VERIFIED forms, S1/S2/S5)
```
spacetime call <NAME> create_player Alice        # [DATABASE] <FUNCTION_NAME> [ARGS...]
spacetime sql <NAME> "SELECT * FROM player"
spacetime logs <NAME>                            # --follow to stream
spacetime describe <NAME> --json
```
S1 shows omitting the database name (`spacetime call add Alice`) works inside a project with spacetime.json. Args are positional, JSON-ish values; strings may need quoting like `'"Alice"'` (UNVERIFIED). Enum/array arg syntax UNVERIFIED.

## 10. Wipe / reset local DB
VERIFIED (S2):
```
spacetime publish <NAME> --delete-data     # keep server, wipe this DB, reruns init
spacetime delete <NAME>                    # S11 pages: add --yes to skip prompt
```
Nuclear option (UNVERIFIED): stop `spacetime start`, delete the local data dir (commonly `~/.local/share/spacetime/data`; confirm with `spacetime start --help`), restart.

## 11. Common pitfalls
From S2 (VERIFIED):
1. `ScheduleAt` imports from 'spacetimedb', not 'spacetimedb/server'.
2. Define `const spacetimedb = schema({...})` before reducers/init/lifecycle; `export default spacetimedb`.
3. Import module APIs from `spacetimedb/server`; no `ReducerContext` import, use `ctx`.
4. Only export schema, reducers, init, clientConnected, clientDisconnected, views (a stray export may break the module).
5. `t.object` not `t.struct`; `.autoInc()` not `.autoIncrement()`.
6. Row fields are camelCase on TS side.
7. Await client reducer calls; they reject with SenderError. Throw SenderError in reducers, plain Error becomes an internal error.
8. Reducers are deterministic and sandboxed: no Math.random or Date.now; use `ctx.random()` and `ctx.timestamp`. No network in reducers (use procedures with `ctx.http.fetch`, S2).
9. u64/i64 values are bigint; pass `0n` for autoInc columns.
10. Do not overwrite a saved long-lived token with a short-lived one (S9).
11. Regenerate bindings after schema changes; subscribing to a private table returns nothing.
12. `ctx.connectionId` is nullable in TS (S6).
13. `spacetime dev` and `spacetime call` are marked unstable in the docs.
