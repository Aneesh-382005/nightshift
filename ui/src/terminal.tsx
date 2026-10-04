import { useEffect, useMemo, useRef, useState } from 'react'
import { decisionsByGrant, parseVitals } from './story'

interface Grant { id: bigint; target: string; capability: string; reason: string; command: string; status: string; createdAtUs: bigint }
interface Result { grantId: bigint; device: string; exitCode: number; output: string; healthOk: boolean; rolledBack: boolean; tsUs: bigint }
interface Ev { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }
interface Inc { id: bigint; device: string }

type Tone = 'ok' | 'bad' | 'wait' | 'dim'
interface Block { id: bigint; ts: bigint; device: string; command: string; out: string[]; status: { tone: Tone; text: string }; lines: number; patrol?: { ok: boolean; text: string } }

const COLLAPSED = 6
const MAX_LINES = 40

function toBlock(g: Grant, r: Result | undefined, why: string | undefined): Block {
  const out = r && r.output.trim() ? r.output.replace(/\s+$/, '').split('\n') : []
  const shown = Math.min(out.length, COLLAPSED)
  let status: Block['status']
  if (r) {
    const bad = r.exitCode !== 0 || !r.healthOk
    status = {
      tone: bad ? 'bad' : 'ok',
      text: `exit ${r.exitCode} · health ${r.healthOk ? 'ok' : 'failed'}${r.rolledBack ? ' · rolled back' : ''}`,
    }
  } else if (g.status === 'pending') status = { tone: 'wait', text: 'waiting for a press on the Lantern...' }
  else if (g.status === 'denied') status = { tone: 'bad', text: why ? `blocked: ${why}` : 'blocked, nothing ran' }
  else if (g.status === 'active') status = { tone: 'wait', text: 'running...' }
  else status = { tone: 'dim', text: g.status === 'expired' ? 'expired, nothing ran' : g.status }
  return { id: g.id, ts: g.createdAtUs, device: g.target, command: g.command || g.reason, out, status, lines: 2 + shown }
}

const PATROL_GAP_US = 30_000_000n

// The agent's routine checks, from vitals events. At most one line per device per 30 s, but a change
// between ok and failing is always shown, so the first failure and the recovery are never hidden.
function patrolBlocks(events: readonly Ev[]): Block[] {
  const asc = events.filter(e => e.kind === 'vitals' && e.device).sort((a, b) => (a.id < b.id ? -1 : 1))
  const last = new Map<string, { ts: bigint; ok: boolean }>()
  const out: Block[] = []
  for (const e of asc) {
    const v = parseVitals(e.detail)
    const prev = last.get(e.device)
    if (prev && prev.ok === v.ok && e.tsUs - prev.ts < PATROL_GAP_US) continue
    last.set(e.device, { ts: e.tsUs, ok: v.ok })
    const bits = [
      v.health !== undefined ? `health ${v.health || 'down'}` : '',
      v.diskPct !== undefined && !isNaN(v.diskPct) ? `disk ${Math.round(v.diskPct)}%` : '',
      v.wifi !== undefined ? `wifi ${v.wifi}` : '',
    ].filter(Boolean).join(', ')
    out.push({
      id: e.id, ts: e.tsUs, device: e.device, command: '', out: [], lines: 1,
      status: { tone: v.ok ? 'dim' : 'bad', text: '' },
      patrol: { ok: v.ok, text: `patrol: ${bits || 'checked'}  ${v.ok ? 'ok' : 'FAILING'}` },
    })
  }
  return out
}

