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

## Diagnosis and ask mode
- Fix mode: the system prompt (all models) requires evidence first (health, log tail, df, ls), a one-sentence diagnosis grounded in tool output, and for blind alerts a fix chosen from the runbook's named fixes by that evidence. The final reply starts with `DIAGNOSIS: ...`. The JSON line has `diagnosis` and `diagnosisSource` (`model`, or `reason` = taken from the first fix call's reason when the model skipped the line) next to `report` and `summary`; `final` starts with `Diagnosis: ...`.
- `NS_LOOP_MODE=ask`: read-only investigation. The model answers in prose with evidence (`answer`; `final` = answer + the commands it ran). `run_command` is limited in the loop itself to read-only commands (health, tail, cat, ls, df, du, ps, grep, svc status, settings get, no shell metacharacters); anything else is refused before it reaches the hub ("ask mode is read-only"). The gate still classifies everything as well. A request to change something is answered with what would be run, since changes belong to the normal fix flow.

## say (agent thoughts)
If the hub offers a `say(text, device?)` tool (event `agent.thought`), every model's system prompt tells it to call say with one short sentence of reasoning, grounded in the last tool result, before each action. At most 12 say calls per run (extra ones are answered locally and never reach the hub). say calls do not count as steps or as commands. If the hub has no say tool, nothing is added to the prompt and a stray say call gets "say is not available".

## Skills library and escalation
- If the hub offers `search_skills` (and `get_skill`), all models are told to call search_skills with the symptom words right after the first health check and before the first fix, read the best match with get_skill, say() which skill they follow, name it in the DIAGNOSIS line, and never improvise a fix when the skill says risk hold or there is no runbook (report and ask for a human). The JSON line lists the slugs read in `skills`. The small-model addendum stays a fixed order and does not include the skill steps. Tools the hub does not offer are answered locally ("<tool> is not available"); no instruction is added for them.
- Press expiry: when get_result reports the grant expired (or denied by expiry), the run stops at once with `stopReason: "awaiting_approval"`, makes no further tool calls, and `summary` / the last line of `final` is "Escalated to you: I proposed <fix> on <device> and need a press." Polling is capped at 3 per grant and also bounded by the hub's wait (`NS_APPROVAL_WAIT_S`, default 40 s, plus 10 s). The system prompt says: if a fix needs a press, say so once, wait, and if it expires hand over to the human.
