// The flight model's pure maths: the coordinated-turn rate, the critically damped springs that
// smooth bank, yaw rate and the camera, steering-setting scaling, the hand expo curve and the air
// brake's speeds. No three.js or DOM, so GameEngine, the inputs and the unit tests share it. Every
// constant lives in flightTuning.ts.
import {
  AIR_BRAKE_SPEED_FRACTION,
  AIR_BRAKE_TURN_FACTOR,
  BANK_RESPONSE,
  MAX_YAW_ACCEL_DEG,
  YAW_RATE_RESPONSE,
  CRUISE_TURN_RATE_DEG,
  HAND_EXPO,
  MAX_PITCH_DEG,
  MAX_SENSITIVITY,
  MAX_YAW_RATE_DEG,
  MIN_FLYING_SPEED,
  MIN_SENSITIVITY,
  SPRING_63,
  TURN_BANK_MAX,
  TURN_MIN_SPEED,
  TURN_REF_SPEED,
  UNDERWATER_BASE_SPEED,
  VISUAL_BANK_AIR_DEG,
  VISUAL_BANK_LIMIT_DEG,
  VISUAL_BANK_WATER_DEG,
  WATER_BRAKE_SPEED_FRACTION,
  WATER_BRAKE_TURN_FACTOR,
  deg,
} from './flightTuning';

export type Medium = 'air' | 'water';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Clamps a sensitivity to the slider's range (NaN falls back to 1). */
export function clampSensitivity(sensitivity: number) {
  return Number.isFinite(sensitivity) ? clamp(sensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY) : 1;
}

/** Turn authority for a sensitivity: √s, so 0.5x → 0.71, 1x → 1, 2x → 1.41. */
export function turnAuthority(sensitivity: number) {
  return Math.sqrt(clampSensitivity(sensitivity));
}

// Gain so that full input at cruise turns at CRUISE_TURN_RATE_DEG: rate = GAIN·tan(bank)/√(v/vRef).
const TURN_GAIN = deg(CRUISE_TURN_RATE_DEG) / Math.tan(TURN_BANK_MAX);
const MAX_YAW_RATE = deg(MAX_YAW_RATE_DEG);

/**
 * Steady-state yaw rate (rad/s, positive = turning right) for a smoothed bank input of −1..1 at
 * `speed` m/s: a coordinated turn, tan(bank) over a softened speed term (see flightTuning.ts), times
 * the sensitivity's turn authority and the medium's brake factor, clamped to MAX_YAW_RATE_DEG.
 */
export function turnRate(bankInput: number, speed: number, medium: Medium, braking: boolean, sensitivity: number) {
  const input = clamp(bankInput, -1, 1);
  if (input === 0) return 0;
  const tanBank = Math.tan(Math.abs(input) * TURN_BANK_MAX);
  const speedTerm = Math.sqrt(Math.max(speed, TURN_MIN_SPEED) / TURN_REF_SPEED);
  const brakeFactor = braking ? (medium === 'air' ? AIR_BRAKE_TURN_FACTOR : WATER_BRAKE_TURN_FACTOR) : 1;
  const rate = (TURN_GAIN * tanBank * turnAuthority(sensitivity) * brakeFactor) / speedTerm;
  return Math.sign(input) * Math.min(rate, MAX_YAW_RATE);
}

/**
 * The bird's visual bank angle (radians) for a bank input: consistent with the turn model, the
 * sensitivity scales tan(bank), so 60° at default becomes ~51° at 0.5x and ~68° at 2x (capped).
 * Swimming banks less (~40°) and yaws its body into the turn instead.
 */
export function visualBank(bankInput: number, medium: Medium, sensitivity: number) {
  const max = deg(medium === 'air' ? VISUAL_BANK_AIR_DEG : VISUAL_BANK_WATER_DEG);
  const scaled = Math.min(Math.atan(Math.tan(max) * turnAuthority(sensitivity)), deg(VISUAL_BANK_LIMIT_DEG));
  return clamp(bankInput, -1, 1) * scaled;
}

/** Pitch angle (radians) at full climb/dive input for a sensitivity: 38° × s^¼ (32°–45°). */
export function maxPitchAngle(sensitivity: number) {
  return deg(MAX_PITCH_DEG) * Math.pow(clampSensitivity(sensitivity), 0.25);
}

/** Hand-mode expo: gentle near the center, the sharp end in the last part of the travel. */
export function expoCurve(value: number, expo = HAND_EXPO) {
  const v = clamp(value, -1, 1);
  return (1 - expo) * v + expo * v * v * v;
}

/** Target speed while the brake is held: half of cruise in the air (never below the stall guard). */
export function brakeSpeed(medium: Medium, cruiseSpeed: number) {
  if (medium === 'water') return UNDERWATER_BASE_SPEED * WATER_BRAKE_SPEED_FRACTION;
  return Math.max(MIN_FLYING_SPEED, cruiseSpeed * AIR_BRAKE_SPEED_FRACTION);
}

