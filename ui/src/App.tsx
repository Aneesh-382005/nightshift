import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react'
import { reducers, tables } from './module_bindings'
import {
  HUMAN_TICKET_USD, PROMOTE_AT, ageSeconds, fmtAge, fmtCountdown, fmtTime, nowUs, parseCost, type Cost,
} from './lib'
import { buildHero, buildStory, effectiveStatus, type Hero, type Hold, type Step } from './story'
import { FLOWER_LABEL, Flower, Garland, Hills, Plant, SkyBody, type FlowerState } from './garden'

type Theme = 'dark' | 'light'
const byIdDesc = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
const BLOCK_FLASH_S = 6
const HOLD_WILT_MS = 5000
const HOLD_HEAL_MS = 3000
const HOLD_FIXED_MS = 6000
const isPolicyBlock = (e: { kind: string; detail: string }) =>
  (e.kind === 'grant.denied' && e.detail.startsWith('policy')) || e.kind.startsWith('policy.')
const MAX_US = 0xffffffffffffffffn

function useNow(ms = 500): bigint {
  const [n, setN] = useState(nowUs)
  useEffect(() => {
    const t = setInterval(() => setN(nowUs()), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) ?? fallback } catch { return fallback }
}
function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v) } catch { /* ignore */ }
}

export default function App({ uri }: { uri: string }) {
  const conn = useSpacetimeDB()
  const now = useNow()
  const [showOffline, setShowOffline] = useState(() => readPref<string>('ns_offline', '0') === '1')
  useEffect(() => writePref('ns_offline', showOffline ? '1' : '0'), [showOffline])
  const [theme, setTheme] = useState<Theme>(() => readPref<Theme>('ns_theme', 'dark'))
  useEffect(() => { document.documentElement.dataset.theme = theme; writePref('ns_theme', theme) }, [theme])

  const [devices, devReady] = useTable(tables.device)
  const [grants] = useTable(tables.accessGrant)
  const [events] = useTable(tables.event)
  const [changes] = useTable(tables.change)
  const [incidents] = useTable(tables.incident)
  const [trusts] = useTable(tables.runbookTrust)
  const [results] = useTable(tables.runResult)
  const [requests] = useTable(tables.userRequest)

  const evSorted = useMemo(() => [...events].sort(byIdDesc), [events])
  const grantSorted = useMemo(() => [...grants].sort(byIdDesc), [grants])
  const grantById = useMemo(() => new Map(grants.map(g => [g.id, g])), [grants])
  const heroRaw = buildHero(devices, grants, incidents, events, now, requests)

  const incSorted = useMemo(() => [...incidents].sort(byIdDesc), [incidents])
  // Visual holds: a flower stays wilted >= 5 s, shows healing >= 3 s, then blooms with a Fixed banner >= 6 s.
  const phases = useRef(new Map<string, { phase: 'bloom' | 'wilted' | 'healing' | 'fixed'; since: number }>())
  const display = new Map<string, FlowerState>()
  const holds = new Map<string, Hold>()
  for (const d of devices) {
    const raw = flowerState(d.id, d.status)
    const ms = Date.now()
    let p = phases.current.get(d.id)
    if (!p) { p = { phase: raw === 'bloom' ? 'bloom' : 'wilted', since: ms }; phases.current.set(d.id, p) }
    if (raw !== 'bloom') {
      if (p.phase !== 'wilted') { p.phase = 'wilted'; p.since = ms }
      display.set(d.id, raw)
    } else {
      if (p.phase === 'wilted' && ms - p.since >= HOLD_WILT_MS) { p.phase = 'healing'; p.since = ms }
      if (p.phase === 'healing' && ms - p.since >= HOLD_HEAL_MS) { p.phase = 'fixed'; p.since = ms }
      if (p.phase === 'fixed' && ms - p.since >= HOLD_FIXED_MS) { p.phase = 'bloom'; p.since = ms }
      display.set(d.id, p.phase === 'wilted' ? 'wilted' : p.phase === 'healing' ? 'healing' : 'bloom')
    }
    if (p.phase !== 'bloom') holds.set(d.id, p.phase)
  }
  const fixedDev = devices.find(d => holds.get(d.id) === 'fixed' && incidents.some(i => i.device === d.id && i.status === 'healed'))

  const stories = incSorted.slice(0, 4).map(inc => {
    // Events belong to this incident until the next incident on the same device.
    const next = incidents.filter(o => o.device === inc.device && o.id > inc.id).reduce((m, o) => (o.tsUs < m ? o.tsUs : m), MAX_US)
    const latest = next === MAX_US
    const hold = latest ? holds.get(inc.device) : undefined
    let status = effectiveStatus(inc, events, requests, next)
    if (status === 'healed' && (hold === 'wilted' || hold === 'healing')) status = 'open'
    return { inc, steps: buildStory(inc, events, grantById, trusts, next, hold), status }
  })

  const trust = [...trusts].sort((a, b) => (a.updatedAtUs < b.updatedAtUs ? 1 : -1))[0]
  // Each cost.update event is one measured run. Show the last run and the average over all of them.
  const costRuns = useMemo(() => evSorted.filter(e => e.kind === 'cost.update').map(e => parseCost(e.detail)).filter((c): c is Cost => c !== null), [evSorted])
  const cost = costRuns[0] ?? null
  const avgUsd = costRuns.length ? costRuns.reduce((a, c) => a + c.usd, 0) / costRuns.length : 0
  const promotedNow = trust ? evSorted.some(e => e.kind === 'trust.promoted' && e.detail === trust.runbookId && ageSeconds(e.tsUs, now) < 20) : false

  // Devices offline for over 10 minutes are stale rows: hidden unless asked for.
  const isStale = (d: { status: string; lastHeartbeatUs: bigint }) => d.status !== 'online' && ageSeconds(d.lastHeartbeatUs, now) > 600
  const visibleDevices = devices.filter(d => showOffline || !isStale(d))
  const staleCount = devices.filter(isStale).length
  const pendingGrants = grants.filter(g => g.status === 'pending')
  const blockedEv = evSorted.find(e => isPolicyBlock(e) && ageSeconds(e.tsUs, now) < BLOCK_FLASH_S)
  const report = useMemo(() => {
    const work = grants.filter(g => g.capability !== 'shell.read' && g.status !== 'denied' && g.status !== 'pending')
    const costs = costRuns
    return {
      alone: work.filter(g => g.decidedBy === 'trust' || g.decidedBy === 'gate').length,
      approved: work.filter(g => g.decidedBy === 'warden').length,
      blocked: grants.filter(g => g.status === 'denied' && g.decidedBy === 'gate').length,
      undone: changes.filter(c => c.status === 'rolled_back').length,
      usd: costs.reduce((a, c) => a + c.usd, 0),
      seconds: costs.reduce((a, c) => a + c.seconds, 0),
    }
  }, [grants, changes, costRuns])
  let hero: Hero = heroRaw
  if (heroRaw.tone === 'idle' || heroRaw.tone === 'active') {
    const healing = devices.find(d => holds.get(d.id) === 'healing')
    if (healing) hero = { tone: 'active', text: `Checking ${healing.id} is healthy...`, sub: 'Health check running' }
    else if (fixedDev) hero = { tone: 'idle', text: `Fixed ${fixedDev.id}`, sub: 'Health check passed' }
  }
  const sun = hero.tone === 'pending' || hero.tone === 'expiring'
  const stage = trust ? (trust.level === 1 ? 3 : (Math.min(trust.successes, 2) as 0 | 1 | 2)) : 0

  function flowerState(id: string, status: string): FlowerState {
    const bad = events.some(e => e.device === id && (
      (isPolicyBlock(e) && ageSeconds(e.tsUs, now) < BLOCK_FLASH_S)
      || (ageSeconds(e.tsUs, now) < 12 && (e.kind === 'grant.revoked' || e.kind === 'health.failed'))))
    if (bad) return 'blocked'
    if (grants.some(g => g.target === id && g.status === 'pending') || incidents.some(i => i.device === id && i.status === 'escalated')) return 'asking'
    if (status !== 'online' || incidents.some(i => i.device === id && i.status === 'open')) return 'wilted'
    return 'bloom'
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><span className={`dot ${conn.isActive ? 'ok' : 'bad'}`} />Nightshift</div>
        <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
          {theme === 'dark' ? 'Day garden' : 'Night garden'}
        </button>
      </header>

      {!conn.isActive && (
        <div className="banner">
          {conn.connectionError ? `Cannot reach SpacetimeDB at ${uri}: ${conn.connectionError.message}` : `Connecting to ${uri}...`}
        </div>
      )}

      {blockedEv && (
        <div className="blocked-banner" role="alert">
          Blocked: nothing ran
          <span>{blockedEv.device}{blockedEv.detail && `, ${blockedEv.detail.replace(/^policy:\s*/, '')}`}</span>
        </div>
      )}

      {fixedDev && <div className="fixed-banner" role="status">Fixed: {fixedDev.id}<span>health check passed</span></div>}

      <section className="hero" aria-live="polite">
        <div className="hero-sky"><SkyBody sun={sun} /></div>
        <div className="hero-text">
          <h1>Sleep. Nightshift&apos;s on.</h1>
          <div className={`state tone-${hero.tone}`}>
            <span className={`light ${hero.tone}`} role="img" aria-label={`Lantern: ${hero.tone}`} />
            <div>
              <div className="state-text">{hero.text}</div>
              {hero.sub && <div className="state-sub">{hero.sub}</div>}
            </div>
          </div>
        </div>
        <Hills />
      </section>

      <Garland />

      {pendingGrants.map(g => <ApprovalCard key={g.id.toString()} g={g} now={now} />)}

      <MorningCard r={report} events={evSorted} />

      <section>
        <h2 className="sect">The garden</h2>
        {!devReady ? <p className="muted">Loading...</p> : devices.length === 0 ? <p className="muted">No devices planted yet.</p> : (
          <div className="flowers">
            {visibleDevices.sort((a, b) => a.id.localeCompare(b.id)).map(d => {
              const st = display.get(d.id) ?? 'bloom'
              return (
                <div key={d.id} className={`flower-card ${st}`} title={`${d.kind}, heartbeat ${fmtAge(ageSeconds(d.lastHeartbeatUs, now))}`}>
                  <Flower id={d.id} state={st} />
                  <div className="flower-name">{d.id}</div>
                  <div className="flower-state">{FLOWER_LABEL[st]}</div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {staleCount > 0 && (
        <button className="link offline-toggle" onClick={() => setShowOffline(!showOffline)} aria-pressed={showOffline}>
          {showOffline ? 'hide offline' : `show offline (${staleCount})`}
        </button>
      )}

      <Garland />

      <DemoControls />

      <div className="layout">
        <section className="stories">
          <h2 className="sect">Tonight</h2>
          {stories.length === 0 ? (
            <div className="polaroid empty"><div className="polaroid-photo">All quiet. Nothing needs you.</div><div className="polaroid-cap">sleep well</div></div>
          ) : stories.map(({ inc, steps, status }, i) => (
            <StoryCard key={inc.id.toString()} tilt={i % 2 ? 0.7 : -0.7} status={status} device={inc.device} alert={inc.alert} steps={steps} />
          ))}
        </section>

        <aside className="side">
          <div className={`note ${promotedNow ? 'promoted' : ''}`}>
            <h2 className="sect">Earned trust</h2>
            <Plant stage={stage} />
            {!trust ? <p className="muted">Nothing planted yet.</p> : (
              <>
                <div className="big-num">{Math.min(trust.successes, PROMOTE_AT)} <span>of {PROMOTE_AT}</span></div>
                <div className="big-cap">{trust.level === 1 ? 'safe fixes: now grows on its own' : 'safe fixes until it grows on its own'}</div>
                <div className="muted small">{trust.runbookId}{trust.failures > 0 && ` · ${trust.failures} failed`}</div>
              </>
            )}
          </div>

          <div className="note">
            <h2 className="sect">Cost of the last fix</h2>
            {!cost ? <p className="muted">Waiting for the first fix.</p> : (
              <>
                <div className="big-num">${cost.usd.toFixed(2)}</div>
                <div className="big-cap">
                  to fix this, {cost.seconds.toFixed(0)} s, {cost.commands} command{cost.commands === 1 ? '' : 's'}, {cost.presses} press{cost.presses === 1 ? '' : 'es'}
                  {' '}(a human ticket costs about ${HUMAN_TICKET_USD})
                </div>
                <div className="avg">avg ${avgUsd.toFixed(3)} over {costRuns.length} run{costRuns.length === 1 ? '' : 's'}</div>
                <div className="muted small">Last run shown. Measured over {costRuns.length} run{costRuns.length === 1 ? '' : 's'}, so treat as a rough figure.</div>
                <div className="muted small">${HUMAN_TICKET_USD}: industry average L1 ticket, MetricNet via HDI. {cost.tokens.toLocaleString()} tokens{cost.model && `, ${cost.model}`}.</div>
              </>
            )}
          </div>

          <RequestBox requests={requests} now={now} />
        </aside>
      </div>

      <Garland />

      <details className="details">
        <summary>Details</summary>
        <div className="details-grid">
          <div>
            <h2>Grants</h2>
            {grantSorted.length === 0 ? <p className="muted">None yet.</p> : (
              <ul className="list">
                {grantSorted.slice(0, 12).map(g => (
                  <li key={g.id.toString()} className="row">
                    <div className="grow">
                      <div className="mono cmd">{g.command || g.reason}</div>
                      <div className="muted small">#{g.id.toString()} · {g.target} · {g.capability}{g.status === 'active' && <> · <b className="count">{fmtCountdown(g.expiresAtUs, now)}</b> left</>}</div>
                    </div>
                    <span className={`chip ${g.status}`}>{g.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2>What Nightshift ran</h2>
            <p className="muted small">every command, its result and whether the health check passed</p>
            {results.length === 0 ? <p className="muted">No commands run yet.</p> : (
              <ul className="list">
                {[...results].sort((a, b) => (a.tsUs < b.tsUs ? 1 : -1)).slice(0, 8).map(r => (
                  <li key={r.grantId.toString()} className="trace">
                    <div className="row">
                      <div className="grow mono cmd">{grantById.get(r.grantId)?.command ?? `grant #${r.grantId}`}</div>
                      <span className={`chip ${r.exitCode === 0 ? 'good' : 'bad'}`}>exit {r.exitCode}</span>
                      <span className={`chip ${r.healthOk ? 'good' : 'bad'}`}>health {r.healthOk ? 'ok' : 'failed'}</span>
                      {r.rolledBack && <span className="chip rolled_back">rolled back</span>}
                    </div>
                    <div className="muted small">{r.device} · {fmtTime(r.tsUs)}</div>
                    {r.output && <pre className="out">{r.output.slice(0, 400)}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2>Changes</h2>
            {changes.length === 0 ? <p className="muted">No changes recorded.</p> : (
              <ul className="list">
                {[...changes].sort(byIdDesc).slice(0, 8).map(c => (
                  <li key={c.id.toString()} className="row">
                    <div className="grow">
                      <div className="mono cmd">{c.command}</div>
                      <div className="muted small">{c.device} · {fmtTime(c.tsUs)}{c.inverseCommand && <> · undo: <span className="mono">{c.inverseCommand}</span></>}</div>
                    </div>
                    <span className={`chip ${c.status}`}>{c.status.replace('_', ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2>Raw events</h2>
            <ul className="raw mono">
              {evSorted.slice(0, 80).map(e => (
                <li key={e.id.toString()}>{fmtTime(e.tsUs)} {e.kind} {e.device && `[${e.device}]`}{e.grantId ? ` g${e.grantId}` : ''} {e.detail}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { open: 'In progress', healed: 'Fixed', rolled_back: 'Undone', escalated: 'Needs you', failed: 'Failed' }

type Report = { alone: number; approved: number; blocked: number; undone: number; usd: number; seconds: number }

function ApprovalCard({ g, now }: { g: { id: bigint; target: string; reason: string; command: string; createdAtUs: bigint }; now: bigint }) {
  const [open, setOpen] = useState(false)
  const left = g.createdAtUs + 120_000_000n
  return (
    <section className="approval" role="alert">
      <div className="approval-title">{g.target} wants to run: {g.reason || 'a fix'}</div>
      <div className="approval-sub">Press green on the Lantern{left > now && <> <b className="approval-count">{fmtCountdown(left, now)}</b></>}</div>
      {g.command && (
        <>
          <button className="link approval-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'hide command' : 'show command'}</button>
          {open && <pre className="out">{g.command}</pre>}
        </>
      )}
    </section>
  )
}

type RecapEv = { id: bigint; tsUs: bigint; kind: string; detail: string }

const RECAP_TIMEOUT_MS = 60_000

// POST to the gateway. A reply the browser blocks (CORS) looks like a network error, so retry as a
// plain-text no-cors POST: it either gets through or fails because the gateway is truly unreachable.
async function gatewayPost(path: string, payload: object): Promise<{ ok: boolean; error?: string }> {
  const url = `${GATEWAY}${path}`
  const body = JSON.stringify(payload)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    if (res.ok) return { ok: true }
    const j = await res.json().catch(() => ({}))
    return { ok: false, error: String(j.error ?? `Gateway said ${res.status}`) }
  } catch {
    try { await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body }); return { ok: true } }
    catch { return { ok: false, error: `Could not reach the gateway at ${url}. Is it running?` } }
  }
}

function Recap({ events }: { events: readonly RecapEv[] }) {
  // Event ids only grow, so compare ids instead of clocks (a phone clock can be off).
  const [click, setClick] = useState<{ baseId: bigint; atMs: number } | null>(null)
  const [postError, setPostError] = useState('')
  const recapEvents = events.filter(e => e.kind.startsWith('recap.'))
  const newest = (k: string) => recapEvents.find(e => e.kind === k) // events arrive sorted newest first
  const lastDone = newest('recap.done')
  const maxId = recapEvents.reduce((m, e) => (e.id > m ? e.id : m), 0n)

  const doneNew = click && lastDone && lastDone.id > click.baseId ? lastDone : undefined
  const failedNew = click && recapEvents.find(e => e.kind === 'recap.failed' && e.id > click.baseId)
  const started = click && recapEvents.some(e => e.kind === 'recap.started' && e.id > click.baseId)
  const rendering = click !== null && !doneNew && !failedNew && !postError && Date.now() - click.atMs < RECAP_TIMEOUT_MS
  const timedOut = click !== null && !doneNew && !failedNew && !postError && !rendering

  async function start() {
    setPostError('')
    setClick({ baseId: maxId, atMs: Date.now() })
    const r = await gatewayPost('/recap', {})
    if (!r.ok) setPostError(r.error ?? 'Could not start the recap.')
  }

  const shown = doneNew ?? (click === null ? lastDone : undefined)
  let file = ''
  if (shown) { try { file = String(JSON.parse(shown.detail).file ?? '') } catch { /* detail is not JSON */ } }
  const src = shown ? `/recap/latest.mp4?t=${shown.tsUs.toString()}` : ''

  return (
    <div className="recap">
      <button className="recap-btn" disabled={rendering} onClick={() => void start()}>
        {rendering ? 'Rendering on the PC...' : 'Make my morning video'}
      </button>
      {rendering && <p className="muted">{started ? 'Rendering on the PC...' : 'Asking the PC to start...'} This takes up to a minute.</p>}
      {postError && <p className="err">{postError}</p>}
      {failedNew && <p className="err">The recap failed{failedNew.detail ? `: ${failedNew.detail.slice(0, 160)}` : '.'} Try again.</p>}
      {timedOut && <p className="err">No video after 60 s. The PC may be busy or the recap service is not running. Try again.</p>}
      {shown && (
        <div className="recap-video">
          <video key={src} src={src} controls playsInline preload="metadata" />
          <a className="recap-dl" href={src} download={file.split('/').pop() || 'nightshift-morning.mp4'}>Download</a>
        </div>
      )}
    </div>
  )
}

function MorningCard({ r, events }: { r: Report; events: readonly RecapEv[] }) {
  const [open, setOpen] = useState(true)
  const quiet = r.alone + r.approved + r.blocked + r.undone === 0
  const parts = [
    `${r.alone} fixed alone`, `${r.approved} you approved`, `${r.blocked} blocked`,
    ...(r.undone ? [`${r.undone} undone`] : []), `$${r.usd.toFixed(2)}`,
  ]
  return (
    <section className="note morning">
      <button className="link morning-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'hide' : 'Good morning'}</button>
      <h2 className="sect">Good morning</h2>
      <div className="morning-line">{quiet ? 'Nothing yet, tonight was quiet.' : `While you slept: ${parts.join(', ')}`}</div>
      <Recap events={events} />
      {open && !quiet && (
        <div className="morning-grid">
          <div><b>{r.alone}</b><span>fixed alone</span></div>
          <div><b>{r.approved}</b><span>you approved</span></div>
          <div><b>{r.blocked}</b><span>blocked</span></div>
          <div><b>{r.undone}</b><span>undone</span></div>
          <div><b>${r.usd.toFixed(2)}</b><span>{Math.round(r.seconds)} s of agent time</span></div>
        </div>
      )}
    </section>
  )
}

// Same host the page came from, so a phone reaches the laptop and not itself.
const GATEWAY = import.meta.env.VITE_GATEWAY_URL ?? `http://${window.location.hostname}:8787`
const DEMO_DEVICES = [
  { label: 'web-1', id: 'web-1' },
  { label: 'web-2', id: 'web-2' },
  { label: 'laptop', id: 'laptop' },
  { label: 'phone', id: 'pixel' },
]
const FAULTS = [
  { label: 'Service down', fault: 'service' },
  { label: 'Bad config', fault: 'config' },
  { label: 'Disk full', fault: 'disk' },
  { label: 'Phone Wi-Fi off', fault: 'wifi' },
]

function DemoControls() {
  const [device, setDevice] = useState('web-1')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState('')
  const isPhone = device === 'pixel'
  async function go(f: (typeof FAULTS)[number]) {
    const url = `${GATEWAY}/break`
    const body = JSON.stringify({ device, fault: f.fault })
    setBusy(f.fault); setMsg(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const j = await res.json().catch(() => ({}))
      setMsg(res.ok ? { ok: true, text: `${f.label} on ${device}. Watch it get fixed.` } : { ok: false, text: String(j.error ?? `Gateway said ${res.status}`) })
    } catch {
      // Blocked reply (CORS from a non-localhost page) looks like a network error. A plain-text POST needs no
      // preflight, so retry that way: it either gets through or fails because the gateway is truly unreachable.
      try {
        await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body })
        setMsg({ ok: true, text: `Sent ${f.label} for ${device} to ${url}. This page cannot read the gateway's reply, so watch the garden.` })
      } catch {
        setMsg({ ok: false, text: `Could not reach the gateway at ${url}. Is it running, and listening on the laptop's network address?` })
      }
    } finally { setBusy('') }
  }
  return (
    <section className="note demo">
      <h2 className="sect">Demo controls (mock)</h2>
      <div className="demo-devices" role="radiogroup" aria-label="Device to break">
        {DEMO_DEVICES.map(d => (
          <button key={d.id} role="radio" aria-checked={device === d.id} className={`demo-dev ${device === d.id ? 'on' : ''}`} onClick={() => setDevice(d.id)}>{d.label}</button>
        ))}
      </div>
      <div className="demo-grid">
        {FAULTS.map(f => (
          <button key={f.fault} className="demo-btn" disabled={busy !== '' || (f.fault === 'wifi') !== isPhone} onClick={() => void go(f)}>
            {f.label}<span>{device}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Posts to {GATEWAY}/break</p>
      {msg && <p className={msg.ok ? 'result' : 'err'}>{msg.text}</p>}
    </section>
  )
}

function StoryCard({ device, alert, status, steps, tilt }: { device: string; alert: string; status: string; steps: Step[]; tilt: number }) {
  return (
    <article className="polaroid" style={{ transform: `rotate(${tilt}deg)` }}>
      <div className="polaroid-photo">
        <ol className="timeline">
          {steps.map(s => <StepRow key={s.key} s={s} />)}
        </ol>
      </div>
      <footer className="polaroid-cap">
        <span>{device}: {alert}</span>
        <span className={`chip big-chip ${status}`}>{STATUS_LABEL[status] ?? status}</span>
      </footer>
    </article>
  )
}

function StepRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`step ${s.tone}`}>
      <span className="pin" />
      <div className="step-body">
        <div className="step-text">{s.text} <span className="muted small mono">{fmtTime(s.tsUs)}</span></div>
        {s.command && (
          <>
            <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'hide command' : 'show command'}</button>
            {open && <pre className="out">{s.command}</pre>}
          </>
        )}
      </div>
    </li>
  )
}

function RequestBox({ requests, now }: { requests: readonly { id: bigint; text: string; status: string; result: string; tsUs: bigint }[]; now: bigint }) {
  const submit = useReducer(reducers.submitRequest)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const recent = [...requests].sort(byIdDesc).slice(0, 4)

  async function send() {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true); setErr('')
    try { await submit({ text: v }); setText('') }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h2>Ask Nightshift</h2>
      <form className="req" onSubmit={e => { e.preventDefault(); void send() }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="e.g. web-1 is slow, check it" maxLength={500} aria-label="Request" />
        <button type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
      {err && <p className="err">{err}</p>}
      <ul className="list">
        {recent.map(r => (
          <li key={r.id.toString()} className="row">
            <div className="grow">
              <div>{r.text}</div>
              <div className="muted small">#{r.id.toString()} · {fmtAge(ageSeconds(r.tsUs, now))}</div>
              {r.result && <div className="small result">{r.result}</div>}
            </div>
            <span className={`chip ${r.status}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
