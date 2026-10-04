// Nightshift agent loop: MCP client to the hub, tool-calling loop, model fallback chain.
//   npx tsx src/loop.ts "web-1 is down, service not responding"
// Env: NS_LOOP_CHAIN (e.g. gemini:gemini-3.8-flash,gemini:gemini-3.1-flash-lite,ollama:qwen2.5-coder:7b),
//      NS_LOOP_MODE=ask (read-only investigation, answers in prose), NS_LOOP_OFFLINE=1 (ollama only), NS_LOOP_MODEL (single provider[:model], used when no chain), NS_LOOP_MAX_STEPS (8),
//      NS_LOOP_TIMEOUT_S (300, hard), NS_LOOP_WORKSPACE (linux-server|android), GEMINI_API_KEY (or repo-root .env).
// stdout: exactly one JSON line. Everything else goes to stderr. The API key is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MAX_SAY, SAY_INSTRUCTION, SKILLS_INSTRUCTION, type Mode, readOnlyHost, splitFinal, systemFor } from './prompts.js';
import { ModelError, chainSpec, localAddendum, parseChain, usdFor, type Adapter, type Call, type Msg, type ToolSpec } from './models.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

export interface ToolHost {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
}
export interface LoopOpts { task: string; system: string; mode?: Mode; approvalWaitS?: number; localAddendum?: string; chain: Adapter[]; host: ToolHost; maxSteps?: number; timeoutMs?: number }
export interface StepLog { n: number; model: string; tokensIn: number; tokensOut: number; text: string; calls: { name: string; args: unknown; result: string }[] }
export interface Run { device: string; command: string; grantId?: number; status: string; exitCode?: number; healthOk?: boolean; rolledBack?: boolean; cls?: string; reason?: string; wasPending: boolean }
export interface LoopResult {
  ok: boolean; final: string; report: string; summary: string; skills: string[]; diagnosis: string; diagnosisSource: 'model' | 'reason' | ''; mode: Mode; answer: string;
  stopReason: 'final' | 'max_steps' | 'timeout' | 'error' | 'no_models' | 'awaiting_approval';
  model: string; provider: string; steps: StepLog[]; fallbacks: { model: string; error: string }[]; runs: Run[];
  tokensIn: number; tokensOut: number; tokens: number; usd: number; usdNote: string;
  seconds: number; commands: number;
}

const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + '...' : s);
const MAX_POLLS_PER_GRANT = 3;
const READ_CMD = /^(health|tail|cat|ls|df|du|ps|grep|pgrep|head|wc|settings get)\b/;

/** The report is built from tool results only, so it is the same for every model. */
export function buildReport(runs: Run[], stop: string): string {
  const lines = runs.map(r => {
    const how = r.cls === 'autonomous' ? 'autonomous fix, no press'
      : r.cls === 'read' ? 'read, no press'
      : r.wasPending && r.status === 'done' ? 'approved by a press'
      : r.status === 'pending' ? 'waiting for a press'
      : r.cls ?? '';
    const bits = [r.status, r.exitCode !== undefined ? `exit ${r.exitCode}` : '',
      r.healthOk === undefined ? '' : r.healthOk ? 'health ok' : 'health FAILED', r.rolledBack ? 'rolled back' : '',
      r.status === 'denied' || r.status === 'error' ? (r.reason ?? '') : '', how].filter(Boolean);
    return `- ${r.device}: ${r.command} -> ${bits.join(', ')}`;
  });
  if (!lines.length) lines.push('- no commands ran');
  if (stop !== 'final' && stop !== 'awaiting_approval') lines.push(`Stopped early: ${stop}.`);
  return lines.join('\n');
}

const parse = (t: string): any => { try { return JSON.parse(t); } catch { return undefined; } };

