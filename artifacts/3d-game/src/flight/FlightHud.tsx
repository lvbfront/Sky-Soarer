import { useEffect, useRef, type RefObject } from 'react';
import { Pause, X } from 'lucide-react';
import type { GameEngine } from '@/game/GameEngine';
import type { HandControlState } from '@/game/handControls';
import type { RingHighlight } from '@/game/presets';
import type { ControlMode } from '@/game/settings';
import type { FlickNearMiss } from '@/game/trackingShared';
import { CornerBrackets } from '@/ui/hud';

/** A near-miss flick to coach; `id` changes for every new one so the hint replays. */
export interface FlickHint {
  kind: FlickNearMiss;
  id: number;
}

const FLICK_HINT_TEXT: Record<FlickNearMiss, { main: string; sub: string }> = {
  'too-slow': { main: 'Flick faster ↑', sub: 'Almost a backflip: same move, in one quick snap' },
  'too-short': { main: 'Flick higher ↑', sub: 'Almost a backflip: snap a quarter of the frame up' },
};

interface FlightHudProps {
  /** Read every frame for the telemetry readouts; type-only, so the engine chunk stays lazy. */
  engineRef: RefObject<GameEngine | null>;
  controlMode: ControlMode;
  /** The latest control reading, read every frame by the keyboard input indicator. */
  controlStateRef: RefObject<HandControlState | null>;
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  previewWidth: number;
  previewHeight: number;
  handDetected: boolean;
  boosting: boolean;
  barrelRolling: boolean;
  backflipping: boolean;
  underwater: boolean;
  surfaceSplash: boolean;
  /** Show the Diving badge (ocean map only). */
  showDiving: boolean;
  ringChallenge: boolean;
  /** The next ring's highlight color (Ring Challenge), for the NEXT RING readout's marker. */
  ringHighlight: RingHighlight;
  score: number;
  bestScore: number;
  statusText: string;
  flickHint: FlickHint | null;
  /** True while the pause menu or guide is open over the HUD: it's inert (no focus, no clicks). */
  paused: boolean;
  onPause: () => void;
  onGuide: () => void;
  onStop: () => void;
}

// The engine's world units are treated as meters and m/s; the landing's telemetry also uses knots.
const MS_TO_KNOTS = 1.943844;
// Text readouts are rewritten at this interval (the heading tape moves every frame).
const READOUT_INTERVAL_MS = 100;

// Heading tape: a strip of ticks from TAPE_MIN_DEG to TAPE_MAX_DEG, slid so the current heading
// sits under the center caret. The range covers 0..360 plus more than half the window on each
// side, so the strip never needs to wrap.
const TAPE_WIDTH = 264;
const TAPE_PX_PER_DEG = 3;
const TAPE_MIN_DEG = -120;
const TAPE_MAX_DEG = 480;
const TAPE_TICKS = Array.from({ length: (TAPE_MAX_DEG - TAPE_MIN_DEG) / 10 + 1 }, (_, i) => TAPE_MIN_DEG + i * 10);
const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

function tapeLabel(deg: number) {
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized % 30 !== 0) return null;
  return CARDINALS[normalized] ?? String(normalized).padStart(3, '0');
}

function tapeOffset(heading: number) {
  return TAPE_WIDTH / 2 - (heading - TAPE_MIN_DEG) * TAPE_PX_PER_DEG;
}

