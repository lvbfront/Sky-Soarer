import type { CSSProperties, ReactNode } from 'react';
import { CornerBrackets } from '@/ui/hud';

// Procedural illustrations for the "How to fly" guide: SVG shapes animated by the ascent-guide-*
// CSS keyframes in index.css. No image assets. Each looping illustration passes a `pose` (a
// negative animation delay) so reduced motion freezes it on its most telling frame.

const INK = '#0e1c2e';
const LINE = 'rgba(255,255,255,0.88)';
const FAINT = 'rgba(255,255,255,0.4)';
const CYAN = 'var(--ascent-cyan)';
const WARM = 'var(--ascent-warm)';

const stroke = { stroke: LINE, strokeWidth: 1.3, vectorEffect: 'non-scaling-stroke' } as const;

/** Index, middle, ring, pinky: x of each finger's left edge and its length above the palm. */
const FINGERS = [
  { x: -13, length: 16 },
  { x: -6, length: 19 },
  { x: 1, length: 17.5 },
  { x: 8, length: 13.5 },
];

/**
 * An open hand, palm to the camera, centered on its palm (the point steering tracks, marked in
 * cyan). With `fold`, the fingers and thumb curl into a fist and open again on the 3 s cycle.
 */
function HandGlyph({ fold = false }: { fold?: boolean }) {
  return (
    <g>
      {FINGERS.map((finger) => (
        <rect
          key={finger.x}
          className={`ascent-guide-finger ${fold ? 'ascent-guide-fold' : ''}`}
          x={finger.x}
          y={-8 - finger.length}
          width={5.6}
          height={finger.length + 4}
          rx={2.8}
          fill={INK}
          {...stroke}
        />
      ))}
      <g transform="rotate(-32 -14 8)">
        <rect
          className={`ascent-guide-thumb ${fold ? 'ascent-guide-thumb-fold' : ''}`}
          x={-19}
          y={-6}
          width={5.8}
          height={15}
          rx={2.9}
          fill={INK}
          {...stroke}
        />
      </g>
      <rect x={-14} y={-10} width={28} height={23} rx={8} fill={INK} {...stroke} />
      <circle cx={0} cy={1.5} r={1.8} fill={CYAN} />
    </g>
  );
}

/** A bird seen from behind (wings, body, tail), for the barrel roll. */
function BirdFromBehind() {
  return (
    <g>
      <path d="M-24 1 Q-12 -7 0 0 Q12 -7 24 1" fill="none" {...stroke} strokeWidth={1.6} />
      <circle cx={0} cy={0.5} r={3.2} fill={INK} {...stroke} />
      <path d="M-2.5 3.5 L0 8 L2.5 3.5" fill="none" {...stroke} />
    </g>
  );
}

function Label({ x, y, children, fill = FAINT, anchor = 'middle', className, style }: {
  x: number;
  y: number;
  children: ReactNode;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={fill}
      className={className}
      style={{ fontFamily: 'var(--app-font-mono)', fontSize: 6.5, letterSpacing: '0.12em', ...style }}
    >
      {children}
    </text>
  );
}

