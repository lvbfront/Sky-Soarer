import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { ArrowRight, Check, ChevronLeft, Crosshair, RotateCcw } from 'lucide-react';
import { MAX_SENSITIVITY, MIN_SENSITIVITY } from '@/game/trackingShared';
import { CornerBrackets } from '@/ui/hud';
import { CALIBRATION_STEPS } from './handPreview';

type CanvasPointerHandler = (event: ReactPointerEvent<HTMLCanvasElement>) => void;

interface CalibrationPanelProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  handDetected: boolean;
  /** Index of the step being captured; CALIBRATION_STEPS.length once all five are captured. */
  step: number;
  sensitivity: number;
  /** The camera's actual resolution, e.g. "480×360", once known. */
  feedResolution: string | null;
  /** True while the takeoff transition runs: every control is locked. */
  launching: boolean;
  onCapture: () => void;
  onReset: () => void;
  onSensitivityChange: (value: number) => void;
  onStartFlying: () => void;
  onBack: () => void;
  onCanvasPointerDown: CanvasPointerHandler;
  onCanvasPointerMove: CanvasPointerHandler;
  onCanvasPointerUp: CanvasPointerHandler;
}

function sensitivityLabel(value: number) {
  if (value < 0.85) return 'Low';
  if (value > 1.4) return 'High';
  return 'Medium';
}

const SENSITIVITY_TICKS = [0.5, 1, 1.5, 2];

