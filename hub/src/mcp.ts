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
    description: 'Run a shell command on a managed device through the Nightshift gate. The gate classifies it from policy: read runs now, named fixes (restart-web, rotate-logs, restore-config, wifi-enable, wifi-bounce) may need a human press the first times, destructive needs press and hold, forbidden is refused. Returns done with exitCode and output, or pending (call get_result), or denied.',
    inputSchema: {
      device: z.string().describe('device id, see list_devices (e.g. web-1, web-2, pixel)'),
      command: z.string().describe('shell command, or a named fix such as restart-web'),
      reason: z.string().describe('why, shown to the human on the Lantern'),
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
    description: 'Check a grant returned as pending by run_command. Waits up to about 45 seconds.',
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
  { description: 'List managed devices with kind, capabilities and online status.', inputSchema: {} },
  async () => text(gw.listDevices()),
);

await server.connect(new StdioServerTransport());
console.error('nightshift MCP ready');
