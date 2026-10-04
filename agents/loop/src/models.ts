// Model adapters. One neutral message format, two providers. Errors carry `retryable` so the
// loop can fall through the chain on quota (429), server (5xx), network and timeout failures.
export interface ToolSpec { name: string; description: string; schema: any }
export interface Call { id: string; name: string; args: Record<string, unknown> }
export type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: Call[]; raw?: { provider: string; content: any } }
  | { role: 'tool'; callId: string; name: string; text: string };
export interface Reply { text: string; calls: Call[]; tokensIn: number; tokensOut: number; raw?: { provider: string; content: any } }
export interface Adapter {
  provider: string; model: string;
  chat(system: string, msgs: Msg[], tools: ToolSpec[], signal: AbortSignal): Promise<Reply>;
}
export class ModelError extends Error {
  constructor(msg: string, readonly retryable: boolean) { super(msg); }
}

// USD per 1M tokens, list price. UNVERIFIED (copied from hub/src/harness.ts and docs/ref/models.md).
// The free tier actually bills $0; this is what the same run would cost on the paid tier.
export const PRICES: Record<string, { in: number; out: number }> = {
  'gemini-3.8-flash': { in: 1.5, out: 7.5 },
  'gemini-3.1-flash-lite': { in: 0.3, out: 2.5 },
};
export const usdFor = (model: string, tin: number, tout: number) => {
  const p = PRICES[model] ?? { in: 0, out: 0 };   // ollama and unknown models: 0
  return (tin * p.in + tout * p.out) / 1e6;
};

import dns from 'node:dns/promises';
import net from 'node:net';

/** Fast offline detection. generateContent only answers after the model has finished, so a normal fetch
 *  timeout cannot tell "no network" from "thinking". Probe DNS and the TCP connect separately, 4 s cap each. */
export async function probeHost(host: string, port = 443, ms = 4000): Promise<void> {
  const cap = <T>(p: Promise<T>, what: string) => new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new ModelError(`offline: ${what} timed out after ${ms} ms`, true)), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(new ModelError(`offline: ${what} failed (${(e as Error).message ?? e})`, true)); });
  });
  const { address } = await cap(dns.lookup(host), `DNS ${host}`);
  await cap(new Promise<void>((res, rej) => {
    const sock = net.connect({ host: address, port });
    sock.once('connect', () => { sock.destroy(); res(); });
    sock.once('error', rej);
  }), `connect ${host}:${port}`);
}

const scrub = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{20,}/g, '<key>').slice(0, 300);

async function post(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new ModelError(`network: ${scrub((e as Error).message)}`, true);   // refused, DNS, abort/timeout
  }
  const text = await res.text();
  if (!res.ok) throw new ModelError(`HTTP ${res.status}: ${scrub(text)}`, res.status === 429 || res.status >= 500);
  try { return JSON.parse(text); } catch { throw new ModelError('bad JSON from model', true); }
}

// Gemini accepts an OpenAPI subset: drop what it rejects.
function cleanSchema(s: any): any {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (s && typeof s === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(s)) if (k !== '$schema' && k !== 'additionalProperties') o[k] = cleanSchema(v);
    return o;
  }
  return s;
}

const GEMINI_HOST = 'generativelanguage.googleapis.com';
let lastProbeOk = 0;

