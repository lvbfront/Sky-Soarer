import { describe, expect, it } from 'vitest';
import {
  brakeSpeed,
  createSpring,
  createTurnState,
  expoCurve,
  rampAxis,
  stepAngleSpring,
  stepSpring,
  stepTurn,
  turnAuthority,
  turnRate,
  visualBank,
  wrapAngle,
  type Medium,
} from './flightModel';
import {
  KEY_ROLL_RAMP_DOWN,
  KEY_ROLL_RAMP_UP,
  KEY_ROLL_REVERSE,
  MAX_SENSITIVITY,
  MIN_FLYING_SPEED,
  MIN_SENSITIVITY,
  UNDERWATER_BASE_SPEED,
  UNDERWATER_BOOST_SPEED,
} from './flightTuning';
import { BASE_SPEED, BOOST_SPEED } from './presets';

const toDeg = (radians: number) => (radians * 180) / Math.PI;
const ROLL_RATES = { up: KEY_ROLL_RAMP_UP, down: KEY_ROLL_RAMP_DOWN, reverse: KEY_ROLL_REVERSE };

describe('turnRate (full input, default sensitivity)', () => {
  const full = (speed: number, medium: Medium, braking = false) => toDeg(turnRate(1, speed, medium, braking, 1));

  it('hits the per-medium targets', () => {
    expect(full(BASE_SPEED, 'air')).toBeCloseTo(93, 0); // cruise (~90°/s; see flightTuning.ts)
    expect(full(BOOST_SPEED, 'air')).toBeGreaterThan(58);
    expect(full(BOOST_SPEED, 'air')).toBeLessThan(65); // boosting: ~60°/s, fast means wider
    expect(full(brakeSpeed('air', BASE_SPEED), 'air', true)).toBeGreaterThan(132);
    expect(full(brakeSpeed('air', BASE_SPEED), 'air', true)).toBeLessThan(150); // air brake: ~140°/s
    expect(full(UNDERWATER_BASE_SPEED, 'water')).toBeGreaterThan(114);
    expect(full(UNDERWATER_BASE_SPEED, 'water')).toBeLessThan(128); // swimming: ~120°/s
    expect(full(brakeSpeed('water', BASE_SPEED), 'water', true)).toBeGreaterThan(152);
    expect(full(brakeSpeed('water', BASE_SPEED), 'water', true)).toBeLessThan(168); // swim + brake: ~160°/s
  });

  it('turns faster the slower the bird goes, and is symmetric', () => {
    const speeds = [UNDERWATER_BOOST_SPEED, BASE_SPEED, 6, MIN_FLYING_SPEED];
    for (let i = 1; i < speeds.length; i += 1) {
      expect(turnRate(1, speeds[i], 'air', false, 1)).toBeGreaterThan(turnRate(1, speeds[i - 1], 'air', false, 1));
    }
    expect(turnRate(-0.6, BASE_SPEED, 'air', false, 1)).toBeCloseTo(-turnRate(0.6, BASE_SPEED, 'air', false, 1), 10);
    expect(turnRate(0, BASE_SPEED, 'air', false, 1)).toBe(0);
  });

  it('grows like tan(bank): gentle for small inputs, steep near full', () => {
    const at = (input: number) => toDeg(turnRate(input, BASE_SPEED, 'air', false, 1));
    expect(at(0.25)).toBeLessThan(20);
    expect(at(0.5)).toBeLessThan(35);
    expect(at(1) - at(0.7)).toBeGreaterThan(at(1) * 0.45);
  });

  it('scales with the sensitivity setting (turn authority √s)', () => {
    expect(turnAuthority(1)).toBe(1);
    expect(toDeg(turnRate(1, BASE_SPEED, 'air', false, MIN_SENSITIVITY))).toBeCloseTo(93 * Math.SQRT1_2, 0);
    expect(toDeg(turnRate(1, BASE_SPEED, 'air', false, MAX_SENSITIVITY))).toBeCloseTo(93 * Math.SQRT2, 0);
    // Out-of-range or broken values are clamped, never amplified.
    expect(turnAuthority(9)).toBeCloseTo(Math.SQRT2, 10);
    expect(turnAuthority(Number.NaN)).toBe(1);
  });

  it('caps the yaw rate', () => {
    expect(toDeg(turnRate(1, 0.5, 'water', true, MAX_SENSITIVITY))).toBeLessThanOrEqual(200);
  });
});

describe('visual bank', () => {
  it('banks ~60° flying, ~40° swimming at default sensitivity, and never past 70°', () => {
    expect(toDeg(visualBank(1, 'air', 1))).toBeCloseTo(60, 5);
    expect(toDeg(visualBank(-1, 'water', 1))).toBeCloseTo(-40, 5);
    expect(toDeg(visualBank(1, 'air', MAX_SENSITIVITY))).toBeLessThanOrEqual(70);
    expect(toDeg(visualBank(1, 'air', MIN_SENSITIVITY))).toBeLessThan(55);
  });
});

