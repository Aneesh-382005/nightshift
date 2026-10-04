# hub (ns-gateway)

The gate: classifies commands from `workspaces/<type>/policy.yaml`, requests grants as the gate identity, keeps runbook trust and incident books, serves MCP to the agent harness.

- `npx tsx src/serve.ts` long-running: mock alert webhook (POST http://127.0.0.1:8787/alert {"device","alert"}, MOCK), user_request watcher that launches the harness, bookkeeping sweep. Only one long-running gate.
- `npx tsx src/mcp.ts` MCP stdio server (run_command, get_result, list_devices). Harnesses spawn it themselves.
- `npx tsx src/cli.ts devices | classify <dev> <cmd> | run <dev> <cmd> [--reason r] [--wait s] | get <grantId>`
- `npm test` policy engine checks (no DB needed).

Env: NS_HARNESS (gemini|claude|codex, default first found), NS_MODEL, NS_MAX_USD, NS_RUN_TIMEOUT_S, NS_WAIT_MS (default 45000), NS_ALERT_PORT.
Approve a pending grant as the CLI warden: `spacetime call nightshift decide_grant <id> true 60 --server local`.

## Skills library
`skills/*.md` at the repo root (frontmatter: slug, title, category, tags, runbook, risk; body markdown; summary = first `# ` line) is synced into the public `skill` table with `upsertSkill(..., source "library")`:
- automatically when `serve.ts` starts (logs `[skills] synced N`), or by hand: `npx tsx src/cli.ts sync-skills`. Files with bad frontmatter are skipped and listed.
- MCP tools `search_skills(query)` (top 3 by keyword overlap: slug, title and tags count 2 per word, summary 1; returns slug, title, risk, runbook, summary) and `get_skill(slug)` (full markdown). Both are read-only, allowed in ask mode, and call `recordSkillUse` so the dashboard shows what the agent consulted.

## Other MCP tools and events
- `say(text, device?)` logs `agent.thought` {text, requestId, incident}; max 12 per run.
- Events from the hub: `gate.decision` {class, rule, reason, ...}, `chat.message` {from, text, requestId, incident, attachments}, `incident.merged`, `incident.failed`, `recap.started/done`.
- `POST /break {device, fault}` faults: service, config, disk, folder, wifi, poison, mystery (random, no hint). `NS_BLIND=1` drops "Suggested fix" from all alerts. Ask mode: a request that is not a monitor alert is a question; without a fix word the gate is read-only.
- Tests: `npm test` (policy), `npx tsx src/test-modes.ts` (modes and skills, no DB), `npx tsx src/test-pipeline.ts` (needs the stub harness, claims the warden; never on a live stack).
