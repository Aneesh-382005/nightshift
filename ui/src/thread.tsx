import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducer } from 'spacetimedb/react'
import { reducers } from './module_bindings'
import { ageSeconds, fmtAge, fmtTime } from './lib'

interface Ev { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }
interface Req { id: bigint; text: string; status: string; result: string; tsUs: bigint }
interface Inc { id: bigint; device: string; alert: string; status: string }

export interface Attachment { type: string; ref: string }
export interface ChatMsg { key: string; from: 'you' | 'nightshift'; text: string; tsUs: bigint; attachments: Attachment[]; incident?: string; requestId?: string }

// chat.message detail: {"from","text","requestId","incident","attachments":[{"type","ref"}]}. Parse defensively.
export function parseChat(e: Ev): ChatMsg | null {
  try {
    const j = JSON.parse(e.detail)
    const text = typeof j.text === 'string' ? j.text : ''
    const atts: Attachment[] = Array.isArray(j.attachments)
      ? j.attachments.filter((a: unknown) => a && typeof (a as Attachment).type === 'string').map((a: Attachment) => ({ type: a.type, ref: String(a.ref ?? '') }))
      : []
    if (!text && atts.length === 0) return null
    return {
      key: `c${e.id}`, from: j.from === 'you' ? 'you' : 'nightshift', text, tsUs: e.tsUs, attachments: atts,
      incident: j.incident != null && j.incident !== '' ? String(j.incident) : undefined,
      requestId: j.requestId != null && j.requestId !== '' ? String(j.requestId) : undefined,
    }
  } catch { return null }
}

// The latest diagnosis Nightshift wrote about an incident, if any.
export function diagnosisFor(events: readonly Ev[], incidentId: bigint): string | undefined {
  for (const e of events) { // newest first
    if (e.kind !== 'chat.message') continue
    const m = parseChat(e)
    if (m && m.from === 'nightshift' && m.incident === incidentId.toString() && m.text) return m.text
  }
  return undefined
}

const PREVIEW_PORT: Record<string, number> = { 'web-1': 18081, 'web-2': 18082 }

export function LivePreview({ device, onProbe }: { device: string; onProbe?: (ok: boolean) => void }) {
  const port = PREVIEW_PORT[device]
  const url = port ? `http://${window.location.hostname}:${port}/` : ''
  const [up, setUp] = useState<boolean | null>(null)
  const [bump, setBump] = useState(0)
  const was = useRef<boolean | null>(null)
  useEffect(() => {
    if (!url) return
    let alive = true
    const probe = async () => {
      let ok = true
      try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2500) }) } catch { ok = false }
      if (!alive) return
      if (ok && was.current === false) setBump(b => b + 1) // came back: reload the frame
      was.current = ok
      setUp(ok)
      onProbe?.(ok)
    }
    void probe()
    const t = setInterval(() => { void probe(); setBump(b => b + 1) }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!url) return <p className="muted">No preview for {device}.</p>
  return (
    <figure className="preview">
      {up === false || up === null ? (
        <div className="preview-off">{up === null ? 'Checking...' : `Not reachable from this device (or ${device} is down).`}</div>
      ) : (
        <iframe key={bump} src={url} title={`Live preview of ${device}`} sandbox="allow-scripts" loading="lazy" />
      )}
      <figcaption>Live preview of {device}</figcaption>
    </figure>
  )
}

export function Sparkline({ events, device }: { events: readonly Ev[]; device: string }) {
  const pts = useMemo(() => events.filter(e => e.kind === 'vitals' && e.device === device).slice(0, 30).reverse().map(e => {
    try { const j = JSON.parse(e.detail); return { health: Number(j.health ?? 0), disk: Number(j.diskPct ?? NaN) } } catch { return { health: 0, disk: NaN } }
  }), [events, device])
  if (pts.length === 0) return <p className="muted">No vitals for {device} yet.</p>
  const last = pts[pts.length - 1]
  const x = (i: number) => (pts.length === 1 ? 60 : (i / (pts.length - 1)) * 116 + 2)
  const disk = pts.map((p, i) => (isNaN(p.disk) ? null : `${x(i).toFixed(1)},${(28 - (Math.min(100, p.disk) / 100) * 26).toFixed(1)}`)).filter(Boolean).join(' ')
  return (
    <div className="vitals">
      <div className="vitals-now">
        <b className={last.health === 200 ? 'v-ok' : 'v-bad'}>health {last.health || 'down'}</b>
        {!isNaN(last.disk) && <span> · disk {Math.round(last.disk)}%</span>}
      </div>
      <svg viewBox="0 0 120 40" className="spark" role="img" aria-label={`Vitals for ${device}, last ${pts.length} readings`}>
        <polyline points={disk} fill="none" stroke="var(--lavender-line)" strokeWidth="1.6" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy="35" r="2" fill={p.health === 200 ? 'var(--green)' : 'var(--red)'} />)}
      </svg>
      <div className="muted small">{device}: last {pts.length} readings, line is disk %, dots are health</div>
    </div>
  )
}