describe('critically damped springs', () => {
  it('settles a step without overshoot, at any frame rate', () => {
    for (const fps of [20, 30, 60, 144]) {
      const spring = createSpring(1);
      let min = 1;
      for (let i = 0; i < fps * 2; i += 1) min = Math.min(min, stepSpring(spring, 0, 14.3, 1 / fps));
      expect(min).toBeGreaterThanOrEqual(0);
      expect(spring.value).toBeLessThan(1e-3);
    }
  });

  it('is frame-rate independent (closed form)', () => {
    const a = createSpring(1);
    const b = createSpring(1);
    for (let i = 0; i < 30; i += 1) stepSpring(a, 0, 10, 1 / 30);
    for (let i = 0; i < 144; i += 1) stepSpring(b, 0, 10, 1 / 144);
    expect(a.value).toBeCloseTo(b.value, 9);
  });

  it('covers 63% of a step in its response time (ω = 2.146 / response)', () => {
    const spring = createSpring(0);
    for (let i = 0; i < 150; i += 1) stepSpring(spring, 1, 2.146 / 0.15, 0.001);
    expect(spring.value).toBeCloseTo(0.632, 2);
  });

  it('guard: a spring rushing at its target stops on it instead of overshooting', () => {
    const free = { value: 1, velocity: -40 };
    const guarded = { value: 1, velocity: -40 };
    let freeMin = 1;
    let guardedMin = 1;
    for (let i = 0; i < 60; i += 1) {
      freeMin = Math.min(freeMin, stepSpring(free, 0, 10, 1 / 60));
      guardedMin = Math.min(guardedMin, stepSpring(guarded, 0, 10, 1 / 60, true));
    }
    expect(freeMin).toBeLessThan(-0.1);
    expect(guardedMin).toBe(0);
  });

  it('angle springs take the short way round', () => {
    const spring = createSpring(Math.PI - 0.1);
    for (let i = 0; i < 120; i += 1) stepAngleSpring(spring, -Math.PI + 0.1, 10, 1 / 60);
    expect(wrapAngle(spring.value - (-Math.PI + 0.1))).toBeCloseTo(0, 3);
    expect(Math.abs(spring.value)).toBeGreaterThan(3); // went across ±π, not through 0
  });
});

/**
 * Flies the turn chain exactly as the engine does (keyboard ramp → bank spring → turn rate →
 * capped yaw-rate spring), holding a full bank key until the heading has turned 180°.
 */
function turn180(speed: number, medium: Medium, braking: boolean, sensitivity: number, fps = 60) {
  const dt = 1 / fps;
  const state = createTurnState();
  let axis = 0;
  let heading = 0;
  let t = 0;
  while (heading < Math.PI && t < 30) {
    axis = rampAxis(axis, 1, dt, ROLL_RATES, sensitivity);
    heading += stepTurn(state, axis, speed, medium, braking, sensitivity, dt) * dt;
    t += dt;
  }
  return { seconds: t, state, axis };
}

describe('180° turn times at full keyboard input', () => {
  it('cruise ≈ 2.2 s, a full circle ≈ 4 s', () => {
    const { seconds } = turn180(BASE_SPEED, 'air', false, 1);
    expect(seconds).toBeGreaterThan(2.0);
    expect(seconds).toBeLessThan(2.45);
  });

  it('boost is wider, brake and swimming tighter', () => {
    const cruise = turn180(BASE_SPEED, 'air', false, 1).seconds;
    expect(turn180(BOOST_SPEED, 'air', false, 1).seconds).toBeGreaterThan(cruise * 1.35);
    expect(turn180(brakeSpeed('air', BASE_SPEED), 'air', true, 1).seconds).toBeLessThan(cruise * 0.75);
    expect(turn180(UNDERWATER_BASE_SPEED, 'water', false, 1).seconds).toBeLessThan(cruise * 0.85);
    expect(turn180(brakeSpeed('water', BASE_SPEED), 'water', true, 1).seconds).toBeLessThan(1.5);
  });

  it('sensitivity applies in keyboard mode: faster ramp and more authority', () => {
    const low = turn180(BASE_SPEED, 'air', false, MIN_SENSITIVITY).seconds;
    const mid = turn180(BASE_SPEED, 'air', false, 1).seconds;
    const high = turn180(BASE_SPEED, 'air', false, MAX_SENSITIVITY).seconds;
    expect(low).toBeGreaterThan(mid * 1.25);
    expect(high).toBeLessThan(mid * 0.8);
  });

  it('is the same at 30, 60 and 144 FPS (within a frame or two)', () => {
    const at = (fps: number) => turn180(BASE_SPEED, 'air', false, 1, fps).seconds;
    expect(Math.abs(at(30) - at(144))).toBeLessThan(0.07);
    expect(Math.abs(at(60) - at(144))).toBeLessThan(0.03);
  });

  it('keyboard: full bank in ~0.2 s at default sensitivity', () => {
    let axis = 0;
    let t = 0;
    while (axis < 1) {
      axis = rampAxis(axis, 1, 1 / 120, ROLL_RATES, 1);
      t += 1 / 120;
    }
    expect(t).toBeCloseTo(0.2, 1);
  });
});

