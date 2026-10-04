// Skills library: skills/*.md at the repo root -> `skill` table (upsertSkill, source "library"), and keyword search over it.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { Conn } from './hub.js';

export const SKILLS_DIR = resolve(import.meta.dirname, '../../skills');

export interface ParsedSkill {
  slug: string; title: string; category: string; tags: string; summary: string; body: string; runbook: string; risk: string;
}

export function parseSkillFile(text: string): ParsedSkill | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return undefined;
  let fm: Record<string, unknown>;
  try { fm = parse(m[1]) as Record<string, unknown>; } catch { return undefined; }
  if (!fm || typeof fm !== 'object') return undefined;
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
  const slug = str(fm.slug), title = str(fm.title);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !title) return undefined;
  const body = m[2].trim();
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? '';
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String).join(',') : str(fm.tags);
  return { slug, title, category: str(fm.category) || 'general', tags, summary: h1, body, runbook: str(fm.runbook), risk: str(fm.risk) || 'low' };
}

export async function syncSkills(conn: Conn, dir = SKILLS_DIR): Promise<{ synced: number; skipped: string[] }> {
  const skipped: string[] = [];
  let synced = 0;
  if (!existsSync(dir)) return { synced, skipped: ['skills/ directory does not exist'] };
  for (const f of readdirSync(dir).filter(n => n.endsWith('.md')).sort()) {
    const sk = parseSkillFile(readFileSync(resolve(dir, f), 'utf8'));
    if (!sk) { skipped.push(f); continue; }
    try { await conn.reducers.upsertSkill({ ...sk, source: 'library' }); synced++; }
    catch (e) { skipped.push(`${f} (${(e as Error).message})`); }
  }
  return { synced, skipped };
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2));

export interface SkillRow { slug: string; title: string; tags: string; summary: string; risk: string; runbook: string }

// Keyword overlap: slug, title and tags count 2 per shared word, summary counts 1. Top 3 with a score above zero.
export function searchSkills(rows: Iterable<SkillRow>, query: string, limit = 3) {
  const q = tokens(query);
  const scored: { score: number; r: SkillRow }[] = [];
  for (const r of rows) {
    let score = 0;
    for (const t of tokens(`${r.slug} ${r.title} ${r.tags}`)) if (q.has(t)) score += 2;
    for (const t of tokens(r.summary)) if (q.has(t)) score += 1;
    if (score > 0) scored.push({ score, r });
  }
  scored.sort((a, b) => b.score - a.score || a.r.slug.localeCompare(b.r.slug));
  return scored.slice(0, limit).map(({ r }) => ({ slug: r.slug, title: r.title, risk: r.risk, runbook: r.runbook, summary: r.summary }));
}
