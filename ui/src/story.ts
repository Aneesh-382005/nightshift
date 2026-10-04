import { PROMOTE_AT, ageSeconds } from './lib'

export interface Ev { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }
export interface Grant { id: bigint; target: string; capability: string; reason: string; command: string; status: string; expiresAtUs: bigint; createdAtUs: bigint; decidedBy: string }
export interface Incident { id: bigint; device: string; alert: string; runbookId: string; status: string; attempts: number; tsUs: bigint }
export interface Trust { runbookId: string; deviceType: string; successes: number; failures: number; level: number; updatedAtUs: bigint }
export interface Req { id: bigint; text: string; status: string }
export interface Dev { id: string; name: string; status: string }

export type Tone = 'red' | 'blue' | 'amber' | 'green' | 'gray'
export interface Step { key: string; kind: string; tone: Tone; text: string; tsUs: bigint; command?: string }
export type Hold = 'wilted' | 'healing' | 'fixed' | undefined

// Plain-English timeline for one incident, built only from rows.
export function buildStory(
  inc: Incident, events: readonly Ev[], grants: Map<bigint, Grant>, trusts: readonly Trust[], untilUs: bigint, hold?: Hold,
): Step[] {
  const steps: Step[] = [{ key: 'start', kind: 'incident', tone: 'red', text: `${inc.device} went down: ${inc.alert}`, tsUs: inc.tsUs }]
  const trust = trusts.find(t => t.runbookId === inc.runbookId)
  const mine = events
    .filter(e => e.device === inc.device && e.tsUs >= inc.tsUs && e.tsUs < untilUs)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const e of mine) {
    const g = e.grantId ? grants.get(e.grantId) : undefined
    const command = g?.command || undefined
    const key = e.id.toString()
    const add = (tone: Tone, text: string) => steps.push({ key, kind: e.kind, tone, text, tsUs: e.tsUs, command })
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
