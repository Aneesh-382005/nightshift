// Live model check WITHOUT the hub: real model adapters, fake tool host that pretends web-1 is down and
// restart-web works. Usage: NS_LOOP_CHAIN=gemini:gemini-3.8-flash npx tsx src/try-models.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLoop, type ToolHost } from './loop.js';
import { parseChain } from './models.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skill = fs.readFileSync(path.join(ROOT, 'workspaces/linux-server/SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
let fixed = false;
const host: ToolHost = {
  async listTools() {
    return [
      { name: 'run_command', description: 'Run a command on a device through the gate. Named fixes: restart-web, rotate-logs, restore-config. Returns done, pending or denied.',
        schema: { type: 'object', properties: { device: { type: 'string' }, command: { type: 'string' }, reason: { type: 'string' } }, required: ['device', 'command', 'reason'], additionalProperties: false, $schema: 'x' } },
      { name: 'get_result', description: 'Check a pending grant.', schema: { type: 'object', properties: { grantId: { type: 'integer' } }, required: ['grantId'] } },
      { name: 'list_devices', description: 'List devices.', schema: { type: 'object', properties: { filter: { type: 'string' } } } },
    ];
  },
  async callTool(name, args) {
    const cmd = String(args.command ?? '');
    let out: unknown = { status: 'error', error: 'unknown' };
    if (name === 'run_command') {
      if (cmd === 'health') out = fixed ? { status: 'done', exitCode: 0, output: 'ok' } : { status: 'done', exitCode: 1, output: 'connection refused' };
      else if (cmd.startsWith('tail')) out = { status: 'done', exitCode: 0, output: 'ERROR web: process exited, port 8080 closed' };
      else if (cmd === 'restart-web') { fixed = true; out = { status: 'done', exitCode: 0, healthOk: true }; }
      else out = { status: 'denied', error: 'not allowed' };
    }
    return { text: JSON.stringify(out), isError: false };
  },
};
const key = () => process.env.GEMINI_API_KEY ?? (fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/GEMINI_API_KEY\s*=\s*(\S+)/)?.[1] ?? '');
const chain = parseChain(process.env.NS_LOOP_CHAIN ?? 'gemini:gemini-3.8-flash', key);
const r = await runLoop({ task: 'Alert on web-1: service down, port 8080 not responding. Fix it.', system: `You are Nightshift. Runbook:\n\n${skill}`, chain, host, timeoutMs: Number(process.env.NS_LOOP_TIMEOUT_S ?? 300) * 1000 });
console.log(JSON.stringify(r, null, 1));
