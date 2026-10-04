import { PROMOTE_AT, ageSeconds } from './lib'

export interface Ev { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }
export interface Grant { id: bigint; target: string; capability: string; reason: string; command: string; status: string; expiresAtUs: bigint; createdAtUs: bigint; decidedBy: string }
export interface Incident { id: bigint; device: string; alert: string; runbookId: string; status: string; attempts: number; tsUs: bigint }
export interface Trust { runbookId: string; deviceType: string; successes: number; failures: number; level: number; updatedAtUs: bigint }
export interface Req { id: bigint; text: string; status: string }
export interface Dev { id: string; name: string; status: string }

export type Tone = 'red' | 'blue' | 'amber' | 'green' | 'gray'
export interface Step { key: string; kind: string; tone: Tone; text: string; tsUs: bigint; command?: string; why?: { text: string; tone: WhyTone } }
export interface Decision { cls: string; reason: string; rule: string; escalated: boolean }
export type WhyTone = 'amber' | 'green' | 'red'

// gate.decision detail is JSON, but may be cut at 900 chars: fall back to pulling fields out with regexes.
export function parseDecision(detail: string): Decision | null {
  try {
    const j = JSON.parse(detail)
    return { cls: String(j.class ?? ''), reason: String(j.reason ?? ''), rule: String(j.rule ?? ''), escalated: j.escalated === true }
  } catch {
    const field = (k: string) => new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(detail)?.[1] ?? ''
    const reason = field('reason').replace(/\\"/g, '"')
    return reason ? { cls: field('class'), reason, rule: field('rule'), escalated: /"escalated"\s*:\s*true/.test(detail) } : null
  }
}

export function decisionsByGrant(events: readonly Ev[]): Map<bigint, Decision> {
  const m = new Map<bigint, Decision>()
  for (const e of events) {
    if (e.kind !== 'gate.decision' || !e.grantId) continue
    const d = parseDecision(e.detail)
    if (d) m.set(e.grantId, d)
  }
  return m
}

export const whyTone = (cls: string): WhyTone => (cls === 'forbidden' ? 'red' : cls === 'autonomous' || cls === 'read' ? 'green' : 'amber')

export type Hold = 'wilted' | 'healing' | 'fixed' | undefined

// Plain-English timeline for one incident, built only from rows.
export function buildStory(
  inc: Incident, events: readonly Ev[], grants: Map<bigint, Grant>, trusts: readonly Trust[], untilUs: bigint, hold?: Hold, decisions: Map<bigint, Decision> = new Map(),
): Step[] {
  const whyUsed = new Set<bigint>()
  const steps: Step[] = [{ key: 'start', kind: 'incident', tone: 'red', text: `${inc.device} went down: ${inc.alert}`, tsUs: inc.tsUs }]
  const trust = trusts.find(t => t.runbookId === inc.runbookId)
  const mine = events
    .filter(e => e.device === inc.device && e.tsUs >= inc.tsUs && e.tsUs < untilUs)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const e of mine) {
    const g = e.grantId ? grants.get(e.grantId) : undefined
    const command = g?.command || undefined
    const key = e.id.toString()
    const add = (tone: Tone, text: string) => {
      const step: Step = { key, kind: e.kind, tone, text, tsUs: e.tsUs, command }
      const d = e.grantId ? decisions.get(e.grantId) : undefined
      const carries = e.kind === 'grant.requested' || e.kind === 'grant.denied' || e.kind === 'fix.autonomous'
      if (d && carries && !whyUsed.has(e.grantId) && (d.cls !== 'forbidden' || e.kind === 'grant.denied')) {
        step.why = { text: d.reason, tone: whyTone(d.cls) }
        whyUsed.add(e.grantId)
      }
      steps.push(step)
    }
    switch (e.kind) {
      case 'grant.requested':
        if (g?.capability === 'shell.read') add('green', 'Nightshift read the logs')
        else if (g?.capability === 'shell.write' || g?.capability === 'shell.destructive') add('amber', 'Asked for your OK')
        break
      case 'grant.approved':
        if (g && g.capability !== 'shell.read') add('amber', e.detail.startsWith('warden') || g.decidedBy === 'warden' ? 'Approved by the Lantern' : 'Approved by policy')
        break
      case 'fix.autonomous':
        add('green', trust ? `Fixed it alone, trust ${Math.min(trust.successes, PROMOTE_AT)}/${PROMOTE_AT}` : 'Fixed it alone')
        break
      case 'health.passed': add('green', 'Health check passed'); break
      case 'health.failed': add('red', 'Health check failed'); break
      case 'grant.denied': add('red', e.detail.startsWith('policy') ? 'Blocked by policy: nothing ran' : 'You said no: nothing ran'); break
      case 'incident.failed': add('red', 'Failed: nothing was fixed'); break
      case 'grant.revoked': add('red', 'Stopped: you revoked access'); break
      case 'change.rolled_back':
      case 'rollback.requested': add('gray', 'Undone'); break
      case 'trust.promoted': add('green', 'Earned trust: now fixes this alone'); break
      case 'incident.escalated': add('amber', 'Handed to you: needs a person'); break
    }
  }
  // Held display states: the story catches up to what the audience has been shown.
  if (hold === 'wilted' || hold === 'healing') {
    const shown = steps.filter(s => s.kind !== 'health.passed')
    if (hold === 'healing') shown.push({ key: 'healing', kind: 'healing', tone: 'blue', text: 'Health check running...', tsUs: 0n })
    return shown
  }
  return steps
}