function formatAltitude(meters: number) {
  const rounded = Math.round(meters);
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded).toString().padStart(3, '0')}`;
}

/**
 * The in-flight HUD: heading tape, speed/altitude readouts, score, trick badges, the boost HUD
 * effect, and the small sensor feed. Every top-level block carries `data-flight-hud` so the
 * takeoff reveal in App can stagger them in; those wrappers must not carry CSS transitions.
 */
// The keyboard input indicator: the stick dot moves this many px at full pitch or roll.
const STICK_RANGE_X = 58;
const STICK_RANGE_Y = 42;

/** Blurs a HUD button after a mouse click, so Space (boost) can't "click" it again mid-flight. */
function blurAfter(action: () => void) {
  return (event: { currentTarget: HTMLElement }) => {
    event.currentTarget.blur();
    action();
  };
}

export function FlightHud({
  engineRef,
  controlMode,
  controlStateRef,
  previewCanvasRef,
  previewWidth,
  previewHeight,
  handDetected,
  boosting,
  barrelRolling,
  backflipping,
  underwater,
  surfaceSplash,
  showDiving,
  ringChallenge,
  ringHighlight,
  score,
  bestScore,
  statusText,
  flickHint,
  paused,
  onPause,
  onGuide,
  onStop,
}: FlightHudProps) {
  const keyboard = controlMode === 'keyboard';
  const tapeRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<HTMLSpanElement | null>(null);
  const headingRef = useRef<HTMLSpanElement | null>(null);
  const speedRef = useRef<HTMLSpanElement | null>(null);
  const altitudeRef = useRef<HTMLSpanElement | null>(null);
  const nextRingRef = useRef<HTMLSpanElement | null>(null);

  // Telemetry: direct DOM writes from a rAF loop, never React state, so the HUD costs no renders.
  useEffect(() => {
    let raf = 0;
    let lastReadout = -Infinity;
    const tick = (now: number) => {
      const engine = engineRef.current;
      if (engine) {
        const heading = engine.getHeadingDegrees();
        if (tapeRef.current) tapeRef.current.style.transform = `translate3d(${tapeOffset(heading)}px, 0, 0)`;
        if (now - lastReadout >= READOUT_INTERVAL_MS) {
          lastReadout = now;
          if (headingRef.current) headingRef.current.textContent = String(Math.round(heading) % 360).padStart(3, '0');
          if (speedRef.current) {
            speedRef.current.textContent = String(Math.round(engine.getSpeed() * MS_TO_KNOTS)).padStart(3, '0');
          }
          if (altitudeRef.current) altitudeRef.current.textContent = formatAltitude(engine.getAltitude());
          if (nextRingRef.current) {
            const distance = engine.getNextRingDistance();
            nextRingRef.current.textContent = distance === null ? '—' : String(Math.round(distance));
          }
        }
      }
      const control = controlStateRef.current;
      if (stickRef.current && control) {
        stickRef.current.style.transform = `translate3d(${control.roll * STICK_RANGE_X}px, ${-control.pitch * STICK_RANGE_Y}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineRef, controlStateRef]);

  const badges = [
    { key: 'boost', label: 'Boost', active: boosting, cool: false },
    { key: 'roll', label: 'Barrel Roll', active: barrelRolling, cool: false },
    { key: 'flip', label: 'Backflip', active: backflipping, cool: false },
    ...(showDiving ? [{ key: 'dive', label: 'Diving', active: underwater, cool: true }] : []),
  ];

  return (
    <div className="fixed inset-0 z-10 overflow-hidden text-white" inert={paused}>
      {/* ---- Boost: a HUD effect rather than a color wash. Edge speed streaks rush past, a faint
          warm rim glows, and the frame brackets tighten in. ---- */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-200"
        style={{ opacity: boosting ? 1 : 0 }}
        aria-hidden="true"
      >
        <div className={`ascent-boost-streaks absolute -inset-[12%] ${boosting ? 'ascent-boost-streaks-live' : ''}`} />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 120px 20px rgba(255,179,122,0.28)' }} />
      </div>
      <div
        className={`pointer-events-none absolute inset-4 transition-[transform,color] duration-300 ease-out sm:inset-5 ${
          boosting ? 'scale-[0.965] text-[color:var(--ascent-warm)]' : 'text-white/30'
        }`}
        aria-hidden="true"
      >
        <CornerBrackets size={28} thickness={boosting ? 2 : 1.5} />
      </div>

      {/* Brief water-droplet screen flash the moment the bird breaks back into the air
          after a dive. */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-150"
        style={{
          opacity: surfaceSplash ? 1 : 0,
          background:
            'radial-gradient(ellipse at center, rgba(255,255,255,0) 30%, rgba(214,244,255,0.5) 75%, rgba(160,220,255,0.75) 100%)',
        }}
      />
      {/* Blue tint overlay while submerged, on top of the underwater fog/lighting already
          applied inside the 3D scene itself. */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: underwater ? 1 : 0,
          background: 'linear-gradient(rgba(20,110,150,0.18), rgba(10,60,90,0.32))',
        }}
      />
      {/* Readability scrims behind the corner readouts. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48"
        style={{ background: 'linear-gradient(to top, rgba(6,16,31,0.35), rgba(6,16,31,0))' }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-32"
        style={{ background: 'linear-gradient(to bottom, rgba(6,16,31,0.25), rgba(6,16,31,0))' }}
      />

      {/* ---- Top center: heading tape + steering hint ---- */}
      <div data-flight-hud className="pointer-events-none absolute left-1/2 top-6 flex -translate-x-1/2 flex-col items-center">
        <div
          className="ascent-glass relative h-9 overflow-hidden rounded-full"
          style={{ width: TAPE_WIDTH }}
          aria-hidden="true"
        >
          <div
            className="absolute inset-0"
            style={{
              WebkitMaskImage: 'linear-gradient(90deg, transparent, black 24%, black 76%, transparent)',
              maskImage: 'linear-gradient(90deg, transparent, black 24%, black 76%, transparent)',
            }}
          >
            <div
              ref={tapeRef}
              className="absolute left-0 top-0 h-full will-change-transform"
              style={{ transform: `translate3d(${tapeOffset(0)}px, 0, 0)` }}
            >
              {TAPE_TICKS.map((deg) => {
                const label = tapeLabel(deg);
                return (
                  <span
                    key={deg}
                    className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                    style={{ left: (deg - TAPE_MIN_DEG) * TAPE_PX_PER_DEG }}
                  >
                    <span className={`w-px bg-white/60 ${label ? 'h-2.5' : 'h-1.5'}`} />
                    {label && <span className="mt-0.5 font-mono text-[10px] leading-none text-white/85">{label}</span>}
                  </span>
                );
              })}
            </div>
          </div>
          <span className="absolute left-1/2 top-0 h-3.5 w-px -translate-x-1/2 bg-[color:var(--ascent-warm)]" />
        </div>
        <p className="ascent-hud ascent-shadow mt-1.5 text-white/90">
          Hdg <span ref={headingRef} className="text-white">000</span>°
        </p>
        <p
          className={`ascent-hud ascent-glass mt-2 rounded-full px-3 py-1 text-[10px] ${
            handDetected ? 'text-white/80' : 'ascent-breathe text-[color:var(--ascent-fault)]'
          }`}
          // Inline, because .ascent-glass (unlayered CSS) outranks a Tailwind border utility.
          style={handDetected ? undefined : { borderColor: 'rgba(255, 149, 128, 0.6)' }}
        >
          {keyboard
            ? 'WASD / arrows steer · Space boost · F flip'
            : handDetected
              ? 'Tilt your palm to glide'
              : 'Show your hand to the camera to steer'}
        </p>
        {/* Near-miss coaching: an upward flick that almost made a backflip. Re-keyed per hint so
            each one flickers in again. */}
        {flickHint && (
          <div
            key={flickHint.id}
            className="ascent-blip ascent-glass-strong mt-3 flex flex-col items-center rounded-2xl px-5 pb-2.5 pt-2"
            // Inline, because .ascent-glass-strong (unlayered CSS) fixes the border color.
            style={{ borderColor: 'rgba(255, 179, 122, 0.55)' }}
            role="status"
          >
            <p className="font-display text-3xl leading-none text-[color:var(--ascent-warm)]">
              {FLICK_HINT_TEXT[flickHint.kind].main}
            </p>
            <p className="ascent-hud mt-1.5 text-[10px] text-white/85">{FLICK_HINT_TEXT[flickHint.kind].sub}</p>
          </div>
        )}
      </div>

      {/* ---- Top left: Ring Challenge score ---- */}
      {ringChallenge && (
        <div data-flight-hud className="ascent-shadow pointer-events-none absolute left-6 top-6 sm:left-8">
          <p className="ascent-hud text-[color:var(--ascent-cyan)]">Rings</p>
          <p className="font-display text-6xl leading-none tabular-nums" aria-label={`Score ${score}`}>
            <span key={score} className="ascent-score-pop inline-block">
              {score}
            </span>
          </p>
          <p className="ascent-hud mt-1 text-[10px] text-white/70">Best {bestScore}</p>
          {/* Distance to the next ring, marked in its highlight color (the arrow's color too). */}
          <p className="ascent-hud mt-3 flex items-center gap-2 text-white/80" data-next-ring-readout>
            <span
              className="h-2 w-2 rotate-45 rounded-[1px]"
              style={{ background: ringHighlight.color, boxShadow: `0 0 8px ${ringHighlight.color}` }}
              aria-hidden="true"
            />
            Next ring
            <span className="font-mono text-[13px] tabular-nums text-white">
              <span ref={nextRingRef}>—</span> m
            </span>
          </p>
        </div>
      )}

      {/* ---- Top right: guide, pause, stop ---- */}
      <div data-flight-hud className="absolute right-6 top-6 flex items-center gap-2 sm:right-8">
        <button
          type="button"
          onClick={blurAfter(onGuide)}
          aria-label="How to fly"
          title="How to fly (?)"
          className="ascent-hud ascent-glass flex h-9 w-9 items-center justify-center rounded-full text-[13px] text-white/90 transition-colors hover:bg-white/15"
        >
          ?
        </button>
        <button
          type="button"
          onClick={blurAfter(onPause)}
          title="Pause (Esc)"
          className="ascent-hud ascent-glass flex items-center gap-2 rounded-full px-4 py-2 text-white/90 transition-colors hover:bg-white/15"
        >
          <Pause className="h-3.5 w-3.5" />
          Pause
          <span className="text-white/45">Esc</span>
        </button>
        <button
          type="button"
          onClick={blurAfter(onStop)}
          className="ascent-hud ascent-glass flex items-center gap-2 rounded-full px-4 py-2 text-white/90 transition-colors hover:bg-white/15"
        >
          <X className="h-3.5 w-3.5" />
          Stop Game
        </button>
      </div>

      {/* ---- Bottom left: speed + altitude ---- */}
      <div data-flight-hud className="ascent-shadow pointer-events-none absolute bottom-6 left-6 flex gap-8 sm:bottom-8 sm:left-8" aria-hidden="true">
        <div>
          <p className="ascent-hud text-white/70">Spd</p>
          <p className="flex items-baseline gap-1.5">
            <span
              ref={speedRef}
              className={`font-mono text-3xl font-medium tabular-nums tracking-tight transition-colors ${
                boosting ? 'text-[color:var(--ascent-warm)]' : 'text-white'
              }`}
            >
              017
            </span>
            <span className="ascent-hud text-white/70">kt</span>
          </p>
        </div>
        <div>
          <p className="ascent-hud text-[color:var(--ascent-cyan)]">Alt</p>
          <p className="flex items-baseline gap-1.5">
            <span ref={altitudeRef} className="font-mono text-3xl font-medium tabular-nums tracking-tight text-white">
              026
            </span>
            <span className="ascent-hud text-white/70">m</span>
          </p>
        </div>
      </div>

      {/* ---- Bottom center: trick badges. They snap on and off like annunciator lights (no color
          transition), so a 0.8 s barrel roll reads instantly. ---- */}
      <div data-flight-hud className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2 sm:bottom-8">
        {badges.map((badge) => (
          <span
            key={badge.key}
            className={`ascent-hud flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[10px] ${
              badge.active
                ? badge.cool
                  ? 'border-[color:var(--ascent-cyan)] bg-[color:var(--ascent-cyan)] text-[color:var(--ascent-ink)] shadow-[0_0_18px_rgba(159,243,228,0.5)]'
                  : 'border-[color:var(--ascent-warm)] bg-[color:var(--ascent-warm)] text-[color:var(--ascent-ink)] shadow-[0_0_18px_rgba(255,179,122,0.55)]'
                : 'border-white/25 bg-[#06101f]/30 text-white/60'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${badge.active ? 'bg-[color:var(--ascent-ink)]' : 'bg-white/35'}`} />
            {badge.label}
          </span>
        ))}
      </div>

      {/* ---- Bottom right: sensor feed (hand) or input indicator (keyboard), + status ---- */}
      <div data-flight-hud className="absolute bottom-6 right-6 flex flex-col items-end gap-1.5 sm:bottom-8 sm:right-8">
        {keyboard ? (
          <div
            className="relative overflow-hidden rounded-md border border-white/20 bg-black/40 shadow-lg"
            style={{ width: previewWidth, height: previewHeight }}
            aria-hidden="true"
          >
            {/* Full-deflection box and center cross; the dot is the live pitch/roll input. */}
            <span
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-dashed border-white/25"
              style={{ width: STICK_RANGE_X * 2, height: STICK_RANGE_Y * 2 }}
            />
            <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 bg-[color:var(--ascent-cyan)]/70" />
            <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-[color:var(--ascent-cyan)]/70" />
            <span className="absolute left-1/2 top-1/2 -ml-[5px] -mt-[5px] block h-2.5 w-2.5">
              <span
                ref={stickRef}
                className="block h-2.5 w-2.5 rounded-full bg-[color:var(--ascent-warm)] shadow-[0_0_10px_rgba(255,179,122,0.8)] will-change-transform"
              />
            </span>
            <div className="ascent-scanlines pointer-events-none absolute inset-0" />
            <CornerBrackets size={10} inset={5} className="text-white/70" />
            <span className="ascent-hud pointer-events-none absolute left-2.5 top-2 flex items-center gap-1.5 text-[9px] text-white/85">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--ascent-cyan)]" />
              Input · Keys
            </span>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-md border border-white/20 bg-black/40 shadow-lg">
            <canvas ref={previewCanvasRef} width={previewWidth} height={previewHeight} className="block scale-x-[-1]" />
            <div className="ascent-scanlines pointer-events-none absolute inset-0" />
            <CornerBrackets size={10} inset={5} className="text-white/70" />
            <span className="ascent-hud pointer-events-none absolute left-2.5 top-2 flex items-center gap-1.5 text-[9px] text-white/85">
              <span
                className={`h-1.5 w-1.5 rounded-full ${handDetected ? 'bg-[color:var(--ascent-cyan)]' : 'bg-[color:var(--ascent-fault)]'}`}
              />
              Cam 01
            </span>
          </div>
        )}
        <p className="ascent-hud ascent-glass rounded-sm px-2.5 py-1 text-[10px] text-white/90">
          <span className="text-white/50">Status</span> {statusText}
        </p>
      </div>
    </div>
  );
}