export async function runLoop(o: LoopOpts): Promise<LoopResult> {
  const t0 = Date.now();
  const deadline = t0 + (o.timeoutMs ?? 300_000);
  const maxSteps = o.maxSteps ?? 8;    // counts model turns that do work; get_result polls are capped separately
  const tools = await o.host.listTools();
  const hasSay = tools.some(t => t.name === 'say');
  const names = new Set(tools.map(t => t.name));
  const system = [o.system, hasSay ? SAY_INSTRUCTION : '', names.has('search_skills') ? SKILLS_INSTRUCTION : ''].filter(Boolean).join('\n\n');   // optional tools: absent means no instruction
  const approvalWaitS = o.approvalWaitS ?? Number(process.env.NS_APPROVAL_WAIT_S ?? 40);
  let pendingSince = 0;
  let says = 0;
  const msgs: Msg[] = [{ role: 'user', text: o.task }];
  const r: LoopResult = {
    ok: false, final: '', report: '', summary: '', skills: [], diagnosis: '', diagnosisSource: '', mode: o.mode ?? 'fix', answer: '', stopReason: 'no_models', model: '', provider: '', steps: [], fallbacks: [], runs: [],
    tokensIn: 0, tokensOut: 0, tokens: 0, usd: 0, usdNote: 'USD uses UNVERIFIED list prices; free tier bills 0', seconds: 0, commands: 0,
  };
  const polls = new Map<number, number>();
  let idx = 0;   // current position in the chain; moves forward only, a failed model is not retried this run
  const finish = (reason: LoopResult['stopReason']) => {
    r.stopReason = reason; r.tokens = r.tokensIn + r.tokensOut; r.seconds = +((Date.now() - t0) / 1000).toFixed(1);
    r.report = buildReport(r.runs, reason);
    if (reason === 'awaiting_approval') {
      const run = [...r.runs].reverse().find(x => x.wasPending) ?? r.runs[r.runs.length - 1];
      r.summary = run ? `Escalated to you: I proposed ${run.command} on ${run.device} and need a press.` : 'Escalated to you: I need a press.';
    }
    if (r.mode === 'ask') r.final = [r.answer, r.runs.length ? `Evidence gathered:\n${r.report}` : ''].filter(Boolean).join('\n\n');
    else {
      if (!r.diagnosis) {   // the model did not say it in the final reply: take the reason of the first fix call
        const call = r.steps.flatMap(st => st.calls).find(c => c.name === 'run_command' && !READ_CMD.test(String((c.args as any).command)));
        const why = (call?.args as any)?.reason;
        if (why) { r.diagnosis = String(why).slice(0, 300); r.diagnosisSource = 'reason'; }
      }
      r.final = [r.diagnosis ? `Diagnosis: ${r.diagnosis}` : '', r.report, r.summary].filter(Boolean).join('\n');
    }
    r.ok = reason === 'final';
    return r;
  };

  let turns = 0, work = 0;
  while (work < maxSteps && turns < maxSteps * 4) {
    turns++;
    let reply;
    while (true) {
      if (idx >= o.chain.length) return finish(r.fallbacks.length ? 'error' : 'no_models');
      const left = deadline - Date.now();
      if (left <= 0) return finish('timeout');
      const ad = o.chain[idx];
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), left);
      try {
        reply = await ad.chat(ad.provider === 'ollama' && o.localAddendum ? `${system}\n\n${o.localAddendum}` : system, msgs, tools, ac.signal);
        clearTimeout(timer);
        r.model = ad.model; r.provider = ad.provider;
        r.tokensIn += reply.tokensIn; r.tokensOut += reply.tokensOut;
        r.usd += usdFor(ad.model, reply.tokensIn, reply.tokensOut);
        break;
      } catch (e) {
        clearTimeout(timer);
        const err = e as ModelError;
        r.fallbacks.push({ model: `${ad.provider}:${ad.model}`, error: clip(err.message, 200) });
        console.error(`[loop] ${ad.provider}:${ad.model} failed: ${clip(err.message, 200)}`);
        if (Date.now() >= deadline) return finish('timeout');
        idx++;   // quota, 5xx, network and hard errors all move on to the next model
      }
    }
    const step: StepLog = { n: turns, model: `${r.provider}:${r.model}`, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, text: clip(reply.text), calls: [] };
    r.steps.push(step);
    msgs.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
    if (!reply.calls.length) {
      if (r.mode === 'ask') { r.answer = reply.text.trim(); r.summary = r.answer.split(/(?<=[.!?])\s/)[0]?.slice(0, 240) ?? ''; }
      else {
        const { diagnosis, rest } = splitFinal(reply.text);
        if (diagnosis) { r.diagnosis = diagnosis; r.diagnosisSource = 'model'; }
        r.summary = rest.split(/(?<=[.!?])\s/)[0]?.slice(0, 240) ?? '';   // one sentence from the model
      }
      return finish('final');
    }
    if (reply.calls.some(c => c.name !== 'get_result' && c.name !== 'say')) work++;   // polls and says are not work
    for (const c of reply.calls as Call[]) {
      if (Date.now() >= deadline) return finish('timeout');
      const gid = Number(c.args.grantId);
      if (c.name === 'get_result') {
        const k = (polls.get(gid) ?? 0) + 1;
        polls.set(gid, k);
        if (k > MAX_POLLS_PER_GRANT || (pendingSince && Date.now() - pendingSince > (approvalWaitS + 10) * 1000)) return finish('awaiting_approval');   // never wait longer than the hub does
      }
      let text: string;
      if (!names.has(c.name)) text = `${c.name} is not available`;                    // never reaches the hub
      else if (c.name === 'say' && ++says > MAX_SAY) text = 'say limit reached, continue without it';
      else {
        try { text = (await o.host.callTool(c.name, c.args)).text; }
        catch (e) { text = `tool error: ${(e as Error).message}`; }
      }
      const j = parse(text);
      if (j?.status === 'pending' && !pendingSince) pendingSince = Date.now();
      if (c.name === 'get_skill' && c.args.slug) r.skills.push(String(c.args.slug));
      if (c.name === 'run_command') {
        r.commands++;
        r.runs.push({ device: String(c.args.device), command: String(c.args.command), grantId: j?.grantId, status: j?.status ?? 'error', exitCode: j?.exitCode, healthOk: j?.healthOk, rolledBack: j?.rolledBack, cls: j?.class, reason: j?.reason, wasPending: j?.status === 'pending' });
      } else if (c.name === 'get_result' && j) {
        const run = r.runs.find(x => x.grantId === gid);
        if (run) Object.assign(run, { status: j.status, exitCode: j.exitCode ?? run.exitCode, healthOk: j.healthOk ?? run.healthOk, rolledBack: j.rolledBack ?? run.rolledBack, reason: j.reason ?? run.reason });
      }
      step.calls.push({ name: c.name, args: c.args, result: clip(text) });
      console.error(`[loop] step ${turns} ${c.name}(${JSON.stringify(c.args)}) -> ${clip(text, 120)}`);
      msgs.push({ role: 'tool', callId: c.id, name: c.name, text });
      if (j?.status === 'expired' || (j?.status === 'denied' && /expired|no decision/.test(j.reason ?? ''))) return finish('awaiting_approval');   // hand over, no more tool calls
    }
  }
  return finish('max_steps');
}