/** The sensor-feed frame every illustration sits in, matching the calibration and HUD feeds. */
export function ArtFrame({ children, pose, label }: { children: ReactNode; pose: string; label: string }) {
  return (
    <div
      className="ascent-guide-art relative aspect-[8/5] w-full overflow-hidden rounded-md border border-white/15 bg-black/35"
      style={{ ['--pose' as string]: pose }}
      role="img"
      aria-label={label}
    >
      {children}
      <div className="ascent-scanlines pointer-events-none absolute inset-0" />
      <CornerBrackets size={9} inset={5} className="text-white/55" />
    </div>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Steer: the palm visits each corner of the calibrated box; a corner is full climb/dive and bank. */
export function SteerArt() {
  return (
    <ArtFrame pose="-1.5s" label="A palm moving to each corner of the calibrated steering box">
      <Svg>
        <rect x={34} y={16} width={92} height={68} rx={3} fill="rgba(255,255,255,0.03)" stroke={FAINT} strokeDasharray="3 3" />
        <path d="M80 44 V56 M74 50 H86" stroke={CYAN} strokeWidth={1} opacity={0.8} />
        <Label x={80} y={11}>CLIMB</Label>
        <Label x={80} y={95}>DIVE</Label>
        <Label x={26} y={52.5}>L</Label>
        <Label x={134} y={52.5}>R</Label>
        <g transform="translate(80 52)">
          <g className="ascent-guide-steer">
            <g transform="scale(0.9)">
              <HandGlyph />
            </g>
          </g>
        </g>
      </Svg>
    </ArtFrame>
  );
}

/** Boost: the hand closes into a fist and holds; speed streaks run for as long as it's closed. */
export function BoostArt() {
  const streaks = [22, 34, 46, 58, 70, 80];
  return (
    <ArtFrame pose="-1.5s" label="An open hand closing into a fist and holding it to boost">
      <Svg>
        <g transform="translate(56 58) scale(1.35)">
          <HandGlyph fold />
        </g>
        <g className="ascent-guide-while-closed">
          <g className="ascent-guide-streak">
            {streaks.map((y, index) => (
              <line
                key={y}
                x1={98 + (index % 3) * 8}
                x2={126 + (index % 2) * 10}
                y1={y}
                y2={y}
                stroke={WARM}
                strokeWidth={1.2}
                strokeLinecap="round"
                opacity={0.55 + (index % 2) * 0.35}
              />
            ))}
          </g>
          <Label x={150} y={14} anchor="end" fill={WARM}>
            BOOST
          </Label>
        </g>
        <Label x={12} y={14} anchor="start">
          HOLD FIST
        </Label>
      </Svg>
    </ArtFrame>
  );
}

/** Barrel roll: the moment the fist closes, the bird rolls once around its flight path. */
export function BarrelRollArt({ seconds }: { seconds: number }) {
  return (
    <ArtFrame pose="-1.35s" label="A fist closing, and the bird rolling a full turn at that instant">
      <Svg>
        <g transform="translate(38 58) scale(1.1)">
          <HandGlyph fold />
        </g>
        <path d="M66 52 H82 M78 48 L82 52 L78 56" fill="none" stroke={FAINT} strokeWidth={1} />
        <circle cx={116} cy={50} r={27} fill="none" stroke={FAINT} strokeDasharray="2 4" />
        <g transform="translate(116 50)">
          <g className="ascent-guide-spin ascent-guide-roll">
            <BirdFromBehind />
          </g>
        </g>
        <Label x={116} y={93}>
          360° · {seconds.toFixed(1)} S
        </Label>
      </Svg>
    </ArtFrame>
  );
}

/**
 * Backflip: the palm snaps up about half the calibrated box, fast. The dashed rectangle is the box
 * (54 units tall), the dashed lines mark the start and end heights and the bracket the 27-unit
 * rise, which is the distance the `ascent-guide-flick` keyframes move the hand.
 */
export function BackflipArt({ distanceLabel, timeLabel }: { distanceLabel: string; timeLabel: string }) {
  return (
    <ArtFrame pose="-1.2s" label="An open palm snapping quickly upward by about half the calibrated box">
      <Svg>
        <rect x={14} y={20} width={78} height={54} rx={3} stroke={FAINT} strokeDasharray="3 3" fill="none" />
        <line x1={16} x2={90} y1={72} y2={72} stroke={FAINT} strokeDasharray="2 3" />
        <line x1={16} x2={90} y1={45} y2={45} stroke={WARM} strokeDasharray="2 3" opacity={0.8} />
        <path d="M96 45 V72 M92 45 H100 M92 72 H100" stroke={WARM} strokeWidth={1.2} fill="none" />
        <Label x={104} y={57} anchor="start" fill={WARM}>
          {distanceLabel}
        </Label>
        <Label x={104} y={66} anchor="start">
          {timeLabel}
        </Label>
        <g transform="translate(52 72)">
          <g className="ascent-guide-flick">
            <g className="ascent-guide-flick-trail">
              {[-8, 0, 8].map((x) => (
                <line key={x} x1={x} x2={x} y1={17} y2={34} stroke={WARM} strokeWidth={1.2} strokeLinecap="round" />
              ))}
            </g>
            <g transform="scale(0.9)">
              <HandGlyph />
            </g>
          </g>
        </g>
        <Label x={12} y={14} anchor="start">
          YOUR BOX
        </Label>
      </Svg>
    </ArtFrame>
  );
}

/**
 * Air brake: the open palm pushed toward the camera, so it looks bigger than the dashed outline
 * (its size at calibration). While it's held big, the BRAKE readout and a tight turn arc light up.
 */
export function PushArt({ ratioLabel }: { ratioLabel: string }) {
  return (
    <ArtFrame pose="-1.6s" label="An open palm pushed toward the camera so it looks bigger, applying the air brake">
      <Svg>
        <circle cx={56} cy={52} r={24} fill="none" stroke={FAINT} strokeDasharray="3 3" />
        <Label x={56} y={92}>
          CALIBRATED SIZE
        </Label>
        <g transform="translate(56 52)">
          <g className="ascent-guide-push">
            <HandGlyph />
          </g>
        </g>
        <g className="ascent-guide-while-pushed">
          <path d="M104 74 Q104 34 132 30" fill="none" stroke={CYAN} strokeWidth={1.4} strokeLinecap="round" />
          <path d="M128 26 L133 30 L128 34" fill="none" stroke={CYAN} strokeWidth={1.4} strokeLinecap="round" />
          <Label x={150} y={14} anchor="end" fill={CYAN}>
            BRAKE
          </Label>
          <Label x={150} y={92} anchor="end" fill={CYAN}>
            {ratioLabel}
          </Label>
        </g>
      </Svg>
    </ArtFrame>
  );
}

/** One keycap. `press` animates it on a loop, starting `delay` into the cycle. */
export function Keycap({
  children,
  press = false,
  delay = '0s',
  cycle = '4s',
  wide = false,
  label,
}: {
  children: ReactNode;
  press?: boolean;
  delay?: string;
  cycle?: string;
  wide?: boolean;
  label?: string;
}) {
  return (
    <kbd
      className={`ascent-key ${press ? 'ascent-key-press' : ''}`}
      style={{
        ['--press-delay' as string]: delay,
        ['--press-cycle' as string]: cycle,
        ...(wide ? { minWidth: '9rem' } : null),
      }}
      aria-label={label}
    >
      {children}
    </kbd>
  );
}

/** The frame the keyboard guide's keycaps sit in, matching the hand illustrations' frame. */
export function KeyFrame({ children, label, pose = '-0.5s' }: { children: ReactNode; label: string; pose?: string }) {
  return (
    <div
      className="relative flex aspect-[8/5] w-full items-center justify-center overflow-hidden rounded-md border border-white/15 bg-black/35"
      style={{ ['--pose' as string]: pose }}
      role="img"
      aria-label={label}
    >
      {children}
      <CornerBrackets size={9} inset={5} className="text-white/55" />
    </div>
  );
}

/**
 * W A S D, each cap also carrying its arrow key, pressed in a W → D → S → A loop (climb, bank
 * right, dive, bank left). One cluster, so it fits the illustration frame.
 */
export function SteerKeysArt() {
  // Negative delays start each key at a different point of the shared 4 s cycle, one second apart.
  const key = (letter: string, arrow: string, delay: string, action: string) => (
    <Keycap press delay={delay} label={`${letter} or ${arrow}: ${action}`}>
      <span className="flex flex-col items-center leading-none">
        <span>{letter}</span>
        <span className="mt-0.5 text-[10px] opacity-60">{arrow}</span>
      </span>
    </Keycap>
  );
  return (
    <KeyFrame label="W A S D or the arrow keys">
      <div className="grid grid-cols-3 gap-1 [&_kbd]:h-10">
        <span />
        {key('W', '↑', '0s', 'climb')}
        <span />
        {key('A', '←', '-1s', 'bank left')}
        {key('S', '↓', '-2s', 'dive')}
        {key('D', '→', '-3s', 'bank right')}
      </div>
    </KeyFrame>
  );
}