export function gemini(model: string, apiKey: string, probe: (host: string) => Promise<void> = h => probeHost(h)): Adapter {
  return {
    provider: 'gemini', model,
    async chat(system, msgs, tools, signal) {
      if (Date.now() - lastProbeOk > 30_000) { await probe(GEMINI_HOST); lastProbeOk = Date.now(); }   // offline: fail in 4 s, no retries
      const contents: any[] = [];
      for (const m of msgs) {
        if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.text }] });
        else if (m.role === 'assistant') {
          // Gemini 3 needs the thought signatures echoed back, so replay the raw content when we have it.
          // If the turn came from another provider, rebuild it with the documented dummy signature (UNVERIFIED).
          if (m.raw?.provider === 'gemini') contents.push(m.raw.content);
          else contents.push({ role: 'model', parts: [
            ...(m.text ? [{ text: m.text }] : []),
            ...m.calls.map(c => ({ functionCall: { name: c.name, args: c.args }, thoughtSignature: 'skip_thought_signature_validator' })),
          ] });
        } else {
          const part = { functionResponse: { name: m.name, response: { result: m.text } } };
          const last = contents[contents.length - 1];
          if (last?.role === 'user' && last.parts.every((p: any) => p.functionResponse)) last.parts.push(part);   // parallel calls: one turn
          else contents.push({ role: 'user', parts: [part] });
        }
      }
      const j = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] }, contents,
          tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: cleanSchema(t.schema) })) }],
          generationConfig: { temperature: 0 },
        },
        { 'x-goog-api-key': apiKey }, signal);
      const content = j.candidates?.[0]?.content;
      if (!content) throw new ModelError(`no candidate (${j.promptFeedback?.blockReason ?? j.candidates?.[0]?.finishReason ?? 'empty'})`, false);
      const parts: any[] = content.parts ?? [];
      const u = j.usageMetadata ?? {};
      return {
        text: parts.filter(p => p.text && !p.thought).map(p => p.text).join(''),
        calls: parts.filter(p => p.functionCall).map((p, i) => ({ id: `g${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} })),
        tokensIn: u.promptTokenCount ?? 0,
        tokensOut: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),   // thinking is billed as output
        raw: { provider: 'gemini', content: { role: 'model', parts } },
      };
    },
  };
}

/** Small local models print tool calls as JSON text (bare or in a ``` fence) instead of using tool_calls.
 *  Execute the ones that name a real tool; strip every tool-call-shaped JSON object from the text.
 *  A call to an unknown tool (e.g. {"name":"health"}) is stripped, never guessed into a real command. */
export function extractTextCalls(text: string, tools: ToolSpec[]): { calls: Call[]; text: string } {
  const calls: Call[] = [];
  const cuts: [number, number][] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let k = i; k < text.length; k++) {
      const ch = text[k];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = k; break; }
    }
    if (end < 0) break;
    try {
      const o = JSON.parse(text.slice(i, end + 1));
      if (typeof o?.name === 'string' && (o.arguments !== undefined || o.parameters !== undefined || Object.keys(o).length === 1)) {
        if (tools.some(t => t.name === o.name)) calls.push({ id: `o${Date.now()}_t${calls.length}`, name: o.name, args: o.arguments ?? o.parameters ?? {} });
        cuts.push([i, end + 1]);
        i = end;
      }
    } catch { /* not JSON, keep scanning */ }
  }
  let out = text;
  for (const [a, b] of cuts.reverse()) out = out.slice(0, a) + out.slice(b);
  out = out.replace(/```[a-z]*\s*```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return { calls, text: out };
}

export function ollama(model: string, base = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'): Adapter {
  return {
    provider: 'ollama', model,
    async chat(system, msgs, tools, signal) {
      const messages: any[] = [{ role: 'system', content: system }];
      for (const m of msgs) {
        if (m.role === 'user') messages.push({ role: 'user', content: m.text });
        else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.text, ...(m.calls.length ? { tool_calls: m.calls.map(c => ({ function: { name: c.name, arguments: c.args } })) } : {}) });
        else messages.push({ role: 'tool', tool_name: m.name, content: m.text });
      }
      const j = await post(`${base}/api/chat`, {
        model, messages, stream: false, keep_alive: '30m', options: { temperature: 0, num_ctx: 8192 },
        tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.schema) } })),
      }, {}, signal);
      const msg = j.message ?? {};
      let calls: Call[] = (msg.tool_calls ?? []).map((c: any, i: number) => ({ id: `o${Date.now()}_${i}`, name: c.function.name, args: c.function.arguments ?? {} }));
      let text: string = msg.content ?? '';
      if (!calls.length) ({ calls, text } = extractTextCalls(text, tools));
      return { text, calls, tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0 };
    },
  };
}

/** "gemini:gemini-3.8-flash,ollama:qwen2.5-coder:7b" -> adapters. Bare provider names get a default model. */
export function parseChain(spec: string, apiKey: () => string, probe?: (host: string) => Promise<void>): Adapter[] {
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(item => {
    const i = item.indexOf(':');
    const provider = i < 0 ? item : item.slice(0, i);
    const model = i < 0 ? '' : item.slice(i + 1);
    if (provider === 'gemini') return gemini(model || 'gemini-3.8-flash', apiKey(), probe);
    if (provider === 'ollama') return ollama(model || 'qwen2.5-coder:7b');
    throw new Error(`unknown provider in chain: ${item}`);
  });
}

/** NS_LOOP_OFFLINE=1 drops every cloud model from the chain (ollama only). Pure, for tests. */
export function chainSpec(env: Record<string, string | undefined>): string {
  const spec = env.NS_LOOP_CHAIN ?? env.NS_LOOP_MODEL ?? 'gemini:gemini-3.8-flash';
  if (env.NS_LOOP_OFFLINE !== '1') return spec;
  const local = spec.split(',').map(x => x.trim()).filter(x => x.startsWith('ollama'));
  return local.length ? local.join(',') : 'ollama:qwen2.5-coder:7b';
}

/** Extra system text for small local models: a fixed order and the exact fix names from the runbook. */
export function localAddendum(skill: string, toolNames: string[]): string {
  const line = skill.split('\n').find(l => /^named fixes/i.test(l)) ?? '';
  const fixes = [...line.matchAll(/`([a-z][a-z-]+)`/g)].map(m => m[1]);
  const check = skill.includes('settings get global wifi_on') ? '`settings get global wifi_on`' : '`health`';
  const log = skill.includes('settings get global wifi_on') ? '' : ' and `tail -n 20 /var/log/app/app.log`';
  return [
    'FOLLOW THIS ORDER EXACTLY, one tool call at a time:',
    `1. run_command with the check ${check}${log}: evidence first. From the output, decide what is wrong.`,
    `2. run_command with ONE fix chosen from the evidence, using exactly one of these names as the command: ${fixes.join(', ') || '(see runbook)'}. Put your one-sentence diagnosis in its reason.`,
    `3. run_command with the check ${check} again.`,
    '4. Stop. Reply with the line "DIAGNOSIS: <one sentence from the tool output>" and then one short sentence. No tool call.',
    `Only these tools exist: ${toolNames.join(', ')}. Call them with the tool-call mechanism, never by writing JSON in your reply.`,
    ...(toolNames.includes('say') ? ['If the tool say exists, call it first with one short sentence of reasoning before each run_command.'] : []),
    'Never run any other command. If a result says pending or denied, stop and say so.',
  ].join('\n');
}
