# agents/loop

A thin Nightshift agent loop (no framework). It is an MCP client to the hub (`hub/src/mcp.ts`, tools `run_command`, `get_result`, `list_devices`), uses `workspaces/<type>/SKILL.md` as the system prompt, and runs a tool-calling loop against Gemini or Ollama with a fallback chain.

## Run
```
cd agents/loop && npm install
npx tsx src/loop.ts "Alert on web-1: service down, port 8080 not responding"
```
The hub needs SpacetimeDB up and executors running. A grant that needs a press stays pending until someone presses the Lantern (or approves as the warden), and the model polls `get_result`.

## Env
| Var | Meaning |
|---|---|
| `NS_LOOP_CHAIN` | `provider:model,...` tried in order, e.g. `gemini:gemini-3.8-flash,gemini:gemini-3.1-flash-lite,ollama:qwen2.5-coder:7b` |
| `NS_LOOP_MODEL` | single `provider[:model]` when no chain is set (default `gemini:gemini-3.8-flash`) |
| `NS_LOOP_MAX_STEPS` | default 8 model turns that do work. `get_result` polls do not count; they are capped at 3 per grant |
| `NS_LOOP_TIMEOUT_S` | hard timeout for the whole run, default 300 |
| `NS_LOOP_WORKSPACE` | `linux-server` or `android`; default guessed from the task text |
| `GEMINI_API_KEY` | from the environment, else the repo-root `.env`. Never printed, never passed to the hub process |
| `OLLAMA_URL` | default `http://127.0.0.1:11434` |

A model that fails with 429, 5xx, a network error or a timeout is skipped for the rest of the run and the next one in the chain takes over with the same conversation. Gemini thought signatures are replayed from the raw reply; turns that came from another provider use the documented dummy signature (UNVERIFIED that Gemini accepts it).

## Output
Logs go to stderr. stdout is exactly one JSON line:
```
{ ok, final, report, summary, stopReason: final|awaiting_approval|max_steps|timeout|error|no_models, model, provider, runs: [{device,command,status,exitCode,healthOk,...}],
  steps: [{n, model, tokensIn, tokensOut, text, calls:[{name,args,result}]}],
  fallbacks: [{model,error}], tokensIn, tokensOut, tokens, usd, usdNote, seconds, commands }
```
The hub can map it to `cost.update`: `{tokens, usd, seconds, commands, presses, model}` (presses come from the hub, not the loop). `usd` uses UNVERIFIED list prices from `src/models.ts` (the free tier bills 0; Ollama is 0). `model` is the last model that answered; each step also records its own model. Exit code 0 when `ok`.

## Check
`npm run typecheck` and `npm test` (mocked models, no network, no hub: fallback on 429, step limit, all-fail, hard timeout).
`npx tsx src/try-models.ts` runs the real models against a fake tool host (no hub) to compare them.

## Report, polls, local models
- `report` is built from the tool results only (what ran, on which device, exit and health, whether a press was needed), so it is identical in shape for every model. `summary` is the model's first sentence. `final` = report + summary.
- A grant that expires unpressed, or a 4th poll of the same grant, stops the run with `stopReason: "awaiting_approval"`.
- Tool calls a small model prints as text (bare JSON or a fenced block) are executed when they name a real tool, and stripped from the text either way. A call to an unknown tool such as `{"name":"health"}` is dropped, never guessed into a command.
- Ollama gets `num_ctx 8192` and `keep_alive 30m`.

## Offline (no internet)
- Before each Gemini request the loop probes DNS and the TCP connect to `generativelanguage.googleapis.com` (4 s cap each, result cached 30 s). If the machine is offline the cloud model fails in seconds, with no retries, and the chain moves on.
- `NS_LOOP_OFFLINE=1` skips cloud models entirely (chain reduced to the ollama entries, default `ollama:qwen2.5-coder:7b`) and never reads the Gemini key. Equivalent: `NS_LOOP_CHAIN=ollama:qwen2.5-coder:7b`.
- Ollama must be running with the model pulled: `ollama ps` / `ollama list`.
- For ollama the system prompt gets an addendum: check, one fix from the exact runbook names, check again, stop; one tool call at a time; no JSON in the reply.
- Hub in offline mode (from `hub/`): `NS_HARNESS=loop NS_LOOP_OFFLINE=1 NS_LOOP_CHAIN=ollama:qwen2.5-coder:7b npx tsx src/serve.ts`
