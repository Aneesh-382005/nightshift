import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export type Class = 'forbidden' | 'autonomous' | 'read' | 'write' | 'destructive';

export interface Fix {
  id: string;
  match: RegExp;
  capability: string;
  command: string;
  snapshots: Record<string, unknown>[];
  inverse: string;
  health: string;
  risk: string;
  timeoutS: number;
}

export interface Policy {
  deviceType: string;
  forbidden: RegExp[];
  read: RegExp[];
  write: RegExp[];
  destructive: RegExp[];
  autonomous: Fix[];
}

export interface Verdict {
  cls: Class;
  reason: string;
  fix?: Fix;
}

export const WORKSPACES = resolve(dirname(fileURLToPath(import.meta.url)), '../../workspaces');

// Anything that can chain, redirect or substitute commands.
const META = /[;&|`<>\n\r]|\$\(/;

const cache = new Map<string, Policy>();

function rx(list: unknown, where: string): RegExp[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`${where}: expected a list`);
  return list.map((s, i) => {
    try { return new RegExp(String(s)); } catch (e) { throw new Error(`${where}[${i}]: bad regex ${s}: ${(e as Error).message}`); }
  });
}

export function loadPolicy(deviceType: string): Policy {
  const hit = cache.get(deviceType);
  if (hit) return hit;
  if (!/^[a-z0-9-]+$/.test(deviceType)) throw new Error(`bad device type ${deviceType}`);
  const doc = parse(readFileSync(resolve(WORKSPACES, deviceType, 'policy.yaml'), 'utf8')) as Record<string, any>;
  const p: Policy = {
    deviceType: String(doc.deviceType ?? deviceType),
    forbidden: rx(doc.forbidden, 'forbidden'),
    read: rx(doc.read, 'read'),
    write: rx(doc.write, 'write'),
    destructive: rx(doc.destructive, 'destructive'),
    autonomous: (doc.autonomous ?? []).map((f: any, i: number): Fix => {
      for (const k of ['id', 'match', 'command', 'health']) {
        if (typeof f[k] !== 'string' || f[k].length === 0) throw new Error(`autonomous[${i}].${k} missing`);
      }
      if (f.capability !== 'shell.write') throw new Error(`autonomous[${i}].capability must be shell.write`);
      return {
        id: f.id, match: new RegExp(f.match), capability: f.capability, command: f.command,
        snapshots: f.snapshots ?? [], inverse: String(f.inverse ?? ''), health: f.health, risk: String(f.risk ?? 'low'),
        timeoutS: Number(f.timeoutS ?? 30),
      };
    }),
  };
  cache.set(deviceType, p);
  return p;
}

// Never trust the agent's own classification. Order:
// forbidden > autonomous (exact, no metachar) > destructive > any metachar (destructive) > read > write > default destructive.
export function classify(commandRaw: string, deviceType: string): Verdict {
  const command = commandRaw.trim();
  const p = loadPolicy(deviceType);
  if (command.length === 0) return { cls: 'forbidden', reason: 'empty command' };
  if (command.length > 2000) return { cls: 'forbidden', reason: 'command too long' };
  for (const r of p.forbidden) if (r.test(command)) return { cls: 'forbidden', reason: `matches forbidden pattern ${r.source}` };
  const meta = META.test(command);
  if (!meta) {
    for (const f of p.autonomous) if (f.match.test(command)) return { cls: 'autonomous', reason: `allowlisted fix ${f.id}`, fix: f };
  }
  for (const r of p.destructive) if (r.test(command)) return { cls: 'destructive', reason: `matches destructive pattern ${r.source}` };
  if (meta) return { cls: 'destructive', reason: 'shell metacharacters (chaining or redirection)' };
  for (const r of p.read) if (r.test(command)) return { cls: 'read', reason: 'read pattern' };
  for (const r of p.write) if (r.test(command)) return { cls: 'write', reason: 'write pattern' };
  return { cls: 'destructive', reason: 'unclassified, default is press and hold' };
}

export function deviceTypeFor(id: string, kind?: string): string {
  if (id === 'laptop') return 'laptop';
  if (id.startsWith('vps') || kind === 'host') return 'host';
  if (id.startsWith('pixel') || kind === 'phone' || kind === 'android') return 'android';
  return 'linux-server';
}

export function capabilityFor(cls: Class): string {
  if (cls === 'read') return 'shell.read';
  if (cls === 'destructive' || cls === 'forbidden') return 'shell.destructive';
  return 'shell.write';
}
