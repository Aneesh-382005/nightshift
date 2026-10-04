// MCP stdio server: run_command, get_result, list_devices. stdout is the protocol channel, so all logging goes to stderr.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { connectGate } from './hub.js';
import { Gateway, type RunResult } from './gateway.js';

const conn = await connectGate();
const gw = new Gateway(conn);

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