export function AgentTerminal({ grants, results, events }: { grants: readonly Grant[]; results: readonly Result[]; events: readonly Ev[] }) {
  const [device, setDevice] = useState('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const box = useRef<HTMLDivElement>(null)

  const blocks = useMemo(() => {
    const res = new Map(results.map(r => [r.grantId, r]))
    const dec = decisionsByGrant(events)
    const cmds = [...grants].filter(g => g.capability.startsWith('shell.')).sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(g => toBlock(g, res.get(g.id), dec.get(g.id)?.reason.replace(/^Blocked:\s*/, '')))
    return [...cmds, ...patrolBlocks(events)].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1))
  }, [grants, results, events])

  const devices = useMemo(() => ['all', ...[...new Set(blocks.map(b => b.device))].sort()], [blocks])
  const filtered = blocks.filter(b => device === 'all' || b.device === device)

  // Keep the newest blocks that fit in 40 lines (collapsed size), oldest first.
  const visible = useMemo(() => {
    const keep: Block[] = []
    let used = 0
    for (let i = filtered.length - 1; i >= 0; i--) {
      const lines = open.has(filtered[i].id.toString()) ? 2 + filtered[i].out.length : filtered[i].lines
      if (used + lines > MAX_LINES && keep.length > 0) break
      keep.unshift(filtered[i]); used += lines
    }
    return keep
  }, [filtered, open])

  const tail = visible.length ? `${visible[visible.length - 1].id}:${visible[visible.length - 1].status.text}` : ''
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight }, [tail, visible.length])

  const toggle = (id: bigint) => setOpen(s => { const n = new Set(s); const k = id.toString(); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <section className="terminal" aria-label="Agent terminal">
      <header className="term-bar">
        <span className="term-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="term-title">nightshift@garden</span>
        <span className="term-filter" role="radiogroup" aria-label="Device filter">
          {devices.map(d => (
            <button key={d} role="radio" aria-checked={device === d} className={device === d ? 'on' : ''} onClick={() => setDevice(d)}>{d === 'all' ? 'all devices' : d}</button>
          ))}
        </span>
      </header>
      <div className="term-body" ref={box}>
        {visible.length === 0 && <div className="t-dim">Nothing has run yet. <span className="cursor" /></div>}
        {visible.map(b => {
          if (b.patrol) {
            return <div key={`p${b.id}`} className={`t-patrol ${b.patrol.ok ? 'dim' : 'bad'}`}><span className="t-ps">{b.device}$</span> {b.patrol.text}</div>
          }
          const expanded = open.has(b.id.toString())
          const out = expanded ? b.out : b.out.slice(0, COLLAPSED)
          const more = b.out.length - COLLAPSED
          return (
            <div key={b.id.toString()} className="t-block">
              <div className="t-prompt"><span className="t-ps">{b.device}$</span> {b.command}</div>
              {out.map((l, i) => <div key={i} className="t-out">{l}</div>)}
              {more > 0 && (
                <button className="t-more" onClick={() => toggle(b.id)} aria-expanded={expanded}>{expanded ? 'show less' : `... ${more} more line${more === 1 ? '' : 's'}, click to expand`}</button>
              )}
              <div className={`t-status ${b.status.tone}`}>{b.status.text}{b.status.tone === 'wait' && <span className="cursor" />}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function parseThought(e: Ev): { id: bigint; text: string; incident?: string } | null {
  try {
    const j = JSON.parse(e.detail)
    const text = typeof j.text === 'string' ? j.text.trim() : ''
    return text ? { id: e.id, text, incident: j.incident != null && j.incident !== '' ? String(j.incident) : undefined } : null
  } catch { return null }
}

function Typewriter({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length)
  useEffect(() => {
    if (!animate) return
    const t = setInterval(() => setN(v => { if (v >= text.length) { clearInterval(t); return v } return v + 2 }), 22)
    return () => clearInterval(t)
  }, [text, animate])
  return <>{text.slice(0, n)}{n < text.length && <span className="cursor" />}</>
}

export function AgentReasoning({ events, incidents, device }: { events: readonly Ev[]; incidents: readonly Inc[]; device?: string }) {
  // Only thoughts that arrive after this page opened get the typing animation.
  const mountMax = useRef<bigint | null>(null)
  if (mountMax.current === null) mountMax.current = events.reduce((m, e) => (e.kind === 'agent.thought' && e.id > m ? e.id : m), 0n)
  const endRef = useRef<HTMLDivElement>(null)
  const thoughts = useMemo(() => {
    const incDevice = new Map(incidents.map(i => [i.id.toString(), i.device]))
    return events.filter(e => e.kind === 'agent.thought').map(parseThought).filter((t): t is NonNullable<typeof t> => t !== null)
      .filter(t => !device || device === 'all' || !t.incident || !incDevice.has(t.incident) || incDevice.get(t.incident) === device)
      .slice(0, 8).reverse() // events arrive newest first; the feed reads oldest to newest
  }, [events, incidents, device])
  const newest = thoughts.length ? thoughts[thoughts.length - 1].id : 0n
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [newest])
  return (
    <section className="reasoning" aria-label="Agent reasoning">
      <h2 className="sect">What Nightshift is thinking</h2>
      <div className="thoughts" aria-live="polite">
        {thoughts.length === 0 && <p className="muted">Waiting for the agent to think out loud.</p>}
        {thoughts.map(t => (
          <div key={t.id.toString()} className="thought">
            <Typewriter text={t.text} animate={t.id === newest && t.id > (mountMax.current ?? 0n)} />
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  )
}