export interface Hero { tone: 'idle' | 'pending' | 'active' | 'expiring' | 'revoked' | 'auto'; text: string; sub: string }

export function buildHero(
  devices: readonly Dev[], grants: readonly Grant[], incidents: readonly Incident[], events: readonly Ev[], now: bigint,
  reqs: readonly Req[] = [],
): Hero {
  const recent = (pred: (k: string) => boolean, s: number) => events.find(e => pred(e.kind) && ageSeconds(e.tsUs, now) < s)
  const blocked = recent(k => k === 'grant.revoked' || k === 'grant.denied' || k.startsWith('policy.') || k === 'health.failed', 3)
  if (blocked) return { tone: 'revoked', text: blocked.kind === 'health.failed' ? `Health check failed on ${blocked.device}` : 'Stopped. Nothing ran.', sub: blocked.detail.slice(0, 100) }
  const active = grants.filter(g => g.status === 'active')
  const soon = active.find(g => Number(g.expiresAtUs - now) / 1e6 < 15)
  if (soon) return { tone: 'expiring', text: `Access to ${soon.target} is about to end`, sub: '' }
  const pending = grants.find(g => g.status === 'pending')
  if (pending) return { tone: 'pending', text: 'Waiting for your OK', sub: `${pending.target}: ${pending.reason}` }
  const esc = incidents.find(i => i.status === 'escalated')
  if (esc) return { tone: 'pending', text: `${esc.device} needs a person`, sub: esc.alert }
  const auto = recent(k => k === 'fix.autonomous', 3)
  if (auto) return { tone: 'auto', text: `Fixing ${auto.device} on its own`, sub: 'Trusted fix, checked and reversible' }
  const work = active.find(g => g.capability !== 'shell.read')
  if (work) return { tone: 'active', text: `Fixing ${work.target}: ${work.reason}`, sub: '' }
  const open = incidents.find(i => i.status === 'open')
  const running = reqs.find(r => r.status === 'new' || r.status === 'running')
  if (active.length || open || running) {
    return { tone: 'active', text: 'Nightshift is reading the logs...', sub: open ? `${open.device}: ${open.alert}` : running ? running.text.slice(0, 100) : '' }
  }
  const online = devices.filter(d => d.status === 'online').length
  return { tone: 'idle', text: `Nightshift is watching ${online} device${online === 1 ? '' : 's'}`, sub: 'All quiet. Nothing needs you.' }
}


// An incident is failed if its own status says so, an incident.failed event hit its device
// since it opened, or the request that was raised for it ended failed.
export function effectiveStatus(inc: Incident, events: readonly Ev[], reqs: readonly Req[], untilUs: bigint): string {
  if (inc.status === 'failed') return 'failed'
  if (inc.status === 'healed' || inc.status === 'rolled_back') return inc.status
  if (events.some(e => e.kind === 'incident.failed' && e.device === inc.device && e.tsUs >= inc.tsUs && e.tsUs < untilUs)) return 'failed'
  const tag = `Incident #${inc.id}.`
  if (reqs.some(r => r.status === 'failed' && r.text.includes(tag))) return 'failed'
  return inc.status
}