/** Pre-flight step 2: the sensor feed with target reticles, the capture checklist, and sensitivity. */
export function CalibrationPanel({
  canvasRef,
  canvasWidth,
  canvasHeight,
  handDetected,
  step,
  sensitivity,
  feedResolution,
  launching,
  onCapture,
  onReset,
  onSensitivityChange,
  onStartFlying,
  onBack,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
}: CalibrationPanelProps) {
  const complete = step >= CALIBRATION_STEPS.length;
  const current = CALIBRATION_STEPS[step] ?? null;
  const fill = ((sensitivity - MIN_SENSITIVITY) / (MAX_SENSITIVITY - MIN_SENSITIVITY)) * 100;

  return (
    <div
      data-calibration-panel
      data-takeoff-lift
      className="ascent-glass-strong relative grid w-full max-w-5xl gap-8 rounded-[28px] p-6 text-white shadow-2xl sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      {/* ---- Sensor feed ---- */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={onBack}
          disabled={launching}
          className="ascent-hud mb-4 flex items-center gap-1 text-white/70 transition-colors hover:text-white disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <figure>
          <div className="ascent-hud mb-2 flex items-center justify-between gap-3 text-[10px] text-white/65">
            <span className="flex items-center gap-2">
              <span className="ascent-breathe h-1.5 w-1.5 rounded-full bg-[color:var(--ascent-fault)]" aria-hidden="true" />
              <span className="text-white/90">Live</span>
              <span className="text-white/35">·</span>
              Sensor feed · Cam 01
            </span>
            <span>
              {feedResolution ?? '—'} <span className="text-white/35">·</span> Mirrored
            </span>
          </div>

          <div className="relative overflow-hidden rounded-lg border border-white/15 bg-black/50">
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              className="block w-full cursor-crosshair scale-x-[-1] touch-none"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
            />
            <div className="ascent-scanlines pointer-events-none absolute inset-0" />
            <CornerBrackets size={18} inset={10} className="text-white/70" />
            <span
              className={`ascent-hud pointer-events-none absolute bottom-4 left-4 rounded-sm px-2 py-1 text-[10px] ${
                handDetected
                  ? 'bg-[color:var(--ascent-cyan)]/15 text-[color:var(--ascent-cyan)]'
                  : 'bg-[#ff6b4a]/15 text-[color:var(--ascent-fault)]'
              }`}
            >
              {handDetected ? 'Hand lock' : 'No signal'}
            </span>
            {current && (
              <span className="ascent-hud pointer-events-none absolute right-4 top-4 rounded-sm bg-black/35 px-2 py-1 text-[10px] text-white/85">
                Target {current.code}
              </span>
            )}
          </div>

          <figcaption className="mt-3">
            <p className="ascent-hud flex items-center gap-2 text-white/85">
              <span
                className={`h-2 w-2 rounded-full ${handDetected ? 'bg-[color:var(--ascent-cyan)]' : 'bg-white/30'}`}
                aria-hidden="true"
              />
              {handDetected ? 'Hand detected — hold it at the target position.' : 'Show your hand to the camera.'}
            </p>
            <p className="mt-1.5 text-xs text-white/60">
              You can also drag any orange corner reticle directly on the feed to fine-tune it.
            </p>
          </figcaption>
        </figure>
      </div>

      {/* ---- Instrument column ---- */}
      <div className="flex min-w-0 flex-col">
        <p className="ascent-hud mb-3 flex items-center gap-3 text-[color:var(--ascent-cyan)]">
          <span>Pre-flight</span>
          <span className="h-px w-8 bg-current opacity-60" />
          <span>02 / 02</span>
          <span className="opacity-60">·</span>
          <span className="text-white/80">Calibration</span>
        </p>
        <h1 className="font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none">Calibrate your controls</h1>

        <ol className="mt-5 divide-y divide-white/10 border-y border-white/10" aria-label="Calibration steps">
          {CALIBRATION_STEPS.map((item, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <li
                key={item.key}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-3 border-l-2 px-3 py-2 ${
                  active ? 'border-[color:var(--ascent-warm)] bg-white/[0.06]' : 'border-transparent'
                }`}
              >
                <span className="ascent-hud w-5 text-[10px] text-white/40">{String(index + 1).padStart(2, '0')}</span>
                <span
                  className={`ascent-hud flex h-6 w-8 items-center justify-center rounded-sm border text-[10px] ${
                    done
                      ? 'border-[color:var(--ascent-cyan)]/60 text-[color:var(--ascent-cyan)]'
                      : active
                        ? 'border-[color:var(--ascent-warm)] text-[color:var(--ascent-warm)]'
                        : 'border-white/20 text-white/45'
                  }`}
                >
                  {item.code}
                </span>
                <span className={`flex-1 truncate text-sm ${done || active ? 'text-white' : 'text-white/50'}`}>{item.name}</span>
                <span
                  className={`ascent-hud flex items-center gap-1 text-[10px] ${
                    done ? 'text-[color:var(--ascent-cyan)]' : active ? 'text-[color:var(--ascent-warm)]' : 'text-white/35'
                  }`}
                >
                  {done ? (
                    <>
                      <Check className="h-3 w-3" /> Locked
                    </>
                  ) : active ? (
                    <span className="ascent-breathe">Acquire</span>
                  ) : (
                    'Standby'
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 min-h-[5.5rem]" aria-live="polite">
          {current ? (
            <>
              <p className="ascent-hud text-[10px] text-white/55">
                Step {step + 1} of {CALIBRATION_STEPS.length}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/80">{current.instruction}</p>
            </>
          ) : (
            <>
              <p className="ascent-hud text-[color:var(--ascent-cyan)]">Calibrated! Your control range is set.</p>
              <p className="mt-1 text-sm leading-relaxed text-white/75">
                Flight pitch and roll are now mapped to fit exactly within the box you just drew.
              </p>
            </>
          )}
        </div>

        {!complete && (
          <button
            type="button"
            onClick={onCapture}
            disabled={!handDetected || launching}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Crosshair className="h-4 w-4" />
            {current?.buttonLabel}
          </button>
        )}

        {step > 0 ? (
          <button
            type="button"
            onClick={onReset}
            disabled={launching}
            className="ascent-hud mt-3 flex items-center justify-center gap-1.5 self-center text-white/65 transition-colors hover:text-white disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Start Over
          </button>
        ) : (
          <div className="mt-3 h-4" />
        )}

        <div className="mb-6 mt-6">
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="steering-sensitivity" className="ascent-hud text-white/65">
              Steering sensitivity
            </label>
            <p className="ascent-hud text-white">
              {sensitivityLabel(sensitivity)}{' '}
              <span className="font-mono text-base tabular-nums text-[color:var(--ascent-warm)]">
                {sensitivity.toFixed(1)}x
              </span>
            </p>
          </div>
          <input
            id="steering-sensitivity"
            type="range"
            min={MIN_SENSITIVITY}
            max={MAX_SENSITIVITY}
            step={0.1}
            value={sensitivity}
            disabled={launching}
            onChange={(event) => onSensitivityChange(Number(event.target.value))}
            className="ascent-range"
            style={{ ['--fill' as string]: `${fill}%` }}
          />
          <div className="relative mx-2 mt-1 h-3" aria-hidden="true">
            {SENSITIVITY_TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute top-0 h-1.5 w-px bg-white/35"
                style={{ left: `${((tick - MIN_SENSITIVITY) / (MAX_SENSITIVITY - MIN_SENSITIVITY)) * 100}%` }}
              />
            ))}
          </div>
          <div className="ascent-hud flex justify-between text-[10px] text-white/55">
            <span>Calm · {MIN_SENSITIVITY.toFixed(1)}x</span>
            <span>Twitchy · {MAX_SENSITIVITY.toFixed(1)}x</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onStartFlying}
          disabled={!complete || launching}
          className="group mt-auto flex w-full items-center justify-between rounded-full bg-white py-2 pl-6 pr-2 text-[color:var(--ascent-ink)] transition-colors hover:bg-[color:var(--ascent-warm)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white"
        >
          <span className="text-left">
            <span className="block text-base font-semibold">Start Flying</span>
            <span className="ascent-hud block text-[10px] opacity-60">
              {complete ? 'Cleared for takeoff' : `${step} / ${CALIBRATION_STEPS.length} points locked`}
            </span>
          </span>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--ascent-ink)] text-white">
            <ArrowRight className="h-4 w-4" />
          </span>
        </button>
      </div>
    </div>
  );
}