export function LivePanel({ events }: { events: readonly Ev[] }) {
  const [device, setDevice] = useState('web-1')
  const [fails, setFails] = useState(0)
  const phone = useMediaQuery('(max-width: 700px)')
  // On a phone, two failed probes in a row hide the panel. The probe keeps running (the panel stays
  // mounted but hidden), so it comes back by itself once the preview is reachable.
  const hide = phone && fails >= 2
  return (
    <>
      {hide && <div className="note live-note">Live preview is not reachable from this phone. Watch it on the laptop.</div>}
      <div className="note live" hidden={hide}>
      <h2 className="sect">Watch it live</h2>
      <div className="demo-devices" role="radiogroup" aria-label="Device to watch">
        {['web-1', 'web-2'].map(d => (
          <button key={d} role="radio" aria-checked={device === d} className={`demo-dev ${device === d ? 'on' : ''}`} onClick={() => { setDevice(d); setFails(0) }}>{d}</button>
        ))}
      </div>
      <LivePreview device={device} onProbe={ok => setFails(f => (ok ? 0 : f + 1))} />
      <Sparkline events={events} device={device} />
      </div>
    </>
  )
}

function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

function Typing() {
  return <div className="bubble them typing" aria-label="Nightshift is typing"><span /><span /><span /></div>
}

function Attach({ a, incidents, events, device }: { a: Attachment; incidents: readonly Inc[]; events: readonly Ev[]; device: string }) {
  if (a.type === 'incident') {
    const inc = incidents.find(i => i.id.toString() === a.ref)
    if (!inc) return null
    return (
      <a className="att inc-card" href={`#incident-${inc.id}`}>
        <b>{inc.device}: {inc.alert}</b>
        <span className="muted small">Incident #{inc.id.toString()} · {inc.status.replace('_', ' ')} · see the story</span>
      </a>
    )
  }
  if (a.type === 'video') {
    const done = events.find(e => e.kind === 'recap.done')
    const src = done ? `/recap/latest.mp4?t=${done.tsUs.toString()}` : ''
    return src ? <div className="att"><video src={src} controls playsInline preload="metadata" /></div> : <div className="att muted">Video is not ready yet.</div>
  }
  if (a.type === 'preview') return <div className="att"><LivePreview device={a.ref || device || 'web-1'} /></div>
  if (a.type === 'vitals') return <div className="att"><Sparkline events={events} device={a.ref || device || 'web-1'} /></div>
  return null
}

export function Thread({ requests, events, incidents, now }: { requests: readonly Req[]; events: readonly Ev[]; incidents: readonly Inc[]; now: bigint }) {
  const submit = useReducer(reducers.submitRequest)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const msgs = useMemo(() => {
    const out: ChatMsg[] = []
    const chat = events.filter(e => e.kind === 'chat.message').map(parseChat).filter((m): m is ChatMsg => m !== null)
    const replied = new Set(chat.filter(m => m.from === 'nightshift' && m.requestId).map(m => m.requestId))
    const reqIds = new Set(requests.map(r => r.id.toString()))
    const reqTexts = new Set(requests.map(r => r.text))
    for (const r of requests) {
      out.push({ key: `r${r.id}`, from: 'you', text: r.text, tsUs: r.tsUs, attachments: [] })
      // The request's own result stands in as a reply when no chat reply points at it.
      if (r.result && !replied.has(r.id.toString())) out.push({ key: `rr${r.id}`, from: 'nightshift', text: r.result, tsUs: r.tsUs + 1n, attachments: [] })
    }
    for (const m of chat) {
      if (m.from === 'you' && ((m.requestId && reqIds.has(m.requestId)) || reqTexts.has(m.text))) continue
      out.push(m)
    }
    return out.sort((a, b) => (a.tsUs < b.tsUs ? -1 : a.tsUs > b.tsUs ? 1 : a.key < b.key ? -1 : 1)).slice(-14)
  }, [requests, events])

  const typing = requests.some(r => (r.status === 'new' || r.status === 'running') && ageSeconds(r.tsUs, now) < 600)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [msgs.length, typing])

  async function send() {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true); setErr('')
    try { await submit({ text: v }); setText('') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="note thread">
      <h2 className="sect">Nightshift thread</h2>
      <div className="msgs" aria-live="polite">
        {msgs.length === 0 && <p className="muted">Say something, or break something. Nightshift answers here.</p>}
        {msgs.map(m => (
          <div key={m.key} className={`msg ${m.from === 'you' ? 'me' : 'them'}`}>
            {m.text && <div className={`bubble ${m.from === 'you' ? 'me' : 'them'}`}>{m.text}</div>}
            {m.attachments.map((a, i) => <Attach key={i} a={a} incidents={incidents} events={events} device={incidents.find(x => x.id.toString() === m.incident)?.device ?? ''} />)}
            <div className="muted small msg-time">{m.from === 'you' ? 'you' : 'Nightshift'} · {fmtTime(m.tsUs)} · {fmtAge(ageSeconds(m.tsUs, now))}</div>
          </div>
        ))}
        {typing && <Typing />}
        <div ref={endRef} />
      </div>
      <form className="req" onSubmit={e => { e.preventDefault(); void send() }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="e.g. web-1 is slow, check it" maxLength={500} aria-label="Message Nightshift" />
        <button type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
      {err && <p className="err">{err}</p>}
    </section>
  )
}