describe('rolling out', () => {
  it('releasing a full turn returns to level with ≤ 2% overshoot (bank and yaw rate)', () => {
    for (const [speed, medium, braking] of [
      [BASE_SPEED, 'air', false],
      [BOOST_SPEED, 'air', false],
      [brakeSpeed('air', BASE_SPEED), 'air', true],
      [UNDERWATER_BASE_SPEED, 'water', false],
    ] as const) {
      const { state, axis: startAxis } = turn180(speed, medium, braking, 1);
      const bank0 = state.bank.value;
      const rate0 = state.yawRate.value;
      let axis = startAxis;
      let bankOvershoot = 0;
      let rateOvershoot = 0;
      for (let i = 0; i < 180; i += 1) {
        axis = rampAxis(axis, 0, 1 / 60, ROLL_RATES, 1);
        stepTurn(state, axis, speed, medium, braking, 1, 1 / 60);
        bankOvershoot = Math.max(bankOvershoot, -state.bank.value);
        rateOvershoot = Math.max(rateOvershoot, -state.yawRate.value);
      }
      expect(bankOvershoot / bank0).toBeLessThanOrEqual(0.02);
      expect(rateOvershoot / rate0).toBeLessThanOrEqual(0.02);
      expect(Math.abs(state.yawRate.value)).toBeLessThan(1e-3);
    }
  });

  it('a hand snapping back to center (input steps to 0) also rolls out without overshoot', () => {
    const state = createTurnState();
    for (let i = 0; i < 120; i += 1) stepTurn(state, 1, BASE_SPEED, 'air', false, 1, 1 / 30);
    let overshoot = 0;
    for (let i = 0; i < 90; i += 1) {
      stepTurn(state, 0, BASE_SPEED, 'air', false, 1, 1 / 30);
      overshoot = Math.min(overshoot, state.bank.value, state.yawRate.value);
    }
    expect(overshoot).toBe(0);
  });

  it('caps the yaw acceleration at 400°/s²', () => {
    const state = createTurnState();
    let previous = 0;
    let maxAccel = 0;
    for (let i = 0; i < 240; i += 1) {
      const rate = stepTurn(state, i < 120 ? 1 : -1, brakeSpeed('air', BASE_SPEED), 'air', true, MAX_SENSITIVITY, 1 / 120);
      maxAccel = Math.max(maxAccel, Math.abs(rate - previous) * 120);
      previous = rate;
    }
    expect(toDeg(maxAccel)).toBeLessThanOrEqual(400.001);
  });

  it('the barrel roll locks the heading', () => {
    const state = createTurnState();
    for (let i = 0; i < 60; i += 1) stepTurn(state, 1, BASE_SPEED, 'air', false, 1, 1 / 60);
    expect(stepTurn(state, 1, BASE_SPEED, 'air', false, 1, 1 / 60, true)).toBe(0);
  });
});

describe('air brake speeds', () => {
  it('flies at half of cruise, never below the stall guard; swims slower', () => {
    expect(brakeSpeed('air', BASE_SPEED)).toBeCloseTo(4.5, 5);
    expect(brakeSpeed('air', 6)).toBe(MIN_FLYING_SPEED);
    expect(brakeSpeed('water', BASE_SPEED)).toBeLessThanOrEqual(UNDERWATER_BASE_SPEED * 0.6);
  });
});

describe('hand expo', () => {
  it('keeps the ends and the sign, and is gentle near the center', () => {
    expect(expoCurve(0)).toBe(0);
    expect(expoCurve(1)).toBeCloseTo(1, 10);
    expect(expoCurve(-1)).toBeCloseTo(-1, 10);
    expect(expoCurve(0.3)).toBeLessThan(0.3);
    expect(expoCurve(-0.3)).toBeCloseTo(-expoCurve(0.3), 10);
    // Monotonic.
    let previous = -Infinity;
    for (let v = -1; v <= 1; v += 0.01) {
      expect(expoCurve(v)).toBeGreaterThan(previous);
      previous = expoCurve(v);
    }
  });

  it('the last 30% of the box gives more than half of the full turn rate', () => {
    const rate = (offset: number) => turnRate(expoCurve(offset), BASE_SPEED, 'air', false, 1);
    expect(rate(1) - rate(0.7)).toBeGreaterThan(rate(1) * 0.5);
  });
});
