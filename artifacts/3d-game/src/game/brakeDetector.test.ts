import { describe, expect, it } from 'vitest';
import { PalmBrakeDetector } from './brakeDetector';
import { depthCorrected, palmSize } from './trackingMath';
import {
  BRAKE_BASELINE_MS,
  BRAKE_ENGAGE_RATIO,
  BRAKE_HOLD_MS,
  BRAKE_RELEASE_RATIO,
} from './trackingShared';

const BASE = 0.12;

/** Feeds `ratio(t)` × BASE at `fps` for `seconds`; returns the brake state per frame. */
function run(detector: PalmBrakeDetector, fps: number, seconds: number, ratio: (t: number) => number, t0 = 0) {
  const frames: { t: number; brake: boolean }[] = [];
  for (let i = 0; i * (1000 / fps) <= seconds * 1000; i += 1) {
    const t = t0 + i * (1000 / fps);
    frames.push({ t, brake: detector.update(BASE * ratio(t - t0), t).brake });
  }
  return frames;
}

describe('palm brake (push toward the camera)', () => {
  it('engages only after the palm stays ≥ 1.25× its calibrated size for 150 ms', () => {
    for (const fps of [15, 30, 60]) {
      const detector = new PalmBrakeDetector(BASE);
      const frames = run(detector, fps, 1, (t) => (t >= 200 ? 1.3 : 1));
      const first = frames.find((f) => f.brake);
      expect(first).toBeDefined();
      expect(first!.t - 200).toBeGreaterThanOrEqual(BRAKE_HOLD_MS);
      expect(first!.t - 200).toBeLessThan(BRAKE_HOLD_MS + 1000 / fps + 1);
    }
  });

  it('a brief bump (shorter than the hold) does not brake', () => {
    const detector = new PalmBrakeDetector(BASE);
    const frames = run(detector, 30, 1, (t) => (t >= 200 && t < 300 ? 1.4 : 1));
    expect(frames.some((f) => f.brake)).toBe(false);
  });

  it('has hysteresis: stays on between 1.15× and 1.25×, releases below 1.15×', () => {
    const detector = new PalmBrakeDetector(BASE);
    run(detector, 30, 0.5, () => 1.3);
    expect(detector.update(BASE * 1.2, 1000).brake).toBe(true);
    expect(detector.update(BASE * (BRAKE_RELEASE_RATIO + 0.01), 1033).brake).toBe(true);
    expect(detector.update(BASE * (BRAKE_RELEASE_RATIO - 0.01), 1066).brake).toBe(false);
    // And doesn't re-engage until it's back above the engage ratio for the hold time.
    expect(detector.update(BASE * 1.2, 1100).brake).toBe(false);
    expect(detector.update(BASE * BRAKE_ENGAGE_RATIO, 1133).brake).toBe(false);
  });

  it('jitter around the release threshold does not flicker once engaged', () => {
    const detector = new PalmBrakeDetector(BASE);
    run(detector, 30, 0.5, () => 1.3);
    const frames = run(detector, 30, 1, (t) => 1.2 + 0.03 * Math.sin(t / 20), 600);
    expect(frames.every((f) => f.brake)).toBe(true);
  });

  it('releases when the hand is lost', () => {
    const detector = new PalmBrakeDetector(BASE);
    run(detector, 30, 0.5, () => 1.3);
    detector.release();
    expect(detector.update(BASE * 1.3, 2000).brake).toBe(false);
  });

  it('old calibrations (no palm size): derives the baseline from the first seconds, then brakes', () => {
    const detector = new PalmBrakeDetector(null);
    const early = run(detector, 30, BRAKE_BASELINE_MS / 1000, (t) => 1 + 0.02 * Math.sin(t / 50));
    expect(early.some((f) => f.brake)).toBe(false);
    expect(detector.getBaseline()).toBeCloseTo(BASE, 2);
    const later = run(detector, 30, 0.5, () => 1.35, BRAKE_BASELINE_MS + 100);
    expect(later.some((f) => f.brake)).toBe(true);
  });
});

/** A flat open hand: wrist at (cx, cy+s), knuckles across the top, scaled by `s` (frame heights). */
function hand(cx: number, cy: number, s: number) {
  const points = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  points[0] = { x: cx, y: cy + s };
  points[5] = { x: cx - (s * 0.45) / (4 / 3), y: cy - s * 0.1 };
  points[17] = { x: cx + (s * 0.45) / (4 / 3), y: cy - s * 0.05 };
  return points;
}

describe('palm size and depth correction', () => {
  it('scales with the hand and ignores where it is in the frame', () => {
    const near = palmSize(hand(0.3, 0.4, 0.25), 4 / 3);
    const far = palmSize(hand(0.6, 0.6, 0.2), 4 / 3);
    expect(near / far).toBeCloseTo(1.25, 5);
  });

  it('curling the fingers (a fist) does not change it', () => {
    const open = hand(0.5, 0.5, 0.2);
    const fist = open.map((p) => ({ ...p }));
    for (const tip of [4, 8, 12, 16, 20]) fist[tip] = { x: 0.5, y: 0.5 };
    expect(palmSize(fist, 4 / 3)).toBe(palmSize(open, 4 / 3));
  });

  it('pushing in does not move the steering point (perspective undone)', () => {
    // A palm 0.2 right of the image center, pushed in so it looks 1.3× bigger, appears 0.26 right.
    expect(depthCorrected(0.5 + 0.2 * 1.3, 1.3)).toBeCloseTo(0.7, 10);
    // Never applied when the hand looks smaller (further away, or tilted).
    expect(depthCorrected(0.8, 0.8)).toBe(0.8);
  });
});
