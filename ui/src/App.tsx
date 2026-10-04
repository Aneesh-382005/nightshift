import { useEffect, useMemo, useState } from 'react'
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react'
import { reducers, tables } from './module_bindings'
import {
  HUMAN_TICKET_USD, PROMOTE_AT, ageSeconds, fmtAge, fmtCountdown, fmtTime, nowUs, parseCost,
} from './lib'
import { buildHero, buildStory, type Step } from './story'
import { FLOWER_LABEL, Flower, Garland, Hills, Plant, SkyBody, type FlowerState } from './garden'

type Theme = 'dark' | 'light'
const byIdDesc = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
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
  const hero = buildHero(devices, grants, incidents, events, now)

  const incSorted = useMemo(() => [...incidents].sort(byIdDesc), [incidents])
  const stories = useMemo(() => incSorted.slice(0, 4).map(inc => {
    // Events belong to this incident until the next incident on the same device.
    const next = incidents.filter(o => o.device === inc.device && o.id > inc.id).reduce((m, o) => (o.tsUs < m ? o.tsUs : m), MAX_US)
    return { inc, steps: buildStory(inc, events, grantById, trusts, next) }
  }), [incSorted, incidents, events, grantById, trusts])

  const trust = [...trusts].sort((a, b) => (a.updatedAtUs < b.updatedAtUs ? 1 : -1))[0]
  const costEv = evSorted.find(e => e.kind === 'cost.update')
  const cost = costEv ? parseCost(costEv.detail) : null
  const promotedNow = trust ? evSorted.some(e => e.kind === 'trust.promoted' && e.detail === trust.runbookId && ageSeconds(e.tsUs, now) < 20) : false

  // Devices offline for over 10 minutes are stale rows: hidden unless asked for.
  const isStale = (d: { status: string; lastHeartbeatUs: bigint }) => d.status !== 'online' && ageSeconds(d.lastHeartbeatUs, now) > 600
  const visibleDevices = devices.filter(d => showOffline || !isStale(d))
  const staleCount = devices.filter(isStale).length
  const sun = hero.tone === 'pending' || hero.tone === 'expiring'
  const stage = trust ? (trust.level === 1 ? 3 : (Math.min(trust.successes, 2) as 0 | 1 | 2)) : 0

  function flowerState(id: string, status: string): FlowerState {
    const bad = events.some(e => e.device === id && ageSeconds(e.tsUs, now) < 12
      && (e.kind === 'grant.revoked' || e.kind === 'grant.denied' || e.kind.startsWith('policy.') || e.kind === 'health.failed'))
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

      <section className="hero" aria-live="polite">
        <div className="hero-sky"><SkyBody sun={sun} /></div>
        <div className="hero-text">
          <h1>Sleep. Nightshift&apos;s on.</h1>
          <div className={`state tone-${hero.tone}`}>
            <span className={`light ${hero.tone}`} role="img" aria-label={`Leash: ${hero.tone}`} />
            <div>
              <div className="state-text">{hero.text}</div>
              {hero.sub && <div className="state-sub">{hero.sub}</div>}
            </div>
          </div>
        </div>
        <Hills />
      </section>

      <Garland />

      <section>
        <h2 className="sect">The garden</h2>
        {!devReady ? <p className="muted">Loading...</p> : devices.length === 0 ? <p className="muted">No devices planted yet.</p> : (
          <div className="flowers">
            {visibleDevices.sort((a, b) => a.id.localeCompare(b.id)).map(d => {
              const st = flowerState(d.id, d.status)
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

      <div className="layout">
        <section className="stories">
          <h2 className="sect">Tonight</h2>
          {stories.length === 0 ? (
            <div className="polaroid empty"><div className="polaroid-photo">All quiet. Nothing needs you.</div><div className="polaroid-cap">sleep well</div></div>
          ) : stories.map(({ inc, steps }, i) => (
            <StoryCard key={inc.id.toString()} tilt={i % 2 ? 0.7 : -0.7} status={inc.status} device={inc.device} alert={inc.alert} steps={steps} />
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
            <h2 className="sect">Cost of this fix</h2>
            {!cost ? <p className="muted">Waiting for the first fix.</p> : (
              <>
                <div className="big-num">${cost.usd.toFixed(2)}</div>
                <div className="big-cap">
                  to fix this, {cost.seconds.toFixed(0)} s, {cost.commands} command{cost.commands === 1 ? '' : 's'}, {cost.presses} press{cost.presses === 1 ? '' : 'es'}
                  {' '}(a human ticket costs about ${HUMAN_TICKET_USD})
                </div>
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

const STATUS_LABEL: Record<string, string> = { open: 'In progress', healed: 'Fixed', rolled_back: 'Undone', escalated: 'Needs you' }

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
