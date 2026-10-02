import type { HandControlState } from './handControls';
import { clampSensitivity, rampAxis } from './flightModel';
import {
  TAKEOFF_KEY_HOLD,
  KEY_PITCH_RAMP_DOWN,
  KEY_PITCH_RAMP_UP,
  KEY_PITCH_REVERSE,
  KEY_ROLL_RAMP_DOWN,
  KEY_ROLL_RAMP_UP,
  KEY_ROLL_REVERSE,
} from './flightTuning';

// Keyboard flight controls. They produce the same HandControlState the hand tracker does, so the
// engine never knows which input is driving it. W/S and the up/down arrows pitch (W climbs, like
// raising your palm), A/D and left/right bank, Space holds boost (the barrel roll fires as it
// starts, exactly like closing a fist), Shift holds the air brake, and F is the backflip.

// Held keys ramp the axis toward full deflection instead of snapping, and a released key eases it
// back to level, so keyboard steering feels analog. The rates (flightTuning.ts) are per second, so
// the feel is the same at any frame rate: ~0.2 s to full bank, ~0.36 s to full climb or dive, and
// the steering sensitivity scales them (√sensitivity). Pressing the opposite key reverses faster
// than a plain release, so quick corrections feel crisp.
const ROLL_RATES = { up: KEY_ROLL_RAMP_UP, down: KEY_ROLL_RAMP_DOWN, reverse: KEY_ROLL_REVERSE };
const PITCH_RATES = { up: KEY_PITCH_RAMP_UP, down: KEY_PITCH_RAMP_DOWN, reverse: KEY_PITCH_REVERSE };

const PITCH_UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const PITCH_DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const ROLL_LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const ROLL_RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const BOOST_KEYS = new Set(['Space']);
const BACKFLIP_KEYS = new Set(['KeyF']);
// Either Shift. No other binding uses Shift, and the handler ignores Ctrl/Alt/Meta combinations.
const BRAKE_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

const HANDLED_KEYS = new Set([
  ...PITCH_UP_KEYS,
  ...PITCH_DOWN_KEYS,
  ...ROLL_LEFT_KEYS,
  ...ROLL_RIGHT_KEYS,
  ...BOOST_KEYS,
  ...BACKFLIP_KEYS,
  ...BRAKE_KEYS,
]);

function anyHeld(held: Set<string>, keys: Set<string>) {
  for (const key of keys) if (held.has(key)) return true;
  return false;
}

export class KeyboardControls {
  private onUpdate: (state: HandControlState) => void;
  private held = new Set<string>();
  private pitch = 0;
  private roll = 0;
  private backflipQueued = false;
  private paused = false;
  private sensitivity = 1;
  // How long Space has been held (seconds): held TAKEOFF_KEY_HOLD while standing or floating takes off.
  private boostHeldFor = 0;
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private lastEmitted: HandControlState | null = null;

  constructor(onUpdate: (state: HandControlState) => void, sensitivity = 1) {
    this.onUpdate = onUpdate;
    this.sensitivity = clampSensitivity(sensitivity);
  }

  /** The steering sensitivity scales how fast held keys ramp to full input (applies live). */
  setSensitivity(sensitivity: number) {
    this.sensitivity = clampSensitivity(sensitivity);
  }

  start() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    // Keys released while the window is unfocused never send a keyup; drop them all so nothing
    // stays latched (steering, or boost) after an alt-tab.
    window.addEventListener('blur', this.releaseAll);
    this.emit(true);
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    this.held.clear();
  }

  /**
   * While paused, keys are ignored (so Space and the arrows work normally in the pause menu and
   * guide) and the controls rest at level cruise. Resuming starts from rest, never from keys that
   * were held when the game paused.
   */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.releaseAll();
  }

  private releaseAll = () => {
    this.held.clear();
    this.pitch = 0;
    this.roll = 0;
    this.boostHeldFor = 0;
    this.backflipQueued = false;
    this.lastTime = null;
    this.emit(true);
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.paused || !HANDLED_KEYS.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    // Stop the page from scrolling, and a focused HUD button from being "clicked" by Space.
    event.preventDefault();
    if (BACKFLIP_KEYS.has(event.code) && !event.repeat) this.backflipQueued = true;
    this.held.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    if (!HANDLED_KEYS.has(event.code)) return;
    // Buttons activate on Space's keyup, so this one has to be cancelled too.
    if (!this.paused) event.preventDefault();
    this.held.delete(event.code);
  };

  private tick = (now: number) => {
    this.rafId = requestAnimationFrame(this.tick);
    if (this.paused) return;
    // Clamped like the engine's own step, so a stalled tab can't jump an axis to full.
    const dt = this.lastTime === null ? 0 : Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    const pitchTarget = (anyHeld(this.held, PITCH_UP_KEYS) ? 1 : 0) - (anyHeld(this.held, PITCH_DOWN_KEYS) ? 1 : 0);
    const rollTarget = (anyHeld(this.held, ROLL_RIGHT_KEYS) ? 1 : 0) - (anyHeld(this.held, ROLL_LEFT_KEYS) ? 1 : 0);
    this.boostHeldFor = anyHeld(this.held, BOOST_KEYS) ? this.boostHeldFor + dt : 0;
    this.pitch = rampAxis(this.pitch, pitchTarget, dt, PITCH_RATES, this.sensitivity);
    this.roll = rampAxis(this.roll, rollTarget, dt, ROLL_RATES, this.sensitivity);
    this.emit(false);
  };

  /** Sends the current state, skipping frames where nothing changed (unless `force`). */
  private emit(force: boolean) {
    const backflip = this.backflipQueued;
    this.backflipQueued = false;
    const state: HandControlState = {
      // Keyboard input is always "present": the engine's hand-lost easing never applies.
      handDetected: true,
      pitch: this.pitch,
      roll: this.roll,
      boost: !this.paused && anyHeld(this.held, BOOST_KEYS),
      backflip,
      brake: !this.paused && anyHeld(this.held, BRAKE_KEYS),
      takeoffHold: !this.paused && this.boostHeldFor >= TAKEOFF_KEY_HOLD,
      flickNearMiss: null,
      landmarks: null,
    };
    const last = this.lastEmitted;
    const unchanged =
      last !== null &&
      !backflip &&
      last.pitch === state.pitch &&
      last.roll === state.roll &&
      last.boost === state.boost &&
      last.brake === state.brake &&
      last.takeoffHold === state.takeoffHold;
    if (unchanged && !force) return;
    this.lastEmitted = state;
    this.onUpdate(state);
  }
}
