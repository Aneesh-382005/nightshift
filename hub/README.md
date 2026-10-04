# hub (ns-gateway)

The gate: classifies commands from `workspaces/<type>/policy.yaml`, requests grants as the gate identity, keeps runbook trust and incident books, serves MCP to the agent harness.

- `npx tsx src/serve.ts` long-running: mock alert webhook (POST http://127.0.0.1:8787/alert {"device","alert"}, MOCK), user_request watcher that launches the harness, bookkeeping sweep. Only one long-running gate.
- `npx tsx src/mcp.ts` MCP stdio server (run_command, get_result, list_devices). Harnesses spawn it themselves.
- `npx tsx src/cli.ts devices | classify <dev> <cmd> | run <dev> <cmd> [--reason r] [--wait s] | get <grantId>`
- `npm test` policy engine checks (no DB needed).

Env: NS_HARNESS (gemini|claude|codex, default first found), NS_MODEL, NS_MAX_USD, NS_RUN_TIMEOUT_S, NS_WAIT_MS (default 45000), NS_ALERT_PORT.
Approve a pending grant as the CLI warden: `spacetime call nightshift decide_grant <id> true 60 --server local`.
