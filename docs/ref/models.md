# Sponsor LLM routes: comparison and cheat sheet (MHacks 26)

Researched 2026-10-03 via WebFetch/WebSearch. VERIFIED = stated on the fetched page (page summarized by a fetch tool, so re-check exact numbers before relying on them). UNVERIFIED = not found or inferred.
No accounts or keys were created.

## 0. Bottom line

1. Gemini API (AI Studio key) on `gemini-3.8-flash` is free now, has OpenAI-compatible endpoint, and Gemini CLI is a first-class headless harness with MCP support. Best default.
2. ASI:One (`asi1` / `asi1-ultra`) is cheap, OpenAI-compatible, has tool calling and a documented Codex config. The hackpack code gives one month free Pro. Required for the Fetch.ai track anyway.
3. AWS Bedrock has many non-Anthropic models and a built-in Codex provider, but nothing on the pages found says MHacks participants get credits. Confirm in Discord.
4. xAI Grok: strong and OpenAI compatible, but no hackathon credit info found. Use only if credits confirmed.

## 1. Google Gemini API (free now)

Model IDs (VERIFIED, https://ai.google.dev/gemini-api/docs/models):
- Pro: `gemini-3.1-pro-preview`
- Flash: `gemini-3.8-flash` (described as most intelligent Flash for agents and software engineering), `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`
- Flash-Lite: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`
- Preview: `gemini-3-flash-preview`

Pricing (VERIFIED, https://ai.google.dev/gemini-api/docs/pricing, page header oddly says "as of January 2027"):
- `gemini-3.8-flash`: free tier "free of charge"; paid $1.50 in / $7.50 out per 1M (discounted rate through 2026-12-31 per page)
- `gemini-3.5-flash-lite`: free tier free; paid $0.30 in / $2.50 out
- `gemini-3.1-flash-lite`: free tier free
- `gemini-3.1-pro-preview`: NO free tier row; paid $4.00 in (>200k prompts) / $18.00 out
- Batch API 50% off; Search grounding 5,000 free/month per Gemini 3.x model then $14 per 1,000

Free-tier limits (https://ai.google.dev/gemini-api/docs/rate-limits):
- VERIFIED: limits are RPM, TPM, RPD, applied per project not per key. The page has NO numeric free-tier table; numbers are shown per project at https://aistudio.google.com/rate-limit
- VERIFIED: Tier 1 needs an active billing account; Tier 2 needs $100+ spend and 3 days.
- UNVERIFIED: exact free RPM/RPD for 3.8 Flash. Check the AI Studio dashboard before the event. Expect low RPD, so a multi-step agent loop plus a team sharing one project can hit 429s. Mitigation: one key per team member in separate projects, or enable billing (Tier 1) as a fallback.

Function calling (VERIFIED, https://ai.google.dev/gemini-api/docs/function-calling):
- Modes: auto, any, none, validated. Parallel and compositional calls supported.
- Gemini 3 thought signatures are handled automatically by SDKs. UNVERIFIED: whether Gemini CLI and OpenAI-compat layer round-trip them correctly (a known failure area on earlier releases, test with a 5-step tool chain).

OpenAI-compatible endpoint (VERIFIED, https://ai.google.dev/gemini-api/docs/openai):
- Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`
- Endpoints: chat completions, embeddings, models, images, videos, batch. The Responses API is NOT listed.
- Consequence: Codex CLI's newer `wire_api = "responses"` likely does not work against it. UNVERIFIED: whether Codex still accepts `wire_api = "chat"`. The Codex docs page I fetched only showed `wire_api` with "responses" as the example. Prefer Gemini CLI for Gemini.
- Codex custom provider shape (VERIFIED from https://learn.chatgpt.com/docs/config-file/config-advanced, generic example):
```toml
[model_providers.gemini]
name = "Gemini"
base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
env_key = "GEMINI_API_KEY"
wire_api = "chat"   # UNVERIFIED value; may be unsupported
```
  (the block above is my adaptation, not a quoted sponsor example)

Gemini CLI (https://github.com/google-gemini/gemini-cli):
- Install (VERIFIED README): `npx @google/gemini-cli`, or global via npm, Homebrew, MacPorts, Anaconda. Typical: `npm i -g @google/gemini-cli` (UNVERIFIED exact command string).
- Auth (VERIFIED README): Google sign-in free tier 60 req/min and 1,000 req/day; Gemini API key free tier 1,000 req/day with model selection; Vertex AI for enterprise. Env var name `GEMINI_API_KEY` is UNVERIFIED here (auth doc 404'd), widely used.
- Headless (VERIFIED, docs/cli/headless.md): triggered by `-p/--prompt` or non-TTY. Output formats: JSON (single object with response plus usage stats) and stream-json (JSONL events: init, messages, tool use, final result with per-model token breakdown). Flag `--output-format json|stream-json` (flag name UNVERIFIED on page, standard). Exit codes: 0 ok, 1 error, 42 input error, 53 turn limit exceeded.
- Other flags (VERIFIED cli-reference): `-m/--model` (aliases `flash`, `flash-lite`, default `auto`), `--approval-mode`, `--sandbox`, `--resume`. For unattended runs `--approval-mode yolo` (value UNVERIFIED).
- MCP (VERIFIED, docs/tools/mcp-server.md): `mcpServers` in `~/.gemini/settings.json`; each needs `command` (stdio), `url` (SSE) or `httpUrl` (streamable HTTP); options `trust`, `includeTools`, `excludeTools`, `timeout`, `env`. CLI: `gemini mcp add|list|remove|enable|disable`, `--transport stdio|sse|http`, `-e KEY=value`. Set `trust: true` for headless or tool prompts will block.
```json
{ "mcpServers": { "gateway": { "command": "node", "args": ["gw.js"], "trust": true, "timeout": 30000 } } }
```
- Cost meter: sum per-model token counts from stream-json final event, multiply by price table above. Free tier shows $0 but meter should still show list price.

## 2. Fetch.ai ASI:One

Docs: https://docs.asi1.ai (index https://docs.asi1.ai/llms.txt; docs MCP at https://docs.asi1.ai/_mcp/server).
- Base URL (VERIFIED): `https://api.asi1.ai/v1`, OpenAI compatible; Chat Completions and `/v1/responses` both documented.
- Models and prices (VERIFIED, https://docs.asi1.ai/documentation/models.md), per 1M tokens:

| Model | Context | In | Out | Notes |
|---|---|---|---|---|
| `asi1` | 196,608 | $0.50 | $1.90 | default, tool calling, images |
| `asi1-ultra` | 1,000,000 | $1.26 | $3.96 | deepest, slower, no images |
| `asi1-mini` | 262,144 | $0.18 | $0.45 | fastest |

- Tool calling (VERIFIED, .../build-with-asi-one/tool-calling.md): `tool_choice` auto/required/forced/none, `parallel_tool_calls:false`, strict schema mode, standard tool-call IDs and message ordering.
- Rate limits (VERIFIED): no numbers in docs; shown in account wallet page https://asi1.ai/account-and-settings/wallet. 429 message "Your plan's rate limit is exhausted"; use backoff with jitter. UNVERIFIED: limits on free vs Pro.
- Codex config (VERIFIED, https://docs.asi1.ai/documentation/coding/codex.md):
```toml
model = "asi1-ultra"
model_provider = "asi"
model_context_window = 196000
web_search = "disabled"
[model_providers.asi]
name = "ASI:One"
base_url = "https://api.asi1.ai/v1"
wire_api = "responses"
[model_providers.asi.auth]
command = "printf"
args = ["sk_YOUR_KEY_HERE"]
```
  Docs also list OpenCode, Cursor, Zed tutorials. Model ID `asi1-ultra` is Codex default there although context window set to 196000 (odd; UNVERIFIED reason).
- Hackpack (VERIFIED, https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack): code `MHACKS26` followed by `MHACKS26AV` text appears run together on the page (rendered as "MHACKS26MHACKS26AV"). Page says it unlocks one month free ASI:One Pro and Agentverse Premium. Redemption steps NOT given. Two codes may exist (one ASI:One, one Agentverse "AV"): UNVERIFIED, ask Fetch.ai in Discord.
- Track requirements (VERIFIED): agent registered on Agentverse, Agent Chat Protocol, discoverable via ASI:One, multi-step planning or tool execution shown in ASI:One chat. Judging: Fetch.ai tech use 20%.
- Whether the credit applies to API usage or only the chat product: UNVERIFIED. Must confirm.

## 3. AWS Amazon Bedrock

Models (VERIFIED, https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html). Non-Anthropic text models listed:
- Amazon: Nova 2 Lite, Nova Lite, Nova Micro, Nova Pro, Nova Premier
- OpenAI: gpt-oss-120b, gpt-oss-20b, GPT OSS Safeguard 120B/20B (page also lists GPT-5.4, 5.5, 5.6 Sol/Terra/Luna, GPT-6 family on Bedrock; availability and price UNVERIFIED, not researched per scope)
- Meta: Llama 3.3 70B, Llama 3.1 405B/70B/8B, Llama 3.2 family, Llama 4 Maverick 17B, Llama 4 Scout 17B
- Mistral: Mistral Large 3, Mistral Large, Mistral Small, Devstral 2 123B, Magistral Small 2509, Ministral 14B/8B/3B
- Qwen: Qwen3 Coder 480B, Qwen3 Coder Next, Qwen3 235B 2507, Qwen3 32B, Qwen3 Next 80B
- DeepSeek V3.2, V3.1, R1; Moonshot Kimi K3, K2.5, K2 Thinking; MiniMax M2.5; Z.AI GLM 5, GLM 4.7; Google Gemma 4 31B; NVIDIA Nemotron 3 Super 120B; Cohere Command R/R+; xAI Grok 4.7, 4.6, 4.3 (so Grok is also reachable via Bedrock)
- Exact model IDs: only `openai.gpt-oss-120b-1:0` and `openai.gpt-oss-20b-1:0` (runtime) and `openai.gpt-oss-120b` (mantle) VERIFIED from the chat completions page. Others UNVERIFIED, look up in console or ListFoundationModels. Many need an inference profile prefix like `us.`.

Prices (VERIFIED range only, https://aws.amazon.com/bedrock/pricing/, per 1M tokens in/out): Nova $0.30-3.00 / $1.00-10.00; gpt-oss $0.07-0.15 / $0.20-0.60; Llama $0.75-1.95 / $1.00-2.56; Mistral $0.04-0.50 / $0.04-2.00; Qwen $0.15-0.53 / $0.78-2.66; DeepSeek $0.50-0.74 / $1.70-2.22. Per-model rows UNVERIFIED (page summary gave only ranges).

OpenAI-compatible endpoints (VERIFIED, https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html):
- bedrock-runtime: `https://bedrock-runtime.{region}.amazonaws.com/openai/v1/chat/completions`, auth SigV4 or Bedrock API key (env `AWS_BEARER_TOKEN_BEDROCK` used in examples)
- bedrock-mantle: `https://bedrock-mantle.{region}.api.aws/v1/chat/completions`, has `GET /models`; runtime does not
- gpt-oss on runtime supports Chat Completions but NOT the Responses API there. Per-endpoint per-model quotas apply (quotas-runtime.md, quotas-mantle.md, not read).

Codex CLI built-in provider (VERIFIED, https://learn.chatgpt.com/docs/config-file/config-advanced):
```toml
model_provider = "amazon-bedrock"
model = "<bedrock-model-id>"
[model_providers.amazon-bedrock.aws]
profile = "default"
region = "us-east-1"
```
Omit `profile` to use the standard AWS credential chain. UNVERIFIED which models work well through this path with Codex tools (gpt-oss-120b is the obvious pick).

Credits: AWS is listed as an MHacks 2026 sponsor (UNVERIFIED, search snippet only, https://www.mhacks.org/). No page found describing participant Bedrock credits, amount, or redemption. Also model access in Bedrock may need enabling per account/region. MUST confirm with AWS in Discord.

Tool calling evidence for gpt-oss: UNVERIFIED in this research (no benchmark page fetched).

## 4. xAI (SpaceXAI) Grok

- Base URL (VERIFIED, https://docs.x.ai/developers/quickstart): `https://api.x.ai/v1`, OpenAI SDK compatible. Signup at console.x.ai and "add credits" (so paid by default).
- Models and prices (VERIFIED, https://docs.x.ai/developers/models, summaries differ slightly): Grok 4.7 "most capable", 500k context, about $2 per 1M input under 200k prompts; Grok 4.6 similar $2-4; Grok 4.3 and reasoning variants $1.25-2.50 input; grok-build $1-2 input. Output prices not captured: UNVERIFIED. Cached input discounted.
- Media (VERIFIED): `grok-imagine-image-2.0` $0.04/image (docs range $0.02-0.05); Grok Imagine Video 1.5 about $0.08/s; voice speech-to-speech $0.08/min, TTS $15 per 1M chars.
- Tool calling (VERIFIED quickstart): function calling and built-in tools (web search, code execution) listed.
- Hackathon free credits: NOT FOUND. Search for MHacks plus SpaceXAI returned nothing relevant. UNVERIFIED. Confirm in Discord, ask for credit code.
- Rate limits: UNVERIFIED (not on fetched pages).
- Harness: Codex CLI via custom provider (base_url above, `env_key = "XAI_API_KEY"`), UNVERIFIED that Responses API is supported on xAI (`/v1/responses` not checked).
- Note: the Grok Imagine/Voice track is separate from the agent brain; the agent LLM can differ from the track API.

## 5. Independent tool-calling benchmarks

Coverage is thin for these exact sponsor models. Treat as directional.
- MCP-Atlas (Scale, 1,000 tasks, 36 real MCP servers, 220 tools; rescored April 2026 with 100-call budget), per search snippets (UNVERIFIED, not fetched; https://labs.scale.com/leaderboard/mcp_atlas):
  Gemini 3.5 Flash (high) 83.6%; Gemini 3.1 Pro Preview (high) 78.2%; GPT-5.6 Sol 81.8%; Claude Opus 5 85.8%; Muse Spark 1.1 88.1%.
  No ASI, Grok, gpt-oss or Nova numbers found. Gemini 3.8 Flash not listed in snippet (newer than 3.5 Flash, expected equal or better, UNVERIFIED).
- BFCL v4 (https://benchlm.ai/benchmarks/bfcl-v4, VERIFIED page): 22 models, leader BTL-3 88.5%, then Atria Dawn 77.0%, Qwen3.7 Max 75.0%. No Gemini, Grok, ASI, gpt-oss rows identified. BFCL v3 snippet (UNVERIFIED, https://pricepertoken.com/leaderboards/benchmark/bfcl-v3): Gemini 3.1 Flash Lite Preview 76.5%, close to the top.
- tau-bench: no usable data found for these models.
- Takeaway: only Gemini has direct MCP-style evidence. ASI, Grok 4.x, gpt-oss and Nova have none found here, so run our own 10-task smoke test of the gateway before committing.

## 6. Harness pairing notes

- Gemini CLI + Gemini key: native, JSON usage output for the meter, MCP in settings.json. Best fit.
- Codex CLI + ASI:One: documented config, `wire_api = "responses"`, `codex exec` headless (flags UNVERIFIED, config page did not show them). Usage tokens come from Responses API usage field.
- Codex CLI + Bedrock: built-in provider, region and profile only.
- Codex CLI + xAI: custom provider, unverified.
- Claude Code: only if a route exposes an Anthropic-compatible endpoint; none verified here. Claude models on Bedrock are listed (Sonnet 5.5, Opus 5.5, Fable 5.1 etc.). One line per brief: if Bedrock credits are confirmed, a Claude Sonnet on Bedrock is likely the most reliable tool caller but price was not researched.

## 7. Ranked recommendation

| # | Route | Model ID | Price per 1M in/out | Rate limit risk | Tool-calling evidence | Harness | Label |
|---|---|---|---|---|---|---|---|
| 1 | Gemini API (AI Studio) | `gemini-3.8-flash` | free tier; paid $1.50/$7.50 | Medium: free RPD unknown, per project | MCP-Atlas 3.5 Flash 83.6% (snippet) | Gemini CLI (`-p`, stream-json, MCP) | FREE NOW |
| 2 | ASI:One | `asi1` (fast), `asi1-ultra` (deep) | $0.50/$1.90; $1.26/$3.96 | Unknown, see wallet page | None independent; docs show strict tools, parallel, Responses API | Codex CLI custom provider | Use if one month Pro code works for API; needed for Fetch.ai track anyway |
| 3 | Gemini API | `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` | free; paid $0.30/$2.50 | Medium | BFCL v3 3.1 Flash Lite 76.5% (snippet) | Gemini CLI | FREE NOW (fallback when Flash 429s) |
| 4 | AWS Bedrock | `openai.gpt-oss-120b-1:0` | about $0.07-0.15 / $0.20-0.60 | Low-medium, quotas unread | None found | Codex CLI `amazon-bedrock` | USE IF CREDITS CONFIRMED |
| 5 | AWS Bedrock | Qwen3 Coder, Mistral Large 3, Nova Pro, Llama 4 Maverick (IDs UNVERIFIED) | see ranges | same | None found | Codex CLI | USE IF CREDITS CONFIRMED |
| 6 | xAI | `grok-4.7` | about $2 input; output UNVERIFIED | Unknown | None found | Codex CLI custom provider | USE IF CREDITS CONFIRMED |
| 7 | Gemini API | `gemini-3.1-pro-preview` | no free tier; $4/$18 | Low if billed | MCP-Atlas 78.2% (snippet), below 3.5 Flash | Gemini CLI | Paid only, skip |

## 8. Confirm with sponsors in Discord

1. Fetch.ai: does the `MHACKS26` / `MHACKS26AV` code cover ASI:One API usage and which rate limit; how to redeem; are the two codes separate.
2. AWS: are Bedrock credits given to participants, amount, how to claim, which regions and models are enabled, Bedrock API key support.
3. SpaceXAI: free credits or a code for Grok text plus Imagine and Voice, rate limits, Responses API support.
4. Google: any hackathon Gemini quota boost; otherwise read the AI Studio rate-limit dashboard and test 3.8 Flash under load.

## Source URLs

- https://ai.google.dev/gemini-api/docs/models, /pricing, /rate-limits, /openai, /function-calling
- https://github.com/google-gemini/gemini-cli (docs/cli/headless.md, docs/cli/cli-reference.md, docs/tools/mcp-server.md)
- https://docs.asi1.ai (llms.txt, documentation/models.md, build-with-asi-one/errors.md, tool-calling.md, coding/codex.md)
- https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html, inference-chat-completions.html
- https://aws.amazon.com/bedrock/pricing/
- https://learn.chatgpt.com/docs/config-file/config-advanced
- https://docs.x.ai/developers/models, https://docs.x.ai/developers/quickstart
- https://benchlm.ai/benchmarks/bfcl-v4, https://labs.scale.com/leaderboard/mcp_atlas (snippet only)