export interface TraceLine { id: bigint; command: string; cls: string; capability: string; outcome: string }
export interface Result { grantId: bigint; exitCode: number; healthOk: boolean; rolledBack: boolean }

// Tool calls the agent made for this incident, in order: one run_command per grant.
export function buildTrace(
  inc: Incident, grants: readonly Grant[], decisions: Map<bigint, Decision>, results: Map<bigint, Result>, untilUs: bigint,
): TraceLine[] {
  return grants
    .filter(g => g.target === inc.device && g.createdAtUs >= inc.tsUs && g.createdAtUs < untilUs)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(g => {
      const r = results.get(g.id)
      const outcome = r
        ? `exit ${r.exitCode}${r.exitCode === 0 ? `, health ${r.healthOk ? 'ok' : 'failed'}` : ''}${r.rolledBack ? ', rolled back' : ''}`
        : g.status === 'denied' ? 'blocked, nothing ran' : g.status === 'pending' ? 'waiting for a press' : g.status
      return { id: g.id, command: g.command || g.reason, cls: decisions.get(g.id)?.cls ?? '', capability: g.capability, outcome }
    })
}

// Flower state at a moment in the night, rebuilt only from event, grant and incident rows.
export function stateAt(
  deviceId: string, t: bigint, events: readonly Ev[], grants: readonly Grant[], incidents: readonly Incident[],
): 'bloom' | 'wilted' | 'asking' | 'blocked' {
  const mine = events.filter(e => e.device === deviceId && e.tsUs <= t)
  const blocked = mine.some(e => ((e.kind === 'grant.denied' && e.detail.startsWith('policy')) || e.kind.startsWith('policy.')) && t - e.tsUs < 6_000_000n)
  if (blocked) return 'blocked'
  const asking = grants.some(g => g.target === deviceId && g.capability !== 'shell.read' && g.createdAtUs <= t
    && !events.some(e => e.grantId === g.id && e.tsUs <= t && (e.kind === 'grant.approved' || e.kind === 'grant.denied' || e.kind === 'grant.expired')))
  if (asking) return 'asking'
  const offline = [...mine].reverse().find(e => e.kind === 'device.offline' || e.kind === 'device.online')?.kind === 'device.offline'
  const inc = incidents.filter(i => i.device === deviceId && i.tsUs <= t).sort((a, b) => (a.tsUs < b.tsUs ? 1 : -1))[0]
  const open = inc !== undefined && !mine.some(e => e.tsUs > inc.tsUs && (e.kind === 'health.passed' || e.kind === 'incident.failed' || e.kind === 'change.rolled_back'))
  return offline || open ? 'wilted' : 'bloom'
}

export interface Vitals { health?: number; diskPct?: number; wifi?: string; ok: boolean }

// One definition of "failing" for both the flower and the terminal's patrol lines.
export function parseVitals(detail: string): Vitals {
  try {
    const j = JSON.parse(detail)
    const health = j.health == null ? undefined : Number(j.health)
    const diskPct = j.diskPct == null ? undefined : Number(j.diskPct)
    const wifi = j.wifi == null ? undefined : String(j.wifi)
    const wifiBad = wifi !== undefined && /^(false|0|off|down|disconnected)$/i.test(wifi)
    return { health, diskPct, wifi, ok: (health === undefined || health === 200) && !wifiBad }
  } catch { return { ok: true } }
}

// Newest health signal per device: a vitals event, or a health.passed / health.failed result.
export function healthSignals(eventsNewestFirst: readonly Ev[]): Map<string, { ok: boolean; tsUs: bigint }> {
  const m = new Map<string, { ok: boolean; tsUs: bigint }>()
  for (const e of eventsNewestFirst) {
    if (!e.device || m.has(e.device)) continue
    if (e.kind === 'vitals') m.set(e.device, { ok: parseVitals(e.detail).ok, tsUs: e.tsUs })
    else if (e.kind === 'health.failed') m.set(e.device, { ok: false, tsUs: e.tsUs })
    else if (e.kind === 'health.passed') m.set(e.device, { ok: true, tsUs: e.tsUs })
  }
  return m
}
