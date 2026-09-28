import type { HandControlState } from './handControls';

// Keyboard flight controls. They produce the same HandControlState the hand tracker does, so the
// engine never knows which input is driving it. W/S and the up/down arrows pitch (W climbs, like
// raising your palm), A/D and left/right bank, Space holds boost (the barrel roll fires as it
// starts, exactly like closing a fist), and F is the backflip.

// Held keys ramp the axis toward full deflection instead of snapping, and a released key eases it
// back to level, so keyboard steering feels analog. Rates are in axis units per second, so the
// feel is the same at any frame rate: ~0.35 s to reach full bank, ~0.25 s to settle back to level.
export const RAMP_UP_PER_SEC = 2.8;
const RAMP_DOWN_PER_SEC = 4;
// Pressing the opposite key reverses faster than a plain release, so quick corrections feel crisp.
const REVERSE_PER_SEC = 6;

const PITCH_UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const PITCH_DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);
const ROLL_LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const ROLL_RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const BOOST_KEYS = new Set(['Space']);
const BACKFLIP_KEYS = new Set(['KeyF']);

const HANDLED_KEYS = new Set([
  ...PITCH_UP_KEYS,
  ...PITCH_DOWN_KEYS,
  ...ROLL_LEFT_KEYS,
  ...ROLL_RIGHT_KEYS,
  ...BOOST_KEYS,
  ...BACKFLIP_KEYS,
]);

function anyHeld(held: Set<string>, keys: Set<string>) {
  for (const key of keys) if (held.has(key)) return true;
  return false;
}

/** Moves `value` toward `target` by at most `maxStep`. */
function approach(value: number, target: number, maxStep: number) {
  if (value < target) return Math.min(target, value + maxStep);
  return Math.max(target, value - maxStep);
}

function axisRate(value: number, target: number) {
  if (target === 0) return RAMP_DOWN_PER_SEC;
  // Target on the other side of zero: the player is reversing.
  if (value !== 0 && Math.sign(value) !== Math.sign(target)) return REVERSE_PER_SEC;
  return RAMP_UP_PER_SEC;
}

export class KeyboardControls {
  private onUpdate: (state: HandControlState) => void;
  private held = new Set<string>();
  private pitch = 0;
  private roll = 0;
  private backflipQueued = false;
  private paused = false;
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private lastEmitted: HandControlState | null = null;

  constructor(onUpdate: (state: HandControlState) => void) {
    this.onUpdate = onUpdate;
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
    this.pitch = approach(this.pitch, pitchTarget, axisRate(this.pitch, pitchTarget) * dt);
    this.roll = approach(this.roll, rollTarget, axisRate(this.roll, rollTarget) * dt);
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
      flickNearMiss: null,
      landmarks: null,
    };
    const last = this.lastEmitted;
    const unchanged =
      last !== null &&
      !backflip &&
      last.pitch === state.pitch &&
      last.roll === state.roll &&
      last.boost === state.boost;
    if (unchanged && !force) return;
    this.lastEmitted = state;
    this.onUpdate(state);
  }
}
