# Headless harness cheat sheet: Codex CLI and Claude Code

Researched 2026-10-03 via WebFetch of live docs. Tags: VERIFIED = stated on a fetched doc page. UNVERIFIED = inferred, from a search snippet, or from memory.
Note: developers.openai.com/codex/* now 308-redirects to learn.chatgpt.com/docs/*. Claude docs moved to code.claude.com/docs/en/*.

## Sources
- Codex exec: https://learn.chatgpt.com/docs/non-interactive-mode
- Codex CLI flags: https://learn.chatgpt.com/docs/developer-commands?surface=cli
- Codex config ref: https://learn.chatgpt.com/docs/config-file/config-reference
- Codex advanced config (providers, oss, bedrock): https://learn.chatgpt.com/docs/config-file/config-advanced
- Codex AGENTS.md: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Codex skills: https://learn.chatgpt.com/docs/build-skills
- Codex MCP: https://learn.chatgpt.com/docs/extend/mcp
- Codex models: https://learn.chatgpt.com/docs/models
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- Claude headless: https://code.claude.com/docs/en/headless
- Claude CLI ref: https://code.claude.com/docs/en/cli-reference
- Claude MCP: https://code.claude.com/docs/en/mcp
- Claude permission modes: https://code.claude.com/docs/en/permission-modes
- Claude cost tracking: https://code.claude.com/docs/en/agent-sdk/cost-tracking
- Claude model config: https://code.claude.com/docs/en/model-config
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing

## 1. Codex CLI (`codex exec`)

### Invoke, prompt, cwd  [VERIFIED]
```bash
codex exec "your task"                       # prompt as arg
cat prompt.txt | codex exec -                # prompt from stdin ("-" or omit arg)
npm test 2>&1 | codex exec "summarize failures"   # arg = instruction, stdin = data
codex exec -C /work/ws1 --sandbox workspace-write --json "task"
```
- `-C, --cd <dir>` sets workspace root. `--skip-git-repo-check` is needed outside a git repo (docs: Codex requires a Git repo). `--add-dir` grants extra writable dirs. `--ephemeral` skips persisting session files.
- stdout carries only the final agent message; progress goes to stderr (unless `--json`).
- Auth for one run: `CODEX_API_KEY=... codex exec ...` (works with exec, review, TS SDK). Default reuses saved CLI login.
- Resume: `codex exec resume --last "next"` / `codex exec resume <SESSION_ID>`.

### Output: JSONL and usage  [VERIFIED]
`--json` (alias `--experimental-json`) prints newline-delimited events: `thread.started`, `turn.started`, `item.*` (agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, plan updates), `turn.completed`, `turn.failed`, `error`.
```json
{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}
```
- Usage is per turn on `turn.completed`. Sum across turns. There is NO cost field: compute cost yourself from the price table (section 3). `cached_input_tokens` is a subset of `input_tokens` (UNVERIFIED, assumed from the sample numbers; confirm before billing).
- `-o, --output-last-message <path>` writes final message to file. `--output-schema <schema.json>` forces JSON Schema on the final response.

### Attach MCP server per invocation
- Persistent: `~/.codex/config.toml`, [VERIFIED]:
```toml
[mcp_servers.hub]
command = "node"
args = ["/path/hub-mcp.js"]
[mcp_servers.hub.env]
TOKEN = "x"
# or streamable HTTP:
[mcp_servers.remote]
url = "https://host/mcp"
bearer_token_env_var = "HUB_TOKEN"
http_headers = { "X-Foo" = "bar" }
```
- Other keys [VERIFIED]: `enabled_tools`, `disabled_tools` (deny applies after allow), `default_tools_approval_mode = "prompt"`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `required = true` (exec exits non-zero if server fails init).
- Per run: `-c` overrides config; "values parse as TOML if possible" [VERIFIED]. Docs give NO example for nested mcp_servers keys, so this is UNVERIFIED but expected to work:
```bash
codex exec -c 'mcp_servers.hub.command="node"' -c 'mcp_servers.hub.args=["/p/hub.js"]' -c 'mcp_servers.hub.required=true' ...
```
- Safer per-workspace option (UNVERIFIED): give each run its own `CODEX_HOME` dir with a generated `config.toml` (+ auth), isolating config. `codex mcp add NAME -- cmd args` and `codex mcp add NAME --url URL [--env K=V]` exist [VERIFIED] but mutate global config.

### Never block on prompts; restrict  [VERIFIED unless noted]
- exec default is a read-only sandbox. Set `--sandbox read-only|workspace-write|danger-full-access` (`-s`).
- Approval: `--ask-for-approval/-a`, config `approval_policy` = `on-request`, `never`, or granular. Use `-a never` (docs use it in `codex --ask-for-approval never ...`) so nothing pauses. Whether `codex exec` accepts `-a` as a flag is listed in the CLI ref; if rejected use `-c approval_policy="never"` (UNVERIFIED).
- `--full-auto` is DEPRECATED, use `--sandbox workspace-write`. `--dangerously-bypass-approvals-and-sandbox` / `--yolo` removes both (only inside an external sandbox).
- Tool restriction: only via MCP `enabled_tools`/`disabled_tools` and sandbox level; no general built-in tool allowlist found in docs.

### System prompt, AGENTS.md, skills  [VERIFIED]
- AGENTS.md: global `~/.codex/AGENTS.override.md` then `~/.codex/AGENTS.md` (first non-empty). Project: from git root down to cwd, per dir `AGENTS.override.md`, `AGENTS.md`, then `project_doc_fallback_filenames`; max one file per dir; concatenated root to leaf; cap `project_doc_max_bytes` = 32 KiB.
- Config keys: `developer_instructions` (extra session instructions), `model_instructions_file` (replaces built-in instructions).
- Skills: `.agents/skills/<name>/SKILL.md` (cwd up to repo root), `$HOME/.agents/skills`, `/etc/codex/skills`, built-ins. SKILL.md needs `name` and `description` frontmatter. Disable: `[[skills.config]] path="/x/SKILL.md" enabled=false`. Implicit activation when the prompt matches the description.
- Per workspace: write AGENTS.md and `.agents/skills/` into the workspace dir and pass `-C`. Needs git root: `git init` the workspace, or the AGENTS walk may start at cwd only (UNVERIFIED).

### Exit codes, timeouts  [partly VERIFIED]
- Non-zero on task failure and on required-MCP init failure; `codex login status` returns 0 if creds exist. No specific code table documented. There is no documented overall run timeout flag: enforce in the hub (AbortSignal / SIGTERM, then SIGKILL) [UNVERIFIED].
- A failed turn emits `turn.failed` / `error` on the JSONL stream; parse it instead of trusting only exit code.

### Model selection  [VERIFIED]
`-m, --model <id>`, `model = "..."` in config, `-p/--profile name` loads `~/.codex/<name>.config.toml`.

### Custom provider: Amazon Bedrock  [VERIFIED from config-advanced; model ID value UNVERIFIED]
```toml
model_provider = "amazon-bedrock"
model = "<bedrock-model-id>"          # docs leave placeholder; get id from help.openai.com/en/articles/20001253 (403 to WebFetch)
[model_providers.amazon-bedrock.aws]
profile = "default"                   # omit to use standard AWS credential chain
region  = "eu-central-1"
```
Built-in provider id `amazon-bedrock`; only nested `aws.profile` and `aws.region` can be overridden. One-off: `codex exec -c model_provider='"amazon-bedrock"' -c 'model_providers.amazon-bedrock.aws.region="us-east-1"' -m <id> "task"` (UNVERIFIED syntax).
Generic custom providers [VERIFIED]: `[model_providers.<id>]` keys `name`, `base_url`, `env_key`, `requires_openai_auth`, `wire_api = "responses"` (only supported value), `supports_websockets`, `query_params`, `http_headers`, plus `[model_providers.<id>.auth] command/args/timeout_ms/refresh_interval_ms`. Reserved ids: `openai`, `ollama`, `lmstudio`.

### `--oss` with Ollama  [VERIFIED flags; port from search snippets]
```bash
codex exec --oss --local-provider ollama -m gpt-oss:20b -C ws --sandbox workspace-write --json "task"
```
```toml
oss_provider = "ollama"     # or "lmstudio"; if unset, `codex exec --oss` EXITS WITH ERROR (no prompt)
# manual alternative (config-advanced example):
[model_providers.local_ollama]
name = "Ollama"
base_url = "http://localhost:11434/v1"
```
Model tag `gpt-oss:20b` and port 11434 are UNVERIFIED (search snippets only). Local models report tokens but cost is $0.

## 2. Claude Code (`claude -p`)

### Invoke, prompt, cwd  [VERIFIED]
```bash
claude -p "Find and fix the bug" --output-format json --allowedTools "Read,Edit,Bash"
cat build.log | claude -p "explain root cause"      # stdin capped at 10MB
claude --bare -p "Summarize README.md" --allowedTools "Read"
```
- No `--cwd` flag exists; spawn the process with `cwd: workspaceDir` (UNVERIFIED but standard). `--add-dir` adds extra dirs.
- `--bare` (recommended for scripted calls): skips hooks, skills, commands, subagents, plugins, MCP discovery, auto memory, CLAUDE.md; needs `ANTHROPIC_API_KEY` (no OAuth/keychain). Bedrock/Vertex/Foundry creds still read. Load context explicitly with `--append-system-prompt[-file]`, `--settings`, `--mcp-config`, `--agents`, `--plugin-dir`.
- Without `--bare`, `-p` still runs project `.claude/settings.json` hooks and `.mcp.json` servers with no trust prompt.
- Session: `--continue`, `--resume <id>`, `--no-session-persistence`, `--session-id <uuid>`.

### Output and usage/cost  [VERIFIED]
- `--output-format text|json|stream-json`. `json` = one object with `result`, `session_id`, `total_cost_usd`, `usage`, per-model `modelUsage`, and `structured_output` if `--json-schema` used.
- `stream-json` needs `--verbose`; add `--include-partial-messages` for token deltas. Last line is a `type:"result"` message with final text, cost, session metadata. First event `system/init` lists `mcp_servers` (name,status) and `mcp_server_errors`.
- Cost fields per docs: result has `total_cost_usd`; `usage` (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens); `modelUsage[model]` = {costUSD, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens}.
- Caveats [VERIFIED]: `total_cost_usd` is a client-side estimate, may drift from billing. `usage` EXCLUDES subagents; `total_cost_usd` and `modelUsage` include them. Error results also carry cost; `error_max_budget_usd` usage omits the last response. Resumed sessions report the whole session total (do not sum). Per-step assistant `output_tokens` is a placeholder; read output from the result.
- Subtypes seen in docs: `success`, `error_during_execution`, `error_max_budget_usd`; max-turns is an error subtype (name `error_max_turns` UNVERIFIED).

### Attach MCP per invocation  [VERIFIED]
```bash
claude -p "task" --strict-mcp-config --mcp-config '{"mcpServers":{"hub":{"type":"http","url":"http://127.0.0.1:7777/mcp","headers":{"Authorization":"Bearer T"}}}}' \
  --allowedTools "mcp__hub__*"
# stdio form: {"mcpServers":{"hub":{"type":"stdio","command":"node","args":["hub.js"],"env":{"K":"v"}}}}
```
- `--mcp-config` accepts files or JSON strings (space separated). `--strict-mcp-config` ignores all other MCP config. Entries without a valid `type` are silently skipped (check `mcp_server_errors`). With `-p` it waits for servers up to `MCP_TIMEOUT` (30s default). Tool names are `mcp__<server>__<tool>`.

### Never block on prompts; restrict  [VERIFIED]
- `--allowedTools "Read" "Bash(git diff *)" "mcp__hub__*"` auto-approves (permission rule syntax, space before `*` matters).
- `--tools "Read,Grep"` restricts available built-ins (`""` disables all); does not affect MCP. `--disallowedTools "mcp__*"` / `"Bash"` removes tools or denies patterns.
- `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions`. In `-p`, unspecified mode is `default` (or `auto` when feature flags are not fetched, e.g. Bedrock/telemetry off), so ALWAYS pass one explicitly.
- Best headless lockdown: `--permission-mode dontAsk` (denies anything not allowed, never prompts) plus `--allowedTools`. Alternative: `--permission-mode acceptEdits --permission-prompts none` (flag needs v2.1.259+; denials appear as `permission_denied` / `permission_denials`). `--dangerously-skip-permissions` = bypassPermissions (container only).
- Limits: `--max-turns N` (errors when hit), `--max-budget-usd 5.00` (print mode; subagent spend counts). `--restricted` removes command tools and confines files (v2.1.248+).

### System prompt, CLAUDE.md, skills  [VERIFIED]
- `--append-system-prompt "txt"` / `--append-system-prompt-file f` (keep defaults); `--system-prompt` / `--system-prompt-file` replace everything (drops tool guidance and safety text). Flags can combine. Prompt is recorded on first request and reused on `--resume`.
- CLAUDE.md in the cwd and parents loads automatically (not with `--bare`). Skills: `.claude/skills/<name>/SKILL.md` in the workspace, or via `--add-dir` (loaded even in `--bare`); `--plugin-dir` for plugins; `/skill-name` in the prompt invokes a skill under `-p`. `--disable-slash-commands` turns all off.
- `--agents '{"name":{"description":"...","prompt":"..."}}'` defines subagents inline.

### Exit codes, timeouts, signals  [VERIFIED]
- 0 success, non-zero on failure. Invalid flags error on stderr before the run. In-run failures (e.g. missing auth) print the failure as the result on stdout (so parse `is_error`/`subtype`; field names `is_error` UNVERIFIED).
- SIGTERM exits 143 and records no result for the in-flight turn; SIGINT ends the turn cleanly. Background Bash is killed about 5s after the result. Background subagents keep `-p` open up to 10 min idle (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, 0 = no ceiling). `MCP_TIMEOUT` for MCP startup. No overall `--timeout` flag for `-p`: enforce in the hub.

### Model selection  [VERIFIED]
`--model sonnet|opus|haiku|fable|<full id>`, `--fallback-model sonnet,haiku`, env `ANTHROPIC_MODEL`, `--effort low|medium|high|xhigh|max`. Aliases on Anthropic API: opus = Opus 5.5 (also `default`), sonnet = Sonnet 5.5, fable = Fable 5.1. On Bedrock `sonnet` = Sonnet 4.5 (pin explicitly there). Bedrock: set `CLAUDE_CODE_USE_BEDROCK=1` plus AWS creds [VERIFIED in cost-tracking example].

## 3. Model IDs and prices for a cost meter (USD per 1M tokens)

### Claude [VERIFIED: pricing page; IDs from model-config page examples]
| ID | Input | 5m cache write | Cache read | Output |
|---|---|---|---|---|
| claude-opus-5-5 (CLI default) | 4 | 5 | 0.20 | 20 |
| claude-sonnet-5-5 | 2 | 2.50 | 0.20 | 10 |
| claude-sonnet-5 | 2 | 2.50 | 0.20 | 10 |
| claude-haiku-4-5 | 1 | 1.25 | 0.10 | 5 |
| claude-fable-5-1 | 10 | 12.50 | 0.25 | 50 |
| claude-opus-5 / 4-8 | 5 | 6.25 | 0.50 | 25 |
- 1h cache write = 2x input. US-only inference (`inference_geo:"us"`) = 1.1x on everything. Bedrock/Vertex regional endpoints carry +10%; Bedrock bills by AWS price list. Sonnet 5 is $2/$10 permanently (the Sept 2026 rise to $3/$15 was cancelled).
- Prefer the CLI's `total_cost_usd` and `modelUsage.*.costUSD`, and keep this table as fallback for Codex only.

### OpenAI / Codex [VERIFIED: developers.openai.com/api/docs/pricing; recommended list from models page]
| ID | Input | Cached input | Output |
|---|---|---|---|
| gpt-6-astra (most capable) | 10.00 | 1.00 | 50.00 |
| gpt-6.1-sol (near-Astra, cheaper; used in docs examples) | 2.00 | 0.10 | 10.00 |
| gpt-6-luna (efficient) | 0.10 | 0.01 | 0.50 |
| gpt-5.3-codex | 1.75 | 0.175 | 14.00 |
- Docs name no single "default" model; recommended trio is astra / sol / luna and examples use `gpt-6.1-sol`. GPT-5.5 retires 2026-10-14.
- Codex cost = (input_tokens - cached_input_tokens) * input + cached_input_tokens * cached + output_tokens * output (UNVERIFIED subset assumption, see section 1). Subscription (ChatGPT login) usage is credit based, not per token; per-token prices apply to API key / Bedrock-style billing. Bedrock prices for OpenAI models: see AWS pricing (not fetched).

## 4. Hub implementation checklist
- Spawn with `child_process.spawn` (no shell), `cwd` = workspace, env minimal + key; line-buffer stdout JSONL; kill on timeout.
- Codex: `codex exec --json -C ws --sandbox workspace-write -c approval_policy=\"never\" --skip-git-repo-check -m MODEL "$PROMPT"` (flag combo UNVERIFIED as a whole; test once).
- Claude: `claude -p --bare --output-format stream-json --verbose --permission-mode dontAsk --allowedTools "mcp__hub__*,Read,Edit" --strict-mcp-config --mcp-config JSON --model MODEL --max-budget-usd N "$PROMPT"` (pieces VERIFIED individually).
- Verify MCP attached: Claude `system/init.mcp_servers[].status`; Codex use `required = true` so failure exits non-zero.
