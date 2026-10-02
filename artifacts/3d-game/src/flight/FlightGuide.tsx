import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { BACKFLIP_DURATION, BARREL_ROLL_DURATION, BASE_SPEED, BOOST_SPEED } from '@/game/presets';
import {
  BACKFLIP_COOLDOWN_MS,
  BRAKE_ENGAGE_RATIO,
  BRAKE_HOLD_MS,
  BRAKE_RELEASE_RATIO,
  FIST_HOLD_FRAMES,
  FLICK_MIN_RISE,
  FLICK_MIN_SPEED,
  FLICK_TIP_RISE,
  FLICK_TIP_SECONDS,
  FLICK_WINDOW_MS,
  STEERING_DEADZONE,
  describeBoxFraction,
} from '@/game/trackingShared';
import {
  AIR_BRAKE_SINK,
  CRUISE_TURN_RATE_DEG,
  KEY_PITCH_RAMP_UP,
  KEY_ROLL_RAMP_UP,
} from '@/game/flightTuning';
import { brakeSpeed, turnRate } from '@/game/flightModel';
import type { ControlMode } from '@/game/settings';
import { CornerBrackets } from '@/ui/hud';
import { BackflipArt, BarrelRollArt, BoostArt, KeyFrame, Keycap, PushArt, SteerArt, SteerKeysArt } from './guideArt';

/** Where the guide was opened from, which decides its buttons. */
export type GuideOrigin = 'preflight' | 'pause' | 'hud';

// Every number below comes from the constants the tracker, keyboard and engine actually use, so
// the guide can't drift from the real behavior.
const MS_TO_KNOTS = 1.943844;
const CRUISE_KT = Math.round(BASE_SPEED * MS_TO_KNOTS);
const BOOST_KT = Math.round(BOOST_SPEED * MS_TO_KNOTS);
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
const seconds = (value: number) => `${value.toFixed(1)} s`;

// The backflip is measured in heights of the player's calibrated box: at least FLICK_MIN_RISE of it
// within FLICK_WINDOW_MS, peaking above FLICK_MIN_SPEED box heights per second. The tip recommends
// FLICK_TIP_RISE (half the box) within FLICK_TIP_SECONDS, which clears both with room to spare.
const FLICK_TIP_LABEL = describeBoxFraction(FLICK_TIP_RISE);
const FLICK_TIP_GLYPH = FLICK_TIP_RISE === 0.5 ? '½' : FLICK_TIP_RISE === 0.75 ? '¾' : percent(FLICK_TIP_RISE);

// The air brake, from the flight model itself: its speed, and full-input turn rates with and without it.
const BRAKE_KT = Math.round(brakeSpeed('air', BASE_SPEED) * MS_TO_KNOTS);
const degPerSec = (radians: number) => Math.round((radians * 180) / Math.PI);
const BRAKE_TURN = degPerSec(turnRate(1, brakeSpeed('air', BASE_SPEED), 'air', true, 1));
const SWIM_BRAKE_TURN = degPerSec(turnRate(1, brakeSpeed('water', BASE_SPEED), 'water', true, 1));
const CRUISE_TURN = Math.round(CRUISE_TURN_RATE_DEG);
const BOOST_TURN = degPerSec(turnRate(1, BOOST_SPEED, 'air', false, 1));

interface Move {
  code: string;
  title: string;
  /** The gesture or keys, in a few words. */
  input: ReactNode;
  art: ReactNode;
  /** One precise tip. */
  tip: string;
  /** The exact numbers behind the tip, small. */
  spec: string;
}

