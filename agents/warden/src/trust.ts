// Earned trust on the Lantern: pure mapping from a runbook_trust row to what the board shows.
export type Rgb = [number, number, number];
export const GOLD: Rgb = [255, 190, 0];
export const DIM_GREEN: Rgb = [0, 40, 0];
export const NUM_LEDS = 7;
export const LEDS_PER_SUCCESS = 2;
export const MAX_LIT = 6;            // 3 successes fill the meter; the 7th LED stays green

export interface TrustRow { runbookId: string; successes: number; level: number }
export interface TrustView {
  lines: string[];                   // first line is the board word (8 chars max), the rest is console and phone page only
  led: Rgb;                          // uniform colour (used when `leds` is absent)
  leds?: Rgb[];                      // per-LED colours (the meter)
  mode: 'solid' | 'pulse';
}

export const litLeds = (successes: number) => Math.max(0, Math.min(MAX_LIT, Math.floor(successes) * LEDS_PER_SUCCESS));
export const trustWord = (successes: number) => `TRUST ${Math.min(99, Math.max(0, Math.floor(successes)))}`;   // 8 chars max

export function meter(successes: number): Rgb[] {
  const lit = litLeds(successes);
  return Array.from({ length: NUM_LEDS }, (_, i) => (i < lit ? GOLD : DIM_GREEN));
}

/** `promoted`: this runbook was just promoted to heal alone. Then the board says EARNED with all 7 LEDs gold, pulsing. */
export function trustView(row: TrustRow | undefined, promoted: boolean, threshold = 3): TrustView | undefined {
  if (!row) return undefined;
  if (promoted && row.level === 1) return { lines: ['EARNED', row.runbookId, 'now heals alone'], led: GOLD, mode: 'pulse' };
  const left = Math.max(0, threshold - row.successes);
  return {
    lines: [trustWord(row.successes), row.runbookId, row.level === 1 ? 'heals alone' : `${left} more to earn`],
    led: GOLD, leds: meter(row.successes), mode: 'solid',
  };
}
