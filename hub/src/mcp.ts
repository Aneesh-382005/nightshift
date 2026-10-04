// MCP stdio server: run_command, get_result, list_devices. stdout is the protocol channel, so all logging goes to stderr.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { connectGate } from './hub.js';
import { Gateway, type RunResult } from './gateway.js';
import { searchSkills } from './skills.js';

const conn = await connectGate();
const gw = new Gateway(conn);

const text_ = (o: string, isError = false) => ({ content: [{ type: 'text' as const, text: o }], isError });
const text = (o: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o) }], isError });
const hint = (r: RunResult) => {
  if (r.status === 'pending') return { ...r, next: 'A human has to press the Lantern. Wait, then call get_result with this grantId. Do not resend the command.' };
  if (r.status === 'denied') return { ...r, next: 'Stop this approach. Do not try to work around it. Report it.' };
  if (r.escalated) return { ...r, next: 'Escalated to the human. Do not keep retrying.' };
  return r;
};

const server = new McpServer({ name: 'nightshift', version: '0.1.0' });

server.registerTool(
  'run_command',
  {
    description: 'Run a command on a device through the gate. Named fixes: restart-web, rotate-logs, restore-config, wifi-enable, wifi-bounce. Returns done, pending (use get_result) or denied.',
    inputSchema: {
      device: z.string().describe('web-1, web-2 or pixel'),
      command: z.string().describe('command or named fix'),
      reason: z.string().describe('why, shown on the Lantern'),
    },
  },
  async ({ device, command, reason }) => {
    try {
      const r = await gw.runCommand({ device, command, reason });
      return text(hint(r), r.status === 'error');
    } catch (e) { return text(`gateway error: ${(e as Error).message}`, true); }
  },
);

server.registerTool(
  'get_result',
  {
    description: 'Check a pending grant. Waits up to 45s.',
    inputSchema: { grantId: z.number().int().describe('grantId from run_command') },
  },
  async ({ grantId }) => {
    try {
      const r = await gw.getResult(BigInt(grantId));
      return text(hint(r), r.status === 'error');
    } catch (e) { return text(`gateway error: ${(e as Error).message}`, true); }
  },
);

// Skills library: read-only, allowed in ask mode too. Each use is recorded so the dashboard shows what was consulted.
const useSkill = (slug: string, query: string) =>
  conn.reducers.recordSkillUse({ slug, query: query.slice(0, 200), requestId: BigInt(Number(process.env.NS_REQUEST_ID ?? 0) || 0) }).catch(() => undefined);

server.registerTool(
  'search_skills',
  {
    description: 'Search the skills library for known fixes before acting. Returns the top 3 matches (slug, title, risk, runbook, summary).',
    inputSchema: { query: z.string().describe('symptoms or keywords, e.g. "service down health 503"') },
  },
  async ({ query }) => {
    const hits = searchSkills(conn.db.skill.iter(), query);
    for (const h of hits) await useSkill(h.slug, query);
    return text(hits.length ? hits : 'no matching skill. Diagnose from health, logs, df and ls.');
  },
);

server.registerTool(
  'get_skill',
  {
    description: 'Search the skills library for known fixes before acting: this returns the full markdown of one skill by slug.',
    inputSchema: { slug: z.string().describe('slug from search_skills') },
  },
  async ({ slug }) => {
    const row = conn.db.skill.slug.find(slug);
    if (!row) return text(`no skill "${slug}". Use search_skills.`, true);
    await useSkill(slug, `get_skill ${slug}`);
    return text(row.body);
  },
);

// say: one sentence of reasoning shown on the dashboard. No policy, no grant. 12 per run (one MCP process per run).
let said = 0;
server.registerTool(
  'say',
  {
    description: 'Say one short sentence about what you are about to do and why. Shown to the human. Changes nothing.',
    inputSchema: { text: z.string().describe('one sentence, at most 240 characters'), device: z.string().optional().describe('device it is about') },
  },
  async ({ text, device }) => {
    if (said >= 12) return text_('say limit reached for this run (12). Carry on without it.', true);
    said++;
    const requestId = Number(process.env.NS_REQUEST_ID ?? 0) || undefined;
    const incident = Number(process.env.NS_INCIDENT_ID ?? 0) || undefined;
    try {
      await conn.reducers.logEvent({
        kind: 'agent.thought', device: device && gw.device(device) ? device : 'hub', grantId: 0n,
        detail: JSON.stringify({ text: text.replace(/\s+/g, ' ').trim().slice(0, 240), requestId, incident }),
      });
      return text_('ok');
    } catch (e) { return text_(`could not log: ${(e as Error).message}`, true); }
  },
);

server.registerTool(
  'list_devices',
  { description: 'List managed devices and whether they are online.', inputSchema: { filter: z.string().optional().describe('optional text to filter by id') } },
  async (args: { filter?: string }) => {
    console.error('list_devices args', JSON.stringify(args));
    const f = args?.filter?.toLowerCase();
    return text(gw.listDevices().filter(d => d.id !== 'test-box' && d.id !== 'demo-box' && (!f || d.id.includes(f))));
  },
);

await server.connect(new StdioServerTransport());
// The harness closing our stdin is the shutdown signal. Without this the open DB connection keeps the process alive forever.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => process.exit(0));
console.error('nightshift MCP ready');