const HAND_MOVES: Move[] = [
  {
    code: '01',
    title: 'Steer',
    input: 'Move your palm inside your box',
    art: <SteerArt />,
    tip: `Small moves turn gently and the outer part of your box turns hard: a corner is full climb or dive plus full bank. The middle ${percent(
      STEERING_DEADZONE,
    )} is a dead zone, so a steady palm flies level.`,
    spec: `Full bank turns ${CRUISE_TURN}°/s at cruise, ${BOOST_TURN}°/s boosting · sensitivity scales it · tracks your palm center`,
  },
  {
    code: '02',
    title: 'Boost',
    input: 'Close your fist',
    art: <BoostArt />,
    tip: 'Curl all four fingertips into your palm and hold it: boost lasts exactly as long as the fist does, and steering holds still while it closes.',
    spec: `Locks after ${FIST_HOLD_FRAMES} camera frames · ${CRUISE_KT} → ${BOOST_KT} kt`,
  },
  {
    code: '03',
    title: 'Barrel roll',
    input: 'Automatic as the fist closes',
    art: <BarrelRollArt seconds={BARREL_ROLL_DURATION} />,
    tip: 'It fires the instant your fist closes, so to roll again, open your hand fully first, then close it.',
    spec: `360° in ${seconds(BARREL_ROLL_DURATION)} · heading holds straight`,
  },
  {
    code: '04',
    title: 'Backflip',
    input: 'Quick upward flick',
    art: (
      <BackflipArt distanceLabel={`≈ ${FLICK_TIP_GLYPH} BOX`} timeLabel={`< ${FLICK_TIP_SECONDS.toFixed(1)} S`} />
    ),
    tip: `Snap your open palm straight up about ${FLICK_TIP_LABEL} the height of your calibrated box, in one quick motion of ${seconds(
      FLICK_TIP_SECONDS,
    )} or less. The bird's nose stays level through it.`,
    spec: `Needs ≥ ${percent(FLICK_MIN_RISE)} of your box within ${FLICK_WINDOW_MS} ms, peaking > ${FLICK_MIN_SPEED.toFixed(
      1,
    )} box-heights/s · ${seconds(BACKFLIP_COOLDOWN_MS / 1000)} cooldown`,
  },
  {
    code: '05',
    title: 'Air brake & tight turns',
    input: 'Push your open palm toward the camera',
    art: <PushArt ratioLabel={`≥ ${percent(BRAKE_ENGAGE_RATIO)} SIZE`} />,
    tip: `Move your open hand a little closer to the camera and hold it: the bird slows to ${BRAKE_KT} kt, sinks gently and turns at up to ${BRAKE_TURN}°/s. Pull back to release. Steering stays where your palm is.`,
    spec: `Engages at ≥ ${percent(BRAKE_ENGAGE_RATIO)} of your calibrated palm size for ${BRAKE_HOLD_MS} ms · releases below ${percent(
      BRAKE_RELEASE_RATIO,
    )} · sinks ${AIR_BRAKE_SINK.toFixed(1)} m/s · boost cancels it`,
  },
];

const KEYBOARD_MOVES: Move[] = [
  {
    code: '01',
    title: 'Steer',
    input: 'W A S D or the arrow keys',
    art: <SteerKeysArt />,
    tip: `A held key banks fully in about ${seconds(1 / KEY_ROLL_RAMP_UP)} (climb or dive in ${seconds(
      1 / KEY_PITCH_RAMP_UP,
    )}) and rolls back to level without overshoot when you let go, so tap for small corrections.`,
    spec: `W / ↑ climb · S / ↓ dive · A / ← · D / → bank · full bank ${CRUISE_TURN}°/s at cruise, scaled by sensitivity`,
  },
  {
    code: '02',
    title: 'Boost + barrel roll',
    input: 'Hold Space',
    art: (
      <KeyFrame label="The Space bar">
        <Keycap press wide cycle="3s" label="Space">
          Space
        </Keycap>
      </KeyFrame>
    ),
    tip: `Hold Space to boost; every new press also fires a ${seconds(BARREL_ROLL_DURATION)} barrel roll.`,
    spec: `${CRUISE_KT} → ${BOOST_KT} kt · heading holds straight during the roll`,
  },
  {
    code: '03',
    title: 'Backflip',
    input: 'Press F',
    art: (
      <KeyFrame label="The F key">
        <Keycap press cycle="2.6s" label="F">
          F
        </Keycap>
      </KeyFrame>
    ),
    tip: `One press, one ${seconds(BACKFLIP_DURATION)} backflip; your heading and speed don't change.`,
    spec: 'Tricks are cosmetic · one at a time',
  },
  {
    code: '04',
    title: 'Air brake & tight turns',
    input: 'Hold Shift',
    art: (
      <KeyFrame label="The Shift key">
        <Keycap press wide cycle="3.2s" label="Shift">
          Shift
        </Keycap>
      </KeyFrame>
    ),
    tip: `Hold Shift to slow to ${BRAKE_KT} kt and turn at up to ${BRAKE_TURN}°/s (${SWIM_BRAKE_TURN}°/s swimming): perfect for U-turns, chasing a shark, or a landing approach. The bird sinks gently while braking.`,
    spec: `Sinks ${AIR_BRAKE_SINK.toFixed(1)} m/s · never stalls · Space (boost) cancels it`,
  },
  {
    code: '05',
    title: 'Pause',
    input: 'Esc, or ? for this guide',
    art: (
      <KeyFrame label="The Escape and question mark keys">
        <div className="flex items-center gap-3">
          <Keycap press cycle="4s" label="Escape">
            Esc
          </Keycap>
          <Keycap press cycle="4s" delay="-2s" label="Question mark">
            ?
          </Keycap>
        </div>
      </KeyFrame>
    ),
    tip: 'Esc freezes the flight and opens the pause menu; press it again to fly on.',
    spec: 'Both are also buttons at the top right',
  },
];