/** ω for a critically damped spring that covers 63% of a step in `response` seconds. */
export function springOmega(response: number) {
  return SPRING_63 / response;
}

/** A 1-D critically damped spring's state. */
export interface Spring {
  value: number;
  velocity: number;
}

export function createSpring(value = 0): Spring {
  return { value, velocity: 0 };
}

/**
 * Advances a critically damped spring (ζ = 1) toward `target` by `dt`, exactly (the closed-form
 * solution, not an Euler step), so it's stable and frame-rate independent at any dt. Starting from
 * rest it reaches the target without ever overshooting it. A spring already moving toward the
 * target faster than ω × the distance would overshoot; with `guard` it stops at the target instead
 * (the bank and yaw rate use this, so rolling out never swings past level).
 */
export function stepSpring(spring: Spring, target: number, omega: number, dt: number, guard = false) {
  if (dt <= 0) return spring.value;
  const x0 = spring.value - target;
  const c2 = spring.velocity + omega * x0;
  const decay = Math.exp(-omega * dt);
  spring.value = target + (x0 + c2 * dt) * decay;
  spring.velocity = (c2 - omega * (x0 + c2 * dt)) * decay;
  if (guard && x0 !== 0 && Math.sign(spring.value - target) === -Math.sign(x0)) {
    spring.value = target;
    spring.velocity = 0;
  }
  return spring.value;
}

/**
 * A critically damped spring whose rate of change is capped at `maxRate` (units per second): the
 * yaw rate uses it so turns ease in and out at no more than MAX_YAW_ACCEL_DEG. While the cap
 * holds, the value moves at exactly the cap; arriving at the cap's speed, the guard stops it at the
 * target, so it never overshoots.
 */
export function stepLimitedSpring(spring: Spring, target: number, omega: number, maxRate: number, dt: number) {
  if (dt <= 0) return spring.value;
  const before = spring.value;
  stepSpring(spring, target, omega, dt, true);
  const maxStep = maxRate * dt;
  const step = spring.value - before;
  if (Math.abs(step) > maxStep) {
    spring.value = before + Math.sign(step) * maxStep;
    spring.velocity = Math.sign(step) * Math.min(Math.abs(spring.velocity), maxRate);
  }
  return spring.value;
}

/** Wraps an angle to −π..π. */
export function wrapAngle(angle: number) {
  const twoPi = Math.PI * 2;
  let a = (angle + Math.PI) % twoPi;
  if (a < 0) a += twoPi;
  return a - Math.PI;
}

/** Steps a spring on an angle, always taking the short way round to `target`. */
export function stepAngleSpring(spring: Spring, target: number, omega: number, dt: number) {
  const unwrappedTarget = spring.value + wrapAngle(target - spring.value);
  return stepSpring(spring, unwrappedTarget, omega, dt);
}

/**
 * Keyboard axis ramp: moves `value` toward `target` at `up` (pressing), `down` (released) or
 * `reverse` (the other key) units per second, scaled by the sensitivity's turn authority.
 */
export function rampAxis(
  value: number,
  target: number,
  dt: number,
  rates: { up: number; down: number; reverse: number },
  sensitivity: number,
) {
  const authority = turnAuthority(sensitivity);
  let rate = rates.up;
  if (target === 0) rate = rates.down;
  else if (value !== 0 && Math.sign(value) !== Math.sign(target)) rate = rates.reverse;
  const step = rate * authority * dt;
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

/** The turning state: the smoothed bank input (−1..1) and the yaw rate (rad/s, positive = right). */
export interface TurnState {
  bank: Spring;
  yawRate: Spring;
}

export function createTurnState(): TurnState {
  return { bank: createSpring(), yawRate: createSpring() };
}

const BANK_OMEGA = springOmega(BANK_RESPONSE);
const YAW_RATE_OMEGA = springOmega(YAW_RATE_RESPONSE);
const MAX_YAW_ACCEL = deg(MAX_YAW_ACCEL_DEG);

/**
 * One step of turning, exactly as the engine flies it: the bank follows the roll input on a
 * critically damped spring (~0.15 s, no overshoot), the coordinated-turn rate follows the bank,
 * and the yaw rate follows that on a faster spring whose acceleration is capped (turns ease in and
 * out). `locked` (the barrel roll) holds the heading: zero yaw rate. Returns the yaw rate.
 */
export function stepTurn(
  state: TurnState,
  rollInput: number,
  speed: number,
  medium: Medium,
  braking: boolean,
  sensitivity: number,
  dt: number,
  locked = false,
) {
  stepSpring(state.bank, rollInput, BANK_OMEGA, dt, true);
  if (locked) {
    state.yawRate.value = 0;
    state.yawRate.velocity = 0;
    return 0;
  }
  const target = turnRate(state.bank.value, speed, medium, braking, sensitivity);
  return stepLimitedSpring(state.yawRate, target, YAW_RATE_OMEGA, MAX_YAW_ACCEL, dt);
}
