// Hand-drawn night garden pieces. Inline SVG only, all state comes from props.
export type FlowerState = 'bloom' | 'wilted' | 'asking' | 'blocked'

export const FLOWER_LABEL: Record<FlowerState, string> = {
  bloom: 'In bloom',
  wilted: 'Wilted',
  asking: 'Needs your OK',
  blocked: 'Blocked',
}

const PETALS = ['var(--blush)', 'var(--lavender)', 'var(--cream)', 'var(--lantern)']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function Flower({ id, state }: { id: string; state: FlowerState }) {
  const idx = hash(id) % PETALS.length
  const petal = PETALS[idx]
  const center = idx === 3 ? 'var(--soil)' : 'var(--lantern)'
  const stem = state === 'wilted'
    ? 'M50 112 C50 90 52 78 62 66'
    : 'M50 112 C49 92 51 78 50 62'
  const head = state === 'wilted' ? { x: 64, y: 70, r: 25 } : { x: 50, y: 52, r: 0 }
  return (
    <svg viewBox="0 0 100 120" className={`flower ${state}`} role="img" aria-label={`${id}: ${FLOWER_LABEL[state]}`}>
      {state === 'asking' && (
        <>
          <defs>
            <radialGradient id={`glow-${id}`}>
              <stop offset="0" stopColor="var(--lantern)" stopOpacity=".9" />
              <stop offset="1" stopColor="var(--lantern)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="glow" cx="50" cy="46" r="40" fill={`url(#glow-${id})`} />
        </>
      )}
      <path d={stem} fill="none" stroke={state === 'wilted' ? 'var(--gray)' : 'var(--sage)'} strokeWidth="4" strokeLinecap="round" />
      <path d="M50 100 C38 98 30 90 28 82 C40 82 48 90 50 100Z" fill={state === 'wilted' ? 'var(--gray)' : 'var(--sage)'} opacity=".9" />
      <path d="M50 94 C62 92 70 84 72 76 C60 76 52 84 50 94Z" fill={state === 'wilted' ? 'var(--gray)' : 'var(--sage)'} opacity=".75" />
      {state === 'blocked' && (
        <g fill="var(--red)">
          <path d="M49 100 l-8 -3 l8 -3z" /><path d="M51 88 l8 -3 l-8 -3z" /><path d="M49 76 l-8 -3 l8 -3z" /><path d="M51 66 l8 -3 l-8 -3z" />
        </g>
      )}
      {(state === 'bloom' || state === 'wilted') && (
        <g transform={state === 'wilted' ? `translate(${head.x} ${head.y}) rotate(110) scale(.8)` : 'translate(50 50)'}>
          {Array.from({ length: 6 }, (_, k) => (
            <ellipse key={k} cx="0" cy="-15" rx="8" ry="15" transform={`rotate(${k * 60})`}
              fill={state === 'wilted' ? 'var(--gray)' : petal} opacity={state === 'wilted' ? 0.8 : 1} />
          ))}
          <circle r="8" fill={state === 'wilted' ? 'var(--soil)' : center} />
        </g>
      )}
      {(state === 'asking' || state === 'blocked') && (
        <g transform="translate(50 50)">
          <path d="M0 -26 C16 -14 16 8 0 16 C-16 8 -16 -14 0 -26Z"
            fill={state === 'asking' ? 'var(--lantern)' : 'none'} fillOpacity=".9"
            stroke={state === 'blocked' ? 'var(--red)' : 'var(--cream)'} strokeWidth={state === 'blocked' ? 4 : 2} strokeDasharray={state === 'blocked' ? '5 3' : undefined} />
          {state === 'blocked' && <path d="M-4 -8 L4 4 M4 -8 L-4 4" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" />}
        </g>
      )}
      <ellipse cx="50" cy="114" rx="26" ry="4" fill="var(--soil)" opacity=".7" />
    </svg>
  )
}

// Earned trust plant: 0 seed, 1 sprout, 2 bud, 3 bloom.
export function Plant({ stage }: { stage: 0 | 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 120 130" className={`plant stage-${stage}`} role="img" aria-label={`Trust plant, stage ${stage} of 3`}>
      <ellipse cx="60" cy="116" rx="44" ry="8" fill="var(--soil)" />
      {stage === 0 && <ellipse cx="60" cy="108" rx="9" ry="6" fill="var(--seed)" />}
      {stage >= 1 && (
        <>
          <path d={stage === 1 ? 'M60 112 C60 100 60 94 60 88' : 'M60 112 C59 90 61 72 60 54'} fill="none" stroke="var(--sage)" strokeWidth="5" strokeLinecap="round" />
          <path d={stage === 1 ? 'M60 94 C48 94 42 86 42 78 C54 78 60 84 60 94Z' : 'M60 98 C46 98 38 90 36 80 C50 80 58 88 60 98Z'} fill="var(--sage)" />
          <path d={stage === 1 ? 'M60 90 C72 90 78 82 78 74 C66 74 60 80 60 90Z' : 'M60 84 C74 84 82 76 84 66 C70 66 62 74 60 84Z'} fill="var(--sage)" opacity=".85" />
        </>
      )}
      {stage === 2 && <path d="M60 30 C72 40 72 56 60 62 C48 56 48 40 60 30Z" fill="var(--blush)" stroke="var(--cream)" strokeWidth="2" />}
      {stage === 3 && (
        <g transform="translate(60 48)">
          {Array.from({ length: 8 }, (_, k) => <ellipse key={k} cx="0" cy="-17" rx="8" ry="16" transform={`rotate(${k * 45})`} fill={k % 2 ? 'var(--lavender)' : 'var(--blush)'} />)}
          <circle r="9" fill="var(--lantern)" />
        </g>
      )}
    </svg>
  )
}

// Moon by night; sun when something needs the user. Both stay mounted so it can crossfade.
export function SkyBody({ sun }: { sun: boolean }) {
  return (
    <svg viewBox="0 0 160 160" className={`sky ${sun ? 'is-sun' : 'is-moon'}`} role="img" aria-label={sun ? 'Sun: something needs you' : 'Moon: all quiet'}>
      <defs>
        <mask id="crescent">
          <rect width="160" height="160" fill="#fff" />
          <circle cx="102" cy="68" r="38" fill="#000" />
        </mask>
      </defs>
      <g className="moon">
        <circle cx="80" cy="80" r="46" fill="var(--cream)" mask="url(#crescent)" />
      </g>
      <g className="sun">
        {Array.from({ length: 12 }, (_, k) => <line key={k} x1="80" y1="14" x2="80" y2="30" stroke="var(--lantern)" strokeWidth="6" strokeLinecap="round" transform={`rotate(${k * 30} 80 80)`} />)}
        <circle cx="80" cy="80" r="36" fill="var(--lantern)" />
      </g>
    </svg>
  )
}

// A repeating vine with leaves and tiny blossoms.
export function Garland() {
  return (
    <svg className="garland" height="34" width="100%" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="vine" width="96" height="34" patternUnits="userSpaceOnUse">
          <path d="M0 17 C16 4 32 30 48 17 S80 4 96 17" fill="none" stroke="var(--sage)" strokeWidth="3" strokeLinecap="round" />
          <path d="M20 12 c-2 -8 4 -10 8 -8 c0 6 -4 9 -8 8z" fill="var(--sage)" />
          <path d="M68 22 c2 8 -4 10 -8 8 c0 -6 4 -9 8 -8z" fill="var(--sage)" />
          <circle cx="48" cy="17" r="5" fill="var(--blush)" /><circle cx="48" cy="17" r="2" fill="var(--lantern)" />
          <circle cx="0" cy="17" r="4" fill="var(--lavender)" />
        </pattern>
      </defs>
      <rect width="100%" height="34" fill="url(#vine)" />
    </svg>
  )
}

// Static rolling hills with a few silhouetted blossoms at the bottom of the hero.
export function Hills() {
  return (
    <svg className="hills" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 80 C200 30 380 100 600 60 S1000 20 1200 70 V120 H0Z" fill="var(--hill-far)" />
      <path d="M0 100 C240 60 420 120 660 90 S1020 60 1200 100 V120 H0Z" fill="var(--hill-near)" />
    </svg>
  )
}