interface FlightGuideProps {
  mode: ControlMode;
  origin: GuideOrigin;
  reducedMotion: boolean;
  /** Take off (pre-flight), back to the pause menu, or resume (from the HUD button). */
  onPrimary: (dontShowAgain: boolean) => void;
  /** Pre-flight only: back to calibration (hand) or to the landing (keyboard). */
  onSecondary?: () => void;
}

/**
 * The "How to fly" guide: one card per move, each with a looping procedural illustration, one
 * precise tip, and the exact numbers behind it. Opens by itself before a flight (until "Don't show
 * again" is ticked), and from the pause menu or the "?" HUD button. Esc is handled by App.
 */
export function FlightGuide({ mode, origin, reducedMotion, onPrimary, onSecondary }: FlightGuideProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const moves = mode === 'hand' ? HAND_MOVES : KEYBOARD_MOVES;
  const preflight = origin === 'preflight';

  useLayoutEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
    const root = rootRef.current;
    if (!root || reducedMotion) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline()
        .fromTo('[data-guide-scrim]', { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'none' })
        .fromTo('[data-guide-panel]', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 0.05)
        .fromTo(
          '[data-guide-card]',
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power2.out', clearProps: 'opacity,transform' },
          0.18,
        );
    }, root);
    return () => ctx.revert();
    // A one-shot entrance on mount.
  }, []);

  const primaryLabel = preflight ? 'Take off' : origin === 'pause' ? 'Back to pause menu' : 'Resume flight';

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[35] overflow-y-auto text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div data-guide-scrim className="pointer-events-none fixed inset-0 bg-[#06101f]/60" />
      <div className="ascent-grain pointer-events-none fixed inset-0" />
      <div className="relative flex min-h-full items-center justify-center px-4 py-8 sm:px-6">
        <section data-guide-panel className="ascent-glass-strong relative w-full max-w-5xl rounded-[28px] p-5 shadow-2xl sm:p-7">
          <CornerBrackets size={16} inset={10} className="text-white/35" />

          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <p className="ascent-hud mb-2 flex items-center gap-3 text-[color:var(--ascent-cyan)]">
                <span>Flight manual</span>
                <span className="h-px w-8 bg-current opacity-60" />
                <span className="text-white/80">{mode === 'hand' ? 'Hand · webcam' : 'Keyboard'}</span>
              </p>
              <h2 id={titleId} className="font-display text-[clamp(2.25rem,4vw,3.25rem)] leading-none tracking-[-0.015em]">
                How to fly
              </h2>
            </div>
            <p className="ascent-hud max-w-md text-[10px] leading-relaxed text-white/55">
              {mode === 'hand'
                ? 'Keep your hand inside the camera frame · tricks are cosmetic'
                : 'Tricks are cosmetic · the mouse is for menus only'}
            </p>
          </header>

          <ol className="mt-5 grid gap-3 md:grid-cols-2">
            {moves.map((move) => (
              <li
                key={move.code}
                data-guide-card
                className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-4 rounded-2xl border border-white/12 bg-white/[0.035] p-3.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
              >
                {move.art}
                <div className="min-w-0">
                  <p className="ascent-hud text-[color:var(--ascent-cyan)]">
                    {move.code} <span className="text-white/35">·</span> {move.input}
                  </p>
                  <h3 className="mt-1 font-display text-[1.75rem] leading-none">{move.title}</h3>
                  <p className="mt-2 text-[13px] leading-snug text-white/85">{move.tip}</p>
                  <p className="mt-2 font-mono text-[10px] leading-snug text-white/50">{move.spec}</p>
                </div>
              </li>
            ))}
          </ol>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              {preflight && onSecondary && (
                <button
                  type="button"
                  onClick={onSecondary}
                  className="ascent-hud ascent-glass flex items-center gap-1.5 rounded-full px-4 py-2.5 text-white/90 transition-colors hover:bg-white/15"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {mode === 'hand' ? 'Back to calibration' : 'Back'}
                </button>
              )}
              {preflight && (
                <label className="ascent-hud flex cursor-pointer items-center gap-2.5 text-white/75">
                  <input
                    type="checkbox"
                    checked={dontShowAgain}
                    onChange={(event) => setDontShowAgain(event.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-[color:var(--ascent-warm)]"
                  />
                  Don't show again
                </label>
              )}
              {!preflight && <p className="ascent-hud text-[10px] text-white/50">Esc to close</p>}
            </div>
            <button
              ref={primaryRef}
              type="button"
              onClick={() => onPrimary(dontShowAgain)}
              className="group flex items-center gap-4 rounded-full bg-white py-2 pl-6 pr-2 text-[color:var(--ascent-ink)] transition-colors hover:bg-[color:var(--ascent-warm)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              <span className="text-base font-semibold">{primaryLabel}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--ascent-ink)] text-white">
                <ArrowRight className="h-4 w-4" />
              </span>
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}
