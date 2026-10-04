// Lantern lifecycle: one word plus LEDs for every phase. Pure helpers, unit tested (test-lifecycle.ts).
// Priority when states overlap (lowest rank wins):
//   BLOCKED, APPROVE/HOLD, (button feedback), ESCALATE, FIXING, THINK, DOWN, TRUST/HEALTHY, WATCH, IDLE
export type Rgb = [number, number, number];
export const NUM_LEDS = 7;
export const RANK = { BLOCKED: 0, PENDING: 1, FEEDBACK: 2, ESCALATE: 3, FIXING: 4, THINK: 5, DOWN: 6, HEALTHY: 7, WATCH: 8, IDLE: 9 } as const;
export type StateName = keyof typeof RANK;

export const WORDS: Record<StateName, string> = {
  BLOCKED: 'BLOCKED', PENDING: 'APPROVE', FEEDBACK: 'DENIED', ESCALATE: 'ESCALATE', FIXING: 'FIXING',
  THINK: 'THINK', DOWN: 'DOWN', HEALTHY: 'HEALTHY', WATCH: 'WATCH', IDLE: 'IDLE',
};

/** Highest-priority state among those active (IDLE when none). */
export function pickState(active: StateName[]): StateName {
  return active.reduce<StateName>((best, s) => (RANK[s] < RANK[best] ? s : best), 'IDLE');
}

const AMBER: Rgb = [255, 140, 0], GOLD: Rgb = [255, 190, 0], RED: Rgb = [255, 0, 0], OFF: Rgb = [0, 0, 0], DIM: Rgb = [0, 40, 0];
const only = (i: number, c: Rgb, rest: Rgb = OFF): Rgb[] => Array.from({ length: NUM_LEDS }, (_, k) => (k === i ? c : rest));

/** WATCH: one gold LED sweeps left to right over `ms`. Undefined once the sweep is over. */
export function sweepLeds(startedMs: number, nowMs: number, ms = 600): Rgb[] | undefined {
  const t = nowMs - startedMs;
  if (t < 0 || t >= ms) return undefined;
  return only(Math.min(NUM_LEDS - 1, Math.floor((t / ms) * NUM_LEDS)), GOLD, DIM);
}
/** THINK: one amber LED chases around the 7, a step every `stepMs`. */
export const chaseLeds = (nowMs: number, stepMs = 150): Rgb[] => only(Math.floor(nowMs / stepMs) % NUM_LEDS, AMBER);
/** ESCALATE: red and amber alternate across the LEDs, swapping every `ms`. */
export const alternateLeds = (nowMs: number, ms = 500): Rgb[] => {
  const flip = Math.floor(nowMs / ms) % 2;
  return Array.from({ length: NUM_LEDS }, (_, i) => ((i + flip) % 2 === 0 ? RED : AMBER));
};

/** A vitals event detail is JSON {health, diskPct, tmpMB, service}. Failing = health present and not 200. Bad JSON is ignored. */
export function vitalsStatus(detail: string): 'ok' | 'failing' | 'unknown' {
  try {
    const v = JSON.parse(detail);
    if (typeof v?.health !== 'number') return 'unknown';
    return v.health === 200 ? 'ok' : 'failing';
  } catch { return 'unknown'; }
}

/** Devices currently DOWN: set on incident.opened or failing vitals (refreshed by each failing vitals), cleared by ok vitals,
 *  health.passed, incident.healed, and dropped after `ttlMs` without a refresh. */
export class DownTracker {
  private at = new Map<string, number>();
  constructor(private ttlMs = 60_000) {}
  mark(device: string, nowMs: number) { this.at.set(device, nowMs); }
  clear(device: string) { this.at.delete(device); }
  list(nowMs: number): string[] {
    for (const [d, t] of this.at) if (nowMs - t > this.ttlMs) this.at.delete(d);
    return [...this.at.keys()];
  }
  /** Feed one event. Returns true if the DOWN set changed. */
  onEvent(kind: string, device: string, detail: string, nowMs: number): boolean {
    const had = this.at.has(device);
    if (kind === 'incident.opened') this.mark(device, nowMs);
    else if (kind === 'vitals') {
      const s = vitalsStatus(detail);
      if (s === 'failing') this.mark(device, nowMs); else if (s === 'ok') this.clear(device);
    } else if (kind === 'health.passed' || kind === 'incident.healed') this.clear(device);
    return had !== this.at.has(device);
  }
}

/** THINK is active while thoughts keep arriving (6 s), or for 20 s after the last one while a user request is running. */
export const thinkActive = (lastThoughtMs: number, nowMs: number, requestRunning: boolean) =>
  lastThoughtMs > 0 && nowMs - lastThoughtMs < (requestRunning ? 20_000 : 6_000);
