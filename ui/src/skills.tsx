import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ageSeconds } from './lib'

interface Skill { slug: string; title: string; category: string; tags: string; summary: string; body: string; runbook: string; risk: string; source: string; uses: number; updatedAtUs: bigint }
interface Ev { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }

const LIVE_S = 8
const RISK_CLASS: Record<string, string> = { safe: 'good', ask: 'pending', hold: 'bad' }

export function parseSkillUse(e: Ev): { slug: string; title: string; query: string; requestId: string } | null {
  try {
    const j = JSON.parse(e.detail)
    return { slug: String(j.slug ?? ''), title: String(j.title ?? ''), query: String(j.query ?? ''), requestId: j.requestId != null ? String(j.requestId) : '' }
  } catch { return null }
}

// Skill titles used for the request(s) raised for an incident. The hub puts "Incident #N." in the request text.
export function skillsUsedFor(
  incidentId: bigint, requests: readonly { id: bigint; text: string }[], events: readonly Ev[],
): string[] {
  const ids = new Set(requests.filter(r => r.text.includes(`Incident #${incidentId}.`)).map(r => r.id.toString()))
  if (ids.size === 0) return []
  const titles = new Set<string>()
  for (const e of events) {
    if (e.kind !== 'skill.used') continue
    const u = parseSkillUse(e)
    if (u && u.requestId && ids.has(u.requestId) && (u.title || u.slug)) titles.add(u.title || u.slug)
  }
  return [...titles]
}

// Tiny markdown: headings, lists, fenced code, paragraphs, **bold** and `code`. No dependency.
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i}>{p.slice(1, -1)}</code>
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>
    return <Fragment key={i}>{p}</Fragment>
  })
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      i++
      out.push(<pre key={out.length} className="md-code">{code.join('\n')}</pre>)
    } else if (/^#{1,4}\s/.test(l)) {
      const level = Math.min(4, l.match(/^#+/)![0].length)
      const text = l.replace(/^#+\s*/, '')
      out.push(level === 1 ? <h3 key={out.length}>{inline(text)}</h3> : <h4 key={out.length}>{inline(text)}</h4>)
      i++
    } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      const li = items.map((t, k) => <li key={k}>{inline(t)}</li>)
      out.push(ordered ? <ol key={out.length}>{li}</ol> : <ul key={out.length}>{li}</ul>)
    } else if (l.trim() === '') {
      i++
    } else {
      const para: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++])
      out.push(<p key={out.length}>{inline(para.join(' '))}</p>)
    }
  }
  return <div className="md">{out}</div>
}

export function SkillsLibrary({ skills, events, now }: { skills: readonly Skill[]; events: readonly Ev[]; now: bigint }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const dlg = useRef<HTMLDialogElement>(null)

  // Newest skill.used per slug (events arrive newest first).
  const live = useMemo(() => {
    const m = new Map<string, { query: string; tsUs: bigint }>()
    for (const e of events) {
      if (e.kind !== 'skill.used') continue
      const u = parseSkillUse(e)
      if (u && u.slug && !m.has(u.slug)) m.set(u.slug, { query: u.query, tsUs: e.tsUs })
    }
    return m
  }, [events])
  const isLive = (slug: string) => { const l = live.get(slug); return l !== undefined && ageSeconds(l.tsUs, now) < LIVE_S }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...skills]
      .filter(s => !needle || s.title.toLowerCase().includes(needle) || s.tags.toLowerCase().includes(needle))
      .sort((a, b) => Number(isLive(b.slug)) - Number(isLive(a.slug)) || b.uses - a.uses || a.title.localeCompare(b.title))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, q, live, now])

  const current = skills.find(s => s.slug === open)
  useEffect(() => {
    const d = dlg.current
    if (!d) return
    if (current && !d.open) d.showModal()
    if (!current && d.open) d.close()
  }, [current])

  return (
    <section className="skills">
      <h2 className="sect">Skills library</h2>
      <p className="muted skills-head">{skills.length} skill{skills.length === 1 ? '' : 's'} in SpacetimeDB, synced from skills/*.md</p>
      <input className="skills-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by title or tag" aria-label="Search skills" />
      {skills.length === 0 ? <p className="muted">No skills synced yet.</p> : shown.length === 0 ? <p className="muted">No skill matches "{q}".</p> : (
        <div className="skill-grid">
          {shown.map(s => {
            const lv = isLive(s.slug) ? live.get(s.slug) : undefined
            return (
              <button key={s.slug} className={`skill-card ${lv ? 'is-live' : ''}`} onClick={() => setOpen(s.slug)}>
                {lv && <span className="live-badge">LIVE</span>}
                <span className="skill-title">{s.title}</span>
                <span className="skill-chips">
                  <span className="chip">{s.category}</span>
                  <span className={`chip ${RISK_CLASS[s.risk] ?? ''}`}>{s.risk}</span>
                  <span className="chip">uses: {s.uses}</span>
                </span>
                <span className="skill-runbook">{s.runbook ? `Runbook: ${s.runbook}` : 'no automatic fix yet'}</span>
                {lv && <span className="skill-live-q">Agent consulted this for: {lv.query || 'a request'}</span>}
              </button>
            )
          })}
        </div>
      )}
      <p className="muted small skills-foot">Table: skill (public, live subscription)</p>

      <dialog ref={dlg} className="skill-dialog" onClose={() => setOpen(null)} onClick={e => { if (e.target === dlg.current) setOpen(null) }}>
        {current && (
          <div className="skill-doc">
            <header>
              <h2>{current.title}</h2>
              <button className="ghost" onClick={() => setOpen(null)} aria-label="Close">Close</button>
            </header>
            <div className="skill-chips">
              <span className="chip">{current.category}</span>
              <span className={`chip ${RISK_CLASS[current.risk] ?? ''}`}>{current.risk}</span>
              <span className="chip">uses: {current.uses}</span>
              {current.tags && current.tags.split(/[,\s]+/).filter(Boolean).map(t => <span key={t} className="chip tag">{t}</span>)}
            </div>
            <p className="muted">{current.runbook ? `Automatic fix: ${current.runbook}` : 'No automatic fix yet.'}{current.source && ` · source ${current.source}`}</p>
            <Markdown source={current.body || current.summary} />
          </div>
        )}
      </dialog>
    </section>
  )
}
