import { useId } from 'react';
import { CRUISE_TURN_RATE_DEG, MAX_SENSITIVITY, MIN_SENSITIVITY } from '@/game/flightTuning';
import { turnAuthority } from '@/game/flightModel';
import type { ControlMode, SteeringSettings } from '@/game/settings';

/** "Gentle" / "Medium" / "Sharp", for the sensitivity readout. */
export function sensitivityLabel(value: number) {
  if (value < 0.85) return 'Gentle';
  if (value > 1.4) return 'Sharp';
  return 'Medium';
}

interface SteeringControlsProps {
  steering: SteeringSettings;
  mode: ControlMode;
  onChange: (patch: Partial<SteeringSettings>) => void;
  /** Tighter spacing for the pause menu. */
  compact?: boolean;
}

/**
 * The steering settings, shared by both control modes: sensitivity (turn authority, and how fast
 * the keys ramp in keyboard mode) and invert climb/dive. Shown on the landing's last chapter and in
 * the pause menu (where changes apply to the flight at once); the hand calibration screen has its
 * own copy of the sensitivity slider bound to the same value.
 */
export function SteeringControls({ steering, mode, onChange, compact = false }: SteeringControlsProps) {
  const sliderId = useId();
  const invertId = useId();
  const fill = ((steering.sensitivity - MIN_SENSITIVITY) / (MAX_SENSITIVITY - MIN_SENSITIVITY)) * 100;
  const turnRate = Math.round(CRUISE_TURN_RATE_DEG * turnAuthority(steering.sensitivity));
  return (
    <div className={compact ? 'space-y-3' : 'space-y-3.5'} data-steering-controls>
      <div>
        <div className="mb-0.5 flex items-baseline justify-between gap-3">
          <label htmlFor={sliderId} className="ascent-hud text-white/60">
            Sensitivity
          </label>
          <p className="ascent-hud text-white/85">
            {sensitivityLabel(steering.sensitivity)}{' '}
            <span className="font-mono text-[13px] tabular-nums text-[color:var(--ascent-warm)]">
              {steering.sensitivity.toFixed(1)}x
            </span>
          </p>
        </div>
        <input
          id={sliderId}
          type="range"
          min={MIN_SENSITIVITY}
          max={MAX_SENSITIVITY}
          step={0.1}
          value={steering.sensitivity}
          onChange={(event) => onChange({ sensitivity: Number(event.target.value) })}
          className="ascent-range"
          style={{ ['--fill' as string]: `${fill}%` }}
          aria-describedby={`${sliderId}-hint`}
        />
        <p id={`${sliderId}-hint`} className="ascent-hud mt-0.5 text-white/45" style={{ fontSize: 10 }}>
          Full turn {turnRate}°/s at cruise{mode === 'keyboard' ? ' · also how fast keys ramp in' : ''}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={invertId} className="min-w-0">
          <span className="ascent-hud block text-white/60">Invert climb / dive</span>
          <span className="ascent-hud block text-white/45" style={{ fontSize: 10 }}>
            {mode === 'keyboard' ? (steering.invertPitch ? 'W dives · S climbs' : 'W climbs · S dives') : steering.invertPitch ? 'Palm up dives' : 'Palm up climbs'}
          </span>
        </label>
        <button
          id={invertId}
          type="button"
          role="switch"
          aria-checked={steering.invertPitch}
          onClick={() => onChange({ invertPitch: !steering.invertPitch })}
          className={`relative h-6 w-11 flex-none rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            steering.invertPitch ? 'bg-[color:var(--ascent-warm)]' : 'bg-white/25'
          }`}
        >
          <span
            className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              steering.invertPitch ? 'translate-x-5' : ''
            }`}
          />
        </button>
      </div>
    </div>
  );
}
