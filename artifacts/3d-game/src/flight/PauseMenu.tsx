import { useId, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { BookOpen, ChevronLeft, Crosshair, Play } from 'lucide-react';
import { CornerBrackets } from '@/ui/hud';
import { QUALITY_SETTINGS, type QualityLevel, type QualitySetting } from '@/game/quality';
import type { ControlMode, SteeringSettings } from '@/game/settings';
import { SteeringControls } from '@/ui/SteeringControls';

const QUALITY_LABELS: Record<QualitySetting, string> = { auto: 'Auto', high: 'High', low: 'Low' };

interface PauseMenuProps {
  /** "Pigeon · Mountain Valley · Sunny Morning" */
  summary: string;
  /** Ring Challenge score, or null when rings are off. */
  score: number | null;
  reducedMotion: boolean;
  /** Graphics quality setting, and the level actually rendered (Auto resolves to one). */
  quality: QualitySetting;
  renderedQuality: QualityLevel | null;
  onQualityChange: (quality: QualitySetting) => void;
  /** Steering settings (both control modes); changes apply to the flight at once. */
  steering: SteeringSettings;
  controlMode: ControlMode;
  onSteeringChange: (patch: Partial<SteeringSettings>) => void;
  onResume: () => void;
  onGuide: () => void;
  /** Hand mode: back to the calibration screen (keeps the camera), then take off again. */
  onRecalibrate?: () => void;
  onExit: () => void;
}

/**
 * The pause menu, in the flight HUD's instrument style. The game loop is frozen while it's open
 * (App pauses the engine and the keyboard input). Esc is handled by App.
 */
export function PauseMenu({
  summary,
  score,
  reducedMotion,
  quality,
  renderedQuality,
  onQualityChange,
  steering,
  controlMode,
  onSteeringChange,
  onResume,
  onGuide,
  onRecalibrate,
  onExit,
}: PauseMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resumeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const qualityId = useId();

  useLayoutEffect(() => {
    resumeRef.current?.focus({ preventScroll: true });
    const root = rootRef.current;
    if (!root || reducedMotion) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline()
        .fromTo('[data-pause-scrim]', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none' })
        .fromTo('[data-pause-panel]', { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' }, 0);
    }, root);
    return () => ctx.revert();
    // A one-shot entrance on mount.
  }, []);

  const secondary =
    'ascent-hud ascent-glass flex w-full items-center gap-3 rounded-full px-5 py-3 text-left text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[35] overflow-y-auto text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div data-pause-scrim className="pointer-events-none fixed inset-0 bg-[#06101f]/50" />
      <div className="ascent-grain pointer-events-none fixed inset-0" />
      {/* A min-h-full flex box rather than an items-center scroller, so a short window scrolls the
          panel instead of cutting its top off. */}
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <section data-pause-panel className="ascent-glass-strong relative w-full max-w-sm rounded-[24px] p-6 shadow-2xl sm:p-7">
          <CornerBrackets size={14} inset={9} className="text-white/35" />
          <p className="ascent-hud flex items-center gap-2.5 text-[color:var(--ascent-cyan)]">
            <span className="ascent-breathe h-1.5 w-1.5 rounded-full bg-[color:var(--ascent-warm)]" aria-hidden="true" />
            Flight paused
          </p>
          <h2 id={titleId} className="mt-2 font-display text-5xl leading-none tracking-[-0.015em]">
            Holding pattern
          </h2>
          <p className="ascent-hud mt-3 text-[10px] leading-relaxed text-white/60">
            {summary}
            {score !== null && (
              <>
                <span className="mx-1.5 text-white/35">·</span>
                <span className="text-white/85">Rings {score}</span>
              </>
            )}
          </p>

          <div className="mt-6 space-y-2.5">
            <button
              ref={resumeRef}
              type="button"
              onClick={onResume}
              className="group flex w-full items-center justify-between rounded-full bg-white py-2 pl-5 pr-2 text-[color:var(--ascent-ink)] transition-colors hover:bg-[color:var(--ascent-warm)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              <span className="flex items-center gap-3 text-base font-semibold">
                <Play className="h-4 w-4 fill-current" />
                Resume
              </span>
              <kbd className="ascent-hud rounded-full bg-[color:var(--ascent-ink)] px-3 py-2 text-[10px] text-white">Esc</kbd>
            </button>
            <button type="button" onClick={onGuide} className={secondary}>
              <BookOpen className="h-4 w-4 text-[color:var(--ascent-cyan)]" />
              How to fly
            </button>
            {onRecalibrate && (
              <button type="button" onClick={onRecalibrate} className={secondary}>
                <Crosshair className="h-4 w-4 text-[color:var(--ascent-warm)]" />
                Recalibrate
              </button>
            )}
            <button type="button" onClick={onExit} className={secondary}>
              <ChevronLeft className="h-4 w-4 text-white/70" />
              Back to landing
            </button>
          </div>

          {/* Steering: the same settings in both control modes, applied live. */}
          <div className="mt-6">
            <p className="ascent-hud mb-2 text-white/60">Steering</p>
            <SteeringControls steering={steering} mode={controlMode} onChange={onSteeringChange} compact />
          </div>

          {/* Graphics quality: Auto drops to Low by itself when the frame rate stays under ~50 FPS. */}
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <p id={qualityId} className="ascent-hud text-white/60">
                Graphics
              </p>
              {quality === 'auto' && renderedQuality && (
                <p className="ascent-hud text-white/45" style={{ fontSize: 10 }}>
                  Auto · {QUALITY_LABELS[renderedQuality]}
                </p>
              )}
            </div>
            <div role="radiogroup" aria-labelledby={qualityId} className="ascent-glass mt-2 grid grid-cols-3 gap-1 rounded-full p-1">
              {QUALITY_SETTINGS.map((option) => {
                const selected = option === quality;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onQualityChange(option)}
                    className={`ascent-hud rounded-full py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      selected ? 'bg-white text-[color:var(--ascent-ink)]' : 'text-white/80 hover:bg-white/15'
                    }`}
                  >
                    {QUALITY_LABELS[option]}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
