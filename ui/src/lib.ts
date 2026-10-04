export const HUMAN_TICKET_USD = 22
export const PROMOTE_AT = 3

export const nowUs = () => BigInt(Date.now()) * 1000n

export function fmtTime(us: bigint): string {
  if (us === 0n) return '-'
  return new Date(Number(us / 1000n)).toLocaleTimeString([], { hour12: false })
}

export function ageSeconds(us: bigint, now: bigint): number {
  if (us === 0n) return Infinity
  const d = Number(now - us) / 1e6
  return d < 0 ? 0 : d
}

export function fmtAge(s: number): string {
  if (!isFinite(s)) return 'never'
  if (s < 90) return `${Math.round(s)}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

export function fmtCountdown(us: bigint, now: bigint): string {
  const s = Math.max(0, Math.ceil(Number(us - now) / 1e6))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface Cost { tokens: number; usd: number; seconds: number; commands: number; presses: number; model: string }

export function parseCost(detail: string): Cost | null {
  try {
    const j = JSON.parse(detail)
    return {
      tokens: Number(j.tokens ?? 0), usd: Number(j.usd ?? 0), seconds: Number(j.seconds ?? 0),
      commands: Number(j.commands ?? 0), presses: Number(j.presses ?? 0), model: String(j.model ?? ''),
    }
  } catch { return null }
}

export type Tally = 'idle' | 'pending' | 'active' | 'expiring' | 'revoked' | 'auto'

export const TALLY_LABEL: Record<Tally, string> = {
  idle: 'Idle',
  pending: 'Waiting for a press',
  active: 'Approved, running',
  expiring: 'Grant expiring',
  revoked: 'Revoked or blocked',
  auto: 'Healing alone',
}