// ---------- real wiring ----------
function loadKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const f = path.join(ROOT, '.env');
  if (fs.existsSync(f)) {
    const m = fs.readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('GEMINI_API_KEY not set (env or repo-root .env)');
}

function skillFor(task: string): string {
  const ws = process.env.NS_LOOP_WORKSPACE ?? (/\b(pixel|phone|android|wi-?fi)\b/i.test(task) ? 'android' : 'linux-server');
  return fs.readFileSync(path.join(ROOT, 'workspaces', ws, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
}

async function mcpHost(): Promise<{ host: ToolHost; close: () => Promise<void> }> {
  const hub = path.join(ROOT, 'hub');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'GEMINI_API_KEY') env[k] = v;   // the hub never sees the key
  const client = new Client({ name: 'nightshift-loop', version: '0.1.0' });
  await client.connect(new StdioClientTransport({ command: path.join(hub, 'node_modules/.bin/tsx'), args: ['src/mcp.ts'], cwd: hub, env, stderr: 'inherit' }));
  return {
    close: () => client.close(),
    host: {
      async listTools() {
        return (await client.listTools()).tools.map(t => ({ name: t.name, description: t.description ?? '', schema: t.inputSchema }));
      },
      async callTool(name, args) {
        const res: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
        const text = (res.content ?? []).map((c: any) => (c.type === 'text' ? c.text : '')).join('');
        return { text, isError: !!res.isError };
      },
    },
  };
}

async function main() {
  const task = process.argv.slice(2).join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
  if (!task) { console.error('usage: loop.ts "<problem>"'); process.exit(2); }
  const chain = parseChain(chainSpec(process.env), loadKey);   // NS_LOOP_OFFLINE=1: ollama only, no key needed
  const { host, close } = await mcpHost();
  const hardMs = Number(process.env.NS_LOOP_TIMEOUT_S ?? 300) * 1000;
  const guard = setTimeout(() => { console.error('[loop] hard timeout'); process.exit(3); }, hardMs + 15_000);   // backstop if a tool call hangs
  try {
    const skill = skillFor(task);
    const toolNames = (await host.listTools()).map(t => t.name);
    const mode: Mode = process.env.NS_LOOP_MODE === 'ask' ? 'ask' : 'fix';
    const res = await runLoop({ task, mode, system: systemFor(skill, mode), localAddendum: mode === 'fix' ? localAddendum(skill, toolNames) : undefined, chain, host: mode === 'ask' ? readOnlyHost(host) : host, maxSteps: Number(process.env.NS_LOOP_MAX_STEPS ?? 8), timeoutMs: hardMs });
    console.log(JSON.stringify(res));
    clearTimeout(guard);
    await close().catch(() => {});
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, stopReason: 'error', final: (e as Error).message.replace(/AIza\S+/g, '<key>') }));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
