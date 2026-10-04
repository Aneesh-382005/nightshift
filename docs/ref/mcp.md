# MCP cheat sheet (TypeScript server, Node 22, Codex CLI, Claude Code)

Checked 2026-10-03. Tags: VERIFIED = copied from the fetched doc or source; UNVERIFIED = my inference or from memory, test before trusting.

## 0. TL;DR on blocking tools (read first)

- Codex CLI: `tool_timeout_sec` default is 60 s (VERIFIED, learn.chatgpt.com MCP page). A tool that blocks "up to 60 s" will race the timeout. Set `tool_timeout_sec = 120` or more.
- Claude Code: no short default. `MCP_TOOL_TIMEOUT` defaults to ~28 hours, but there is an idle timeout (5 min HTTP/SSE/WS, 30 min stdio) and calls longer than 2 min auto-move to a background task (VERIFIED, code.claude.com/docs/en/mcp).
- Claude Code: progress notifications reset only the idle timeout, never the wall-clock `MCP_TOOL_TIMEOUT` (VERIFIED).
- TS SDK client default request timeout is 60000 ms (`DEFAULT_REQUEST_TIMEOUT_MSEC`, VERIFIED in v1.x `src/shared/protocol.ts`). `resetTimeoutOnProgress` defaults to false, so progress does not extend it unless the client opts in. This only affects clients built with the SDK, not Codex or Claude Code.
- Safest design for human-in-the-loop waits: return before 60 s (e.g. wait max ~50 s, return text "pending, call check_reply again"), or raise client timeouts. Do not rely on progress to keep Codex alive (UNVERIFIED whether Codex resets on progress).

## 1. Packages and install

Two generations exist on npm.

- v2 (current docs on `main`): split packages. VERIFIED (docs/get-started/packages.md):
```sh
npm install @modelcontextprotocol/server   # expose tools, resources, prompts
npm install @modelcontextprotocol/client   # connect to servers and call them
npm install @modelcontextprotocol/express @modelcontextprotocol/node express   # HTTP adapters
```
  npm registry shows `@modelcontextprotocol/server` 2.3.0 with engines node >=20 (VERIFIED via registry.npmjs.org). Zod import in v2 docs: `import * as z from 'zod/v4'`; install `zod` too (UNVERIFIED that it is not auto-installed).
- v1 (legacy single package): `@modelcontextprotocol/sdk` 1.32.0, engines node >=18 (VERIFIED via registry). Deep imports like `@modelcontextprotocol/sdk/server/mcp.js`. Docs say v1 uses `StdioServerTransport` + `server.connect`, and `StreamableHTTPServerTransport` per request (VERIFIED, "Coming from v1" notes). I did not fetch a v1 code sample, so any v1 snippet from memory is UNVERIFIED.
- Pick v2 `@modelcontextprotocol/server` for new code unless a tutorial forces v1. Node 22 satisfies both (Inspector needs Node >= 22.19.0).

Sources: https://github.com/modelcontextprotocol/typescript-sdk (docs/get-started/packages.md), https://registry.npmjs.org/@modelcontextprotocol/server/latest

## 2. Stdio server (v2)

VERIFIED (docs/get-started + docs/serving/stdio.md, imports and registerTool shape):
```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const handle = serveStdio(() => {
    const server = new McpServer({ name: 'notes', version: '1.0.0' });
    server.registerTool(
        'greet',
        { description: 'Greet someone by name', inputSchema: z.object({ name: z.string() }) },
        async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}!` }] })
    );
    return server;
});
```
(The registerTool call is from the README greet example; the serveStdio wrapper is from stdio.md. Combined here: UNVERIFIED as a single file, but each part is verbatim.)

Alternative from README, VERIFIED: `const transport = new StdioServerTransport(); await server.connect(transport);` with `StdioServerTransport` from `@modelcontextprotocol/server/stdio`.

Rule (VERIFIED): never `console.log` in a stdio server. stdout is the JSON-RPC channel. Use `console.error`.

Run on Node 22: compile with tsc or run `node --experimental-strip-types server.ts` (UNVERIFIED flag behavior, Node 22.6+; 22.18+ strips types by default).

Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md

## 3. Streamable HTTP server (v2, Express)

VERIFIED (docs/serving/express.md):
```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'notes', version: '1.0.0' });
    server.registerTool('add-note', { description: 'Append a note', inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({
        content: [{ type: 'text', text: `Saved: ${text}` }]
    }));
    return server;
});

