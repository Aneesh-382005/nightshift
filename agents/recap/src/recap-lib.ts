// Pure aggregation: table rows in, recap.json shape out. No DB access here (tested with fixtures).

export interface Rows {
  incidents: { id: bigint; device: string; alert: string; runbookId: string; status: string; attempts: number; tsUs: bigint }[];
  events: { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }[];
  changes: { id: bigint; grantId: bigint; device: string; command: string; status: string; tsUs: bigint }[];
  grants: { id: bigint; target: string; capability: string; command: string; status: string; decidedBy: string; createdAtUs: bigint }[];
  results: { grantId: bigint; device: string; exitCode: number; healthOk: boolean; rolledBack: boolean; tsUs: bigint }[];
  trust: { runbookId: string; deviceType: string; successes: number; failures: number; level: number }[];
}

export type How = 'alone' | 'approved' | 'escalated' | 'undone' | 'failed' | 'open';
export interface IncidentLine { id: number; device: string; broke: string; fixed: string; how: How; seconds: number | null; status: string; tsUs: number }
export interface Recap {
  generatedAt: string;
  window: { hours: number; fromIso: string; toIso: string; firstLocal: string; lastLocal: string };
  counts: { fixedAlone: number; approved: number; blocked: number; undone: number; incidents: number; escalated: number };
  incidents: IncidentLine[];
  cost: { usd: number; tokens: number; seconds: number; commands: number; presses: number; runs: number };
  trust: { trusted: number; total: number; promotedTonight: number };
  definitions: Record<string, string>;
}

const WRITE = ['shell.write', 'shell.destructive'];
const FIXED_TEXT: Record<string, string> = {
  'restart-web': 'restarted the service',
  'restore-config': 'restored the known-good config',
  'rotate-logs': 'rotated logs, deleted nothing',
  'rotate-tmp': 'rotated temp, deleted nothing',
  'wifi-enable': 'turned Wi-Fi back on',
  'wifi-bounce': 'bounced Wi-Fi',
  'restore-folder': 'restored the folder from the snapshot',
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function buildRecap(rows: Rows, opts: { hours: number; nowUs: number }): Recap {
  const from = opts.hours > 0 ? opts.nowUs - opts.hours * 3_600_000_000 : 0;
  const n = (b: bigint) => Number(b);
  const incidents = rows.incidents.filter(i => n(i.tsUs) >= from).sort((a, b) => n(a.tsUs) - n(b.tsUs));
  const grants = rows.grants.filter(g => n(g.createdAtUs) >= from);
  const events = rows.events.filter(e => n(e.tsUs) >= from);
  const changes = rows.changes.filter(c => n(c.tsUs) >= from);
  const resultOf = new Map(rows.results.map(r => [String(r.grantId), r]));
  const writeGrants = grants.filter(g => WRITE.includes(g.capability));

  const lines: IncidentLine[] = incidents.map((inc, idx) => {
    const t0 = n(inc.tsUs);
    const next = incidents.slice(idx + 1).find(x => x.device === inc.device);
    const t1 = next ? n(next.tsUs) : Infinity;
    const linked = writeGrants.filter(g => g.target === inc.device && n(g.createdAtUs) >= t0 - 5_000_000 && n(g.createdAtUs) < t1);
    const done = linked.map(g => resultOf.get(String(g.id))).filter(Boolean) as Rows['results'];
    const lastDone = done.sort((a, b) => n(b.tsUs) - n(a.tsUs))[0];
    const byYou = linked.some(g => g.decidedBy === 'warden' && g.status !== 'denied');
    let how: How;
    if (inc.status === 'healed') how = byYou ? 'approved' : 'alone';
    else if (inc.status === 'rolled_back') how = 'undone';
    else if (inc.status === 'escalated') how = 'escalated';
    else if (inc.status === 'open') how = 'open';
    else how = 'failed';
    const lastCmd = [...linked].reverse().find(g => resultOf.get(String(g.id))?.healthOk)?.command ?? '';
    const fixed = how === 'escalated' ? 'needed a human' : how === 'failed' ? 'needed a human' : how === 'undone' ? 'tried a fix, rolled it back'
      : how === 'open' ? 'still working' : FIXED_TEXT[inc.runbookId] ?? (lastCmd ? clip(lastCmd, 40) : inc.runbookId.replace(/-/g, ' ') || 'fixed');
    const seconds = lastDone ? Math.max(0, Math.round((n(lastDone.tsUs) - t0) / 1e6)) : null;
    return { id: n(inc.id), device: inc.device, broke: clip(inc.alert.replace(/\s+/g, ' ').trim(), 60), fixed, how, seconds, status: inc.status, tsUs: t0 };
  });

  const cost = { usd: 0, tokens: 0, seconds: 0, commands: 0, presses: 0, runs: 0 };
  for (const e of events) {
    if (e.kind !== 'cost.update') continue;
    try {
      const d = JSON.parse(e.detail);
      cost.usd += Number(d.usd) || 0; cost.tokens += Number(d.tokens) || 0; cost.seconds += Number(d.seconds) || 0;
      cost.commands += Number(d.commands) || 0; cost.presses += Number(d.presses) || 0; cost.runs++;
    } catch { /* ignore bad detail */ }
  }
  cost.usd = Math.round(cost.usd * 10000) / 10000;

  const real = events.filter(e => e.kind !== 'vitals');
  const ts = [...real.map(e => n(e.tsUs)), ...lines.map(l => l.tsUs)];
  const first = ts.length ? Math.min(...ts) : opts.nowUs, last = ts.length ? Math.max(...ts) : opts.nowUs;

  return {
    generatedAt: new Date(opts.nowUs / 1000).toISOString(),
    window: {
      hours: opts.hours, fromIso: new Date((from || first) / 1000).toISOString(), toIso: new Date(opts.nowUs / 1000).toISOString(),
      firstLocal: when(first / 1000), lastLocal: when(last / 1000),
    },
    counts: {
      fixedAlone: lines.filter(l => l.how === 'alone').length,
      approved: writeGrants.filter(g => g.decidedBy === 'warden' && g.status !== 'denied').length,
      blocked: grants.filter(g => g.status === 'denied' && g.decidedBy === 'gate').length,
      undone: changes.filter(c => c.status === 'rolled_back').length,
      incidents: lines.length,
      escalated: lines.filter(l => l.how === 'escalated').length,
    },
    incidents: lines,
    cost,
    trust: { trusted: rows.trust.filter(t => t.level === 1).length, total: rows.trust.length, promotedTonight: events.filter(e => e.kind === 'trust.promoted').length },
    definitions: {
      fixedAlone: 'healed incidents with no warden approval',
      approved: 'write/destructive grants approved by the warden (a press)',
      blocked: 'grants denied by policy (gate), no press needed',
      undone: 'changes marked rolled_back (auto-rollback or the undo button)',
    },
  };
}
