import { PROMOTE_AT, ageSeconds } from './lib'

export interface Ev { id: bigint; tsUs: bigint; kind: string; device: string; grantId: bigint; detail: string }
export interface Grant { id: bigint; target: string; capability: string; reason: string; command: string; status: string; expiresAtUs: bigint }
export interface Incident { id: bigint; device: string; alert: string; runbookId: string; status: string; attempts: number; tsUs: bigint }
export interface Trust { runbookId: string; deviceType: string; successes: number; failures: number; level: number; updatedAtUs: bigint }
export interface Dev { id: string; name: string; status: string }

export type Tone = 'red' | 'blue' | 'amber' | 'green' | 'gray'
export interface Step { key: string; tone: Tone; text: string; tsUs: bigint; command?: string }

// Plain-English timeline for one incident, built only from rows.
export function buildStory(
  inc: Incident, events: readonly Ev[], grants: Map<bigint, Grant>, trusts: readonly Trust[], untilUs: bigint,
): Step[] {
  const steps: Step[] = [{ key: 'start', tone: 'red', text: `${inc.device} went down: ${inc.alert}`, tsUs: inc.tsUs }]
  const trust = trusts.find(t => t.runbookId === inc.runbookId)
  const mine = events
    .filter(e => e.device === inc.device && e.tsUs >= inc.tsUs && e.tsUs < untilUs)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const e of mine) {
    const g = e.grantId ? grants.get(e.grantId) : undefined
    const command = g?.command || undefined
    const key = e.id.toString()
    const add = (tone: Tone, text: string) => steps.push({ key, tone, text, tsUs: e.tsUs, command })
    switch (e.kind) {
      case 'grant.requested':
        if (g?.capability === 'shell.read') add('green', 'Nightshift read the logs')
        else if (g?.capability === 'shell.write' || g?.capability === 'shell.destructive') add('amber', 'Asked for your OK')
        break
      case 'grant.approved':
        if (g && g.capability !== 'shell.read') add('amber', 'You approved it')
        break
      case 'fix.autonomous':
        add('green', trust ? `Fixed it alone, trust ${Math.min(trust.successes, PROMOTE_AT)}/${PROMOTE_AT}` : 'Fixed it alone')
        break
      case 'health.passed': add('green', 'Health check passed'); break
      case 'health.failed': add('red', 'Health check failed'); break
      case 'grant.denied': add('red', 'Stopped: not allowed or denied'); break
      case 'grant.revoked': add('red', 'Stopped: you revoked access'); break
      case 'change.rolled_back':
      case 'rollback.requested': add('gray', 'Undone'); break
      case 'trust.promoted': add('green', 'Earned trust: now fixes this alone'); break
      case 'incident.escalated': add('amber', 'Handed to you: needs a person'); break
    }
  }
  return steps
}

export interface Hero { tone: 'idle' | 'pending' | 'active' | 'expiring' | 'revoked' | 'auto'; text: string; sub: string }

export function buildHero(
  devices: readonly Dev[], grants: readonly Grant[], incidents: readonly Incident[], events: readonly Ev[], now: bigint,
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
  const work = active.find(g => g.capability !== 'shell.read') ?? active[0]
  if (work) return { tone: 'active', text: `Fixing ${work.target}: ${work.reason}`, sub: '' }
  const open = incidents.find(i => i.status === 'open')
  if (open) return { tone: 'active', text: `Looking into ${open.device}`, sub: open.alert }
  const online = devices.filter(d => d.status === 'online').length
  return { tone: 'idle', text: `Nightshift is watching ${online} device${online === 1 ? '' : 's'}`, sub: 'All quiet. Nothing needs you.' }
}
