// Mocked-model test: no network, no hub. Run: npx tsx src/test.ts
import assert from 'node:assert/strict';
import { runLoop, type ToolHost } from './loop.js';
import { ModelError, chainSpec, extractTextCalls, gemini, localAddendum, parseChain, probeHost, type Adapter } from './models.js';

const tools = [{ name: 'run_command', description: 'x', schema: { type: 'object' } }];
const calls: string[] = [];
const host: ToolHost = {
  listTools: async () => tools,
  callTool: async (name, args) => { calls.push(`${name}:${JSON.stringify(args)}`); return { text: '{"status":"done"}', isError: false }; },
};
const script = (name: string, replies: any[], failFirst?: ModelError): Adapter => {
  let i = 0, failed = false;
  return {
    provider: 'mock', model: name,
    async chat() {
      if (failFirst && !failed) { failed = true; throw failFirst; }
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
};
const call = { text: '', calls: [{ id: 'a', name: 'run_command', args: { device: 'web-1', command: 'restart-web', reason: 'down' } }], tokensIn: 100, tokensOut: 10 };
const fin = { text: 'Fixed.', calls: [], tokensIn: 150, tokensOut: 5 };

// 1. quota error on the first model falls through to the second; loop completes
let r = await runLoop({ task: 'web-1 down', system: 's', host, chain: [script('a', [], new ModelError('HTTP 429', true)), script('b', [call, fin])] });
assert.equal(r.ok, true); assert.equal(r.summary, 'Fixed.'); assert.match(r.report, /web-1: restart-web -> done/); assert.match(r.final, /Fixed\./); assert.equal(r.model, 'b');
assert.equal(r.fallbacks.length, 1); assert.equal(r.commands, 1); assert.equal(r.steps.length, 2);
assert.equal(r.tokensIn, 250); assert.equal(r.tokens, 265);
assert.deepEqual(calls, ['run_command:{"device":"web-1","command":"restart-web","reason":"down"}']);

// 2. a model that never stops hits the step limit
r = await runLoop({ task: 't', system: 's', host, maxSteps: 3, chain: [script('loopy', [call])] });
assert.equal(r.ok, false); assert.equal(r.stopReason, 'max_steps'); assert.equal(r.steps.length, 3);

// 3. every model failing ends in error, not a hang
r = await runLoop({ task: 't', system: 's', host, chain: [script('x', [], new ModelError('HTTP 503', true))] });
assert.equal(r.ok, false); assert.equal(r.stopReason, 'error');

// 4. hard timeout
const slow: Adapter = { provider: 'mock', model: 'slow', chat: (_s, _m, _t, sig) => new Promise((_, rej) => sig.addEventListener('abort', () => rej(new ModelError('aborted', true)))) };
r = await runLoop({ task: 't', system: 's', host, timeoutMs: 200, chain: [slow] });
assert.equal(r.ok, false); assert.ok(['timeout', 'error'].includes(r.stopReason));

// 5. polls do not use the step cap, but are capped per grant; an expired grant stops with awaiting_approval
const pendHost: ToolHost = {
  listTools: async () => tools,
  callTool: async (name) => ({ text: name === 'run_command' ? '{"status":"pending","grantId":7}' : '{"status":"pending","grantId":7}', isError: false }),
};
const poll = { text: '', calls: [{ id: 'p', name: 'get_result', args: { grantId: 7 } }], tokensIn: 1, tokensOut: 1 };
r = await runLoop({ task: 't', system: 's', maxSteps: 2, host: pendHost, chain: [script('p', [call, poll])] });
assert.equal(r.stopReason, 'awaiting_approval'); assert.equal(r.ok, false); assert.match(r.report, /waiting for a press/);
const expHost: ToolHost = { listTools: async () => tools, callTool: async () => ({ text: '{"status":"denied","grantId":7,"reason":"expired with no decision"}', isError: false }) };
r = await runLoop({ task: 't', system: 's', host: expHost, chain: [script('e', [poll, fin])] });
assert.equal(r.stopReason, 'awaiting_approval');

// 6. tool calls printed as text: executed when the tool exists, stripped either way
let x = extractTextCalls('```json\n{"name":"run_command","arguments":{"device":"web-1","command":"restart-web","reason":"x"}}\n```', tools);
assert.equal(x.calls.length, 1); assert.equal(x.calls[0].args.command, 'restart-web'); assert.equal(x.text, '');
x = extractTextCalls('{"name": "health", "arguments": {}}', tools);
assert.equal(x.calls.length, 0); assert.equal(x.text, '');
x = extractTextCalls('All good. {"a": 1} done', tools);
assert.equal(x.text, 'All good. {"a": 1} done');

// 7. offline: the real gemini adapter fails fast on a failed probe, the chain falls through to the local model
const offlineProbe = async () => { throw new ModelError('offline: DNS failed (ENOTFOUND)', true); };
const t0 = Date.now();
r = await runLoop({ task: 'web-1 down', system: 's', host, chain: [gemini('gemini-3.8-flash', 'k', offlineProbe), gemini('gemini-3.1-flash-lite', 'k', offlineProbe), script('qwen', [call, fin])] });
assert.equal(r.ok, true); assert.equal(r.model, 'qwen'); assert.equal(r.fallbacks.length, 2);
assert.match(r.fallbacks[0].error, /offline/); assert.ok(Date.now() - t0 < 1000, 'offline fall-through must be immediate');

// 8. the real probe rejects quickly for an unresolvable host (.invalid never resolves), within its 4 s cap
const p0 = Date.now();
await assert.rejects(probeHost('nightshift-offline-test.invalid', 443, 4000), (e: any) => e instanceof ModelError && e.retryable && /offline/.test(e.message));
assert.ok(Date.now() - p0 < 5000);

// 9. NS_LOOP_OFFLINE drops cloud models and needs no API key
assert.equal(chainSpec({ NS_LOOP_OFFLINE: '1', NS_LOOP_CHAIN: 'gemini:a,gemini:b,ollama:qwen2.5-coder:7b' }), 'ollama:qwen2.5-coder:7b');
assert.equal(chainSpec({ NS_LOOP_OFFLINE: '1', NS_LOOP_CHAIN: 'gemini:a' }), 'ollama:qwen2.5-coder:7b');
assert.equal(chainSpec({ NS_LOOP_OFFLINE: '1' }), 'ollama:qwen2.5-coder:7b');
assert.equal(chainSpec({ NS_LOOP_CHAIN: 'gemini:a,ollama:q' }), 'gemini:a,ollama:q');
const adapters = parseChain(chainSpec({ NS_LOOP_OFFLINE: '1', NS_LOOP_CHAIN: 'gemini:a' }), () => { throw new Error('key must not be read offline'); });
assert.deepEqual(adapters.map(a => a.provider), ['ollama']);

// 10. local-model addendum: fixed order and the exact fix names from the runbook
const skill = 'Named fixes (send the name as the command): `restart-web` (down), `rotate-logs` (disk), `restore-config` (config).\nSteps: 1) health';
const add = localAddendum(skill, ['run_command', 'get_result']);
assert.match(add, /restart-web, rotate-logs, restore-config/); assert.match(add, /1\. run_command with the check `health`/); assert.match(add, /4\. Stop/);
assert.match(localAddendum('Named fixes: `wifi-enable`, `wifi-bounce`\n`settings get global wifi_on`', []), /wifi-enable, wifi-bounce/);
let seenSystem = '';
const spy: Adapter = { provider: 'ollama', model: 'q', async chat(sys) { seenSystem = sys; return fin; } };
await runLoop({ task: 't', system: 'BASE', localAddendum: 'ADDENDUM', host, chain: [spy] });
assert.equal(seenSystem, 'BASE\n\nADDENDUM');
const cloud: Adapter = { provider: 'gemini', model: 'g', async chat(sys) { seenSystem = sys; return fin; } };
await runLoop({ task: 't', system: 'BASE', localAddendum: 'ADDENDUM', host, chain: [cloud] });
assert.equal(seenSystem, 'BASE', 'cloud models do not get the local addendum');

console.log('loop tests passed');