const app = createMcpExpressApp();
const node = toNodeHandler(handler);
app.all('/mcp', (req, res) => void node(req, res, req.body));
```
Add to make it listen (UNVERIFIED, standard Express): `app.listen(3000, '127.0.0.1');`

Notes (VERIFIED, docs/serving/http.md):
- The factory runs once per HTTP request (stateless). Register tools inside the factory. Keep shared state (pending-human-request map) at module scope, not in the factory.
- Handler answers with JSON, and upgrades to SSE only when a tool emits a notification (progress, logging) before its result. `createMcpHandler(factory, { responseMode: 'json' })` never streams and DROPS progress notifications; `'sse'` always streams.
- The handler validates no Host/Origin/token. `createMcpExpressApp()` arms DNS rebinding checks on localhost binds.
- Plain node:http mount (VERIFIED): `createServer((req,res)=>{ ... void nodeHandler(req,res); }).listen(3000,'127.0.0.1')` with `localhostHostValidation()` and `localhostOriginValidation()` from `@modelcontextprotocol/node`.
- Client URL is then `http://127.0.0.1:3000/mcp`.

Source: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md and express.md

## 4. Results and errors

VERIFIED (docs/servers/errors.md):
```ts
async ({ id }) => {
    const note = notes.get(id);
    if (!note) {
        return {
            content: [{ type: 'text', text: `No note with id "${id}". Known ids: ${[...notes.keys()].join(', ')}` }],
            isError: true
        };
    }
    return { content: [{ type: 'text', text: note }] };
}
```
- Text result: `{ content: [{ type: 'text', text: '...' }] }`.
- Throwing inside a tool handler is converted by the SDK to the same `isError: true` result, with the message as text. `outputSchema` validation is skipped on `isError` results.
- Put the recovery hint in `text`; the model only sees that.
- `ProtocolError` is for resources, prompts, completion (v1 name: `McpError`).

## 5. Tool that blocks up to 60 s for a human

Progress + cancellation, VERIFIED (docs/servers/logging-progress-cancellation.md, v2 API: `ctx` is the 2nd handler arg):
```ts
async ({ files }, ctx) => {
    const progressToken = ctx.mcpReq._meta?.progressToken;
    // ...
    if (progressToken !== undefined) {
        await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: i + 1, total: files.length, message: `Processed ${files[i]}` }
        });
    }
}
```
Cancellation, VERIFIED: `ctx.mcpReq.signal` is an `AbortSignal`, aborted on `notifications/cancelled` and on connection close. Check `ctx.mcpReq.signal.aborted`.

Spec rules, VERIFIED (modelcontextprotocol.io/specification/latest/basic/utilities/progress): client must put `_meta.progressToken` in the request; `progress` MUST increase each notification; `total` and `message` optional; server may send none if no token was given.

Composed pattern, UNVERIFIED (assembled from verified pieces; test it):
```ts
const pending = new Map<string, (answer: string) => void>(); // module scope; resolved by your web UI / webhook

server.registerTool(
  'ask_human',
  { description: 'Ask a human and wait', inputSchema: z.object({ id: z.string(), question: z.string() }) },
  async ({ id, question }, ctx) => {
    const token = ctx.mcpReq._meta?.progressToken;
    const MAX_MS = 50_000; // stay under Codex 60 s default
    const answer = await new Promise<string | null>((resolve) => {
      const t = setTimeout(() => resolve(null), MAX_MS);
      const onAbort = () => { clearTimeout(t); pending.delete(id); resolve(null); };
      ctx.mcpReq.signal.addEventListener('abort', onAbort, { once: true });
      pending.set(id, (a) => { clearTimeout(t); resolve(a); });
      // TODO notify your human channel with `question`
    });
    pending.delete(id);
    if (answer === null) return { content: [{ type: 'text', text: 'No answer yet. Call ask_human again with the same id.' }] };
    return { content: [{ type: 'text', text: answer }] };
  }
);
```
Add a progress ticker (setInterval every ~10 s calling `ctx.mcpReq.notify`, with an increasing `progress`) to defeat Claude Code's idle timeout. Not needed for 60 s waits there (idle window is 5 min), but harmless. With `responseMode: 'json'` progress is dropped.

## 6. Client timeouts

| Client | Setting | Default | Source |
|---|---|---|---|
| Codex CLI | `tool_timeout_sec` | 60 s | VERIFIED learn.chatgpt.com/docs/extend/mcp |
| Codex CLI | `startup_timeout_sec` | 10 s | VERIFIED same |
| Claude Code | `MCP_TOOL_TIMEOUT` (ms, wall clock, all servers) | ~28 h | VERIFIED code.claude.com/docs/en/mcp |
| Claude Code | `MCP_TIMEOUT` (ms, startup) | ~28 h | VERIFIED same |
| Claude Code | per-server `"timeout"` in `.mcp.json` (ms, >=1000) | none | VERIFIED same |
| Claude Code | `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (ms, 0 disables) | 5 min HTTP/SSE/WS, 30 min stdio | VERIFIED same |
| Claude Code | `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (0 disables) | 2 min | VERIFIED same (page text says "default 2000ms = 2 minutes", inconsistent; trust 2 min?) UNVERIFIED |
| TS SDK Client | `timeout` request option / `DEFAULT_REQUEST_TIMEOUT_MSEC` | 60000 ms | VERIFIED v1.x protocol.ts |
| TS SDK Client | `resetTimeoutOnProgress`, `maxTotalTimeout` | false / none | VERIFIED v1.x protocol.ts |

