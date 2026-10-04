// Mocked-model test: no network, no hub. Run: npx tsx src/test.ts
import assert from 'node:assert/strict';
import { runLoop, type ToolHost } from './loop.js';
import { readOnlyHost, splitFinal, systemFor } from './prompts.js';
import { ModelError, chainSpec, extractTextCalls, gemini, localAddendum, parseChain, probeHost, type Adapter } from './models.js';

const tools = ['run_command', 'get_result', 'list_devices'].map(name => ({ name, description: 'x', schema: { type: 'object' } }));
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
assert.match(add, /restart-web, rotate-logs, restore-config/); assert.match(add, /1\. run_command with the check `health` and `tail/); assert.match(add, /DIAGNOSIS:/); assert.match(add, /4\. Stop/);
assert.match(localAddendum('Named fixes: `wifi-enable`, `wifi-bounce`\n`settings get global wifi_on`', []), /wifi-enable, wifi-bounce/);
let seenSystem = '';
const spy: Adapter = { provider: 'ollama', model: 'q', async chat(sys) { seenSystem = sys; return fin; } };
await runLoop({ task: 't', system: 'BASE', localAddendum: 'ADDENDUM', host, chain: [spy] });
assert.equal(seenSystem, 'BASE\n\nADDENDUM');
const cloud: Adapter = { provider: 'gemini', model: 'g', async chat(sys) { seenSystem = sys; return fin; } };
await runLoop({ task: 't', system: 'BASE', localAddendum: 'ADDENDUM', host, chain: [cloud] });
assert.equal(seenSystem, 'BASE', 'cloud models do not get the local addendum');

// 11. diagnosis: from the model's DIAGNOSIS line, else from the reason of the first fix call
r = await runLoop({ task: 't', system: 's', host, chain: [script('d', [call, { text: 'DIAGNOSIS: web-1 is down because /etc/app.conf is corrupted.\nRestarted web, health ok.', calls: [], tokensIn: 1, tokensOut: 1 }])] });
assert.equal(r.diagnosis, 'web-1 is down because /etc/app.conf is corrupted.'); assert.equal(r.diagnosisSource, 'model');
assert.equal(r.summary, 'Restarted web, health ok.'); assert.match(r.final, /^Diagnosis: web-1 is down/);
r = await runLoop({ task: 't', system: 's', host, chain: [script('d2', [call, fin])] });
assert.equal(r.diagnosisSource, 'reason'); assert.equal(r.diagnosis, 'down');   // call.args.reason is 'down'
assert.deepEqual(splitFinal('no diagnosis here'), { diagnosis: '', rest: 'no diagnosis here' });
for (const mode of ['fix', 'ask'] as const) assert.match(systemFor('RUNBOOK', mode), /RUNBOOK/);
assert.match(systemFor('x', 'fix'), /DIAGNOSE BEFORE YOU FIX/); assert.match(systemFor('x', 'fix'), /Never guess a fix without a check/);

// 12. ask mode: read-only investigation, writes are refused before they reach the hub, answer is prose with evidence
const hubCalls: string[] = [];
const hubHost: ToolHost = { listTools: async () => tools, callTool: async (n, a) => { hubCalls.push(String(a.command)); return { text: '{"status":"done","exitCode":0,"output":"ERROR port 8080 closed"}', isError: false }; } };
const rd = { text: '', calls: [{ id: 'r', name: 'run_command', args: { device: 'web-1', command: 'tail -n 5 /var/log/app/app.log', reason: 'look' } }], tokensIn: 1, tokensOut: 1 };
const wr = { text: '', calls: [{ id: 'w', name: 'run_command', args: { device: 'web-1', command: 'restart-web', reason: 'fix' } }], tokensIn: 1, tokensOut: 1 };
const chained = { text: '', calls: [{ id: 'c', name: 'run_command', args: { device: 'web-1', command: 'ls /srv; rm -rf /', reason: 'x' } }], tokensIn: 1, tokensOut: 1 };
const ans = { text: 'Web is down: the log says "ERROR port 8080 closed". I did not change anything.', calls: [], tokensIn: 1, tokensOut: 1 };
r = await runLoop({ task: 'why is web-1 down?', system: 's', mode: 'ask', host: readOnlyHost(hubHost), chain: [script('a', [rd, wr, chained, ans])] });
assert.deepEqual(hubCalls, ['tail -n 5 /var/log/app/app.log'], 'only the read reached the hub');
assert.equal(r.ok, true); assert.equal(r.mode, 'ask'); assert.match(r.answer, /port 8080 closed/); assert.match(r.final, /Evidence gathered/);
assert.equal(r.runs.filter(x => x.status === 'denied').length, 2, 'the write and the chained command were refused');
assert.match(systemFor('x', 'ask'), /read-only/); assert.match(systemFor('x', 'ask'), /Do NOT change anything/);

// 13. say: instruction only when the tool exists, 12 max, never counted as work or as a command, absent tool handled
const sayTools = [...tools, { name: 'say', description: 'say', schema: { type: 'object' } }];
const sayLog: string[] = [];
const sayHost: ToolHost = { listTools: async () => sayTools, callTool: async (n, a) => { if (n === 'say') sayLog.push(String(a.text)); return { text: n === 'say' ? 'ok' : '{"status":"done"}', isError: false }; } };
const say = (t: string) => ({ text: '', calls: [{ id: 's' + t, name: 'say', args: { text: t } }], tokensIn: 1, tokensOut: 1 });
let sys = '';
const spy2: Adapter = { provider: 'mock', model: 'spy', async chat(s0) { sys = s0; return fin; } };
await runLoop({ task: 't', system: 'BASE', host: sayHost, chain: [spy2] });
assert.match(sys, /call the say tool/); assert.match(sys, /12 say calls/);
await runLoop({ task: 't', system: 'BASE', host, chain: [spy2] });
assert.equal(sys, 'BASE', 'no say tool, no instruction');
r = await runLoop({ task: 't', system: 's', maxSteps: 2, host: sayHost, chain: [script('sy', [say('Service is down, so I will restart it'), call, fin])] });
assert.equal(r.ok, true); assert.deepEqual(sayLog, ['Service is down, so I will restart it']); assert.equal(r.commands, 1);
sayLog.length = 0;
const many = Array.from({ length: 15 }, (_, i) => say('t' + i));
r = await runLoop({ task: 't', system: 's', maxSteps: 5, host: sayHost, chain: [script('many', [...many, fin])] });
assert.equal(sayLog.length, 12, 'at most 12 say calls reach the hub'); assert.equal(r.ok, true);
r = await runLoop({ task: 't', system: 's', host, chain: [script('nosay', [say('hi'), fin])] });   // model calls say though the hub has none
assert.equal(r.ok, true); assert.equal(r.steps[0].calls[0].result, 'say is not available');
assert.match(localAddendum('Named fixes: `a`', ['run_command', 'say']), /tool say exists/);

// 14. expiry hands over to the human: no more tool calls, escalation line, polls bounded by the hub's wait
const hubLog: string[] = [];
const runCall = { text: '', calls: [{ id: 'r1', name: 'run_command', args: { device: 'web-1', command: 'restart-web', reason: 'down' } }], tokensIn: 1, tokensOut: 1 };
const pollCall = { text: '', calls: [{ id: 'p1', name: 'get_result', args: { grantId: 9 } }], tokensIn: 1, tokensOut: 1 };
const expiring: ToolHost = {
  listTools: async () => tools,
  callTool: async (n) => { hubLog.push(n); return { text: n === 'run_command' ? '{"status":"pending","grantId":9}' : '{"status":"denied","grantId":9,"reason":"expired with no decision"}', isError: false }; },
};
r = await runLoop({ task: 't', system: 's', host: expiring, chain: [script('x', [runCall, pollCall, { text: 'trying a workaround', calls: runCall.calls, tokensIn: 1, tokensOut: 1 }])] });
assert.equal(r.stopReason, 'awaiting_approval'); assert.equal(r.ok, false);
assert.equal(r.summary, 'Escalated to you: I proposed restart-web on web-1 and need a press.'); assert.match(r.final, /Escalated to you/);
assert.deepEqual(hubLog, ['run_command', 'get_result'], 'no tool call after the grant expired');
hubLog.length = 0;
const stillPending: ToolHost = { listTools: async () => tools, callTool: async (n) => { hubLog.push(n); await new Promise(r => setTimeout(r, 60)); return { text: '{"status":"pending","grantId":9}', isError: false }; } };
const slowPoll = { ...pollCall };
r = await runLoop({ task: 't', system: 's', host: stillPending, approvalWaitS: -9.95, chain: [script('y', [runCall, slowPoll, slowPoll, slowPoll])] });   // wait budget already spent
assert.equal(r.stopReason, 'awaiting_approval'); assert.equal(hubLog.length, 2, 'stops polling once the hub wait budget (about 50 ms here) is spent');
assert.match(systemFor('x', 'fix'), /hand over to the human/);

// 15. skills library tools: instruction only when present, slugs recorded, absent tools handled
const skillTools = [...tools, { name: 'search_skills', description: 's', schema: { type: 'object' } }, { name: 'get_skill', description: 'g', schema: { type: 'object' } }];
const skillHost: ToolHost = { listTools: async () => skillTools, callTool: async (n) => ({ text: n === 'search_skills' ? '[{"slug":"disk-full","risk":"low"}]' : n === 'get_skill' ? '# disk-full\nrisk: low' : '{"status":"done"}', isError: false }) };
await runLoop({ task: 't', system: 'BASE', host: skillHost, chain: [spy2] });
assert.match(sys, /search_skills/); assert.match(sys, /BEFORE your first fix/); assert.match(sys, /risk hold/);
await runLoop({ task: 't', system: 'BASE', host, chain: [spy2] });
assert.equal(sys, 'BASE', 'no skills tools, no skills instruction');
const search = { text: '', calls: [{ id: 'k1', name: 'search_skills', args: { query: 'disk full 96%' } }], tokensIn: 1, tokensOut: 1 };
const getSk = { text: '', calls: [{ id: 'k2', name: 'get_skill', args: { slug: 'disk-full' } }], tokensIn: 1, tokensOut: 1 };
r = await runLoop({ task: 't', system: 's', host: skillHost, chain: [script('sk', [search, getSk, call, { text: "DIAGNOSIS: disk is full, following skill 'disk-full'.\nRotated logs.", calls: [], tokensIn: 1, tokensOut: 1 }])] });
assert.deepEqual(r.skills, ['disk-full']); assert.match(r.diagnosis, /disk-full/); assert.equal(r.commands, 1, 'skill lookups are not commands');
r = await runLoop({ task: 't', system: 's', host, chain: [script('sk2', [search, fin])] });   // model calls search_skills though the hub has none
assert.equal(r.ok, true); assert.equal(r.steps[0].calls[0].result, 'search_skills is not available');

console.log('loop tests passed');