Claude Code: progress notifications do NOT extend wall-clock timeouts, only idle. A call over 2 min in the main conversation is backgrounded (shows in `/tasks`).

## 7. Codex CLI registration

Add (VERIFIED, learn.chatgpt.com/docs/extend/mcp):
```bash
codex mcp add <server-name> --env VAR1=VALUE1 -- <stdio-command>
codex mcp add context7 -- npx -y @upstash/context7-mcp
```
Config file `~/.codex/config.toml` (path UNVERIFIED, standard). Keys VERIFIED: stdio `command`, `args`, `env`, `startup_timeout_sec`, `tool_timeout_sec`; HTTP `url`, `bearer_token_env_var`, `enabled_tools`, `disabled_tools`. Source struct (openai/codex `mcp_types.rs`) also has `startup_timeout_ms` (alt to sec) and a per-server `tool_timeout_sec`; VERIFIED by grep.

Example, UNVERIFIED as a whole (keys verified, layout assumed from `[mcp_servers.<name>]` in the task brief):
```toml
[mcp_servers.humanloop]
command = "node"
args = ["/abs/path/build/server.js"]
env = { LOG = "1" }
startup_timeout_sec = 20
tool_timeout_sec = 120     # raise above your max human wait

[mcp_servers.humanloop_http]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "HUMANLOOP_TOKEN"
tool_timeout_sec = 120
```
`codex mcp add` for HTTP: flag name UNVERIFIED (check `codex mcp add --help`; likely `--url`). Other subcommands (`codex mcp list`, `get`, `remove`) UNVERIFIED.

## 8. Claude Code registration

VERIFIED (code.claude.com/docs/en/mcp):
```bash
claude mcp add --transport http <name> <url>
claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable -- npx -y airtable-mcp-server
claude mcp add --transport http shared-server --scope project https://example.com/mcp
```
`--` separates Claude options from the server command. Scopes: `local` (default, this project only, stored in `~/.claude.json`), `project` (`.mcp.json` in repo root, shared via VCS), `user` (all projects, `~/.claude.json`).

`.mcp.json` VERIFIED:
```json
{
  "mcpServers": {
    "my-server": { "type": "http", "url": "https://mcp.example.com", "timeout": 600000 },
    "local-server": { "type": "stdio", "command": "/path/to/server", "args": ["--config", "value"] }
  }
}
```
Env vars: `MCP_TIMEOUT=10000 claude`, `export MCP_TOOL_TIMEOUT=600000` (ms). Per-server `timeout` overrides `MCP_TOOL_TIMEOUT`, values under 1000 ignored.
Project-scoped servers prompt for approval on first use (UNVERIFIED, from memory).

## 9. Testing with MCP Inspector

VERIFIED (modelcontextprotocol.io/docs/tools/inspector; needs Node >= 22.19.0):
```bash
npx @modelcontextprotocol/inspector node build/server.js          # web UI, stdio
npx @modelcontextprotocol/inspector --server-url http://127.0.0.1:3000/mcp --transport http
npx @modelcontextprotocol/inspector --cli node build/server.js --method tools/list
npx @modelcontextprotocol/inspector --cli https://host/mcp --transport http \
  --method tools/call --tool-name get_weather --tool-arg city=Boston --format json
npx @modelcontextprotocol/inspector --tui node build/server.js
```
Web mode prints a URL with a one-time session token; open it, click Connect, use the Tools tab. The Inspector's own request timeout and progress handling: UNVERIFIED (check its config page).

## Sources

- https://github.com/modelcontextprotocol/typescript-sdk (docs/serving/*.md, docs/servers/errors.md, docs/servers/logging-progress-cancellation.md, docs/get-started/packages.md; src/shared/protocol.ts on branch v1.x)
- https://modelcontextprotocol.io/specification/latest/basic/utilities/progress
- https://modelcontextprotocol.io/docs/tools/inspector
- https://code.claude.com/docs/en/mcp
- https://learn.chatgpt.com/docs/extend/mcp?surface=cli (redirect of developers.openai.com/codex/mcp)
- https://github.com/openai/codex (codex-rs/config/src/mcp_types.rs)
- https://registry.npmjs.org/@modelcontextprotocol/server/latest and /@modelcontextprotocol/sdk/latest
