import { describe, expect, it } from 'vitest';
import { RaiseHoldDetector } from './takeoffGesture';
import { TAKEOFF_RAISE_HOLD } from './flightTuning';

/** Feeds a palm height (0 = top of the box) at `fps`; returns when the hold completed (ms), or null. */
function hold(fps: number, seconds: number, boxY: (t: number) => number | null) {
  const detector = new RaiseHoldDetector();
  for (let i = 0; i * (1000 / fps) <= seconds * 1000; i += 1) {
    const t = i * (1000 / fps);
    const y = boxY(t);
    const done = y === null ? detector.handLost(t) : detector.update(y, t);
    if (done) return t;
  }
  return null;
}

describe('raise-and-hold takeoff (hand)', () => {
  it('fires after the palm stays in the top 20% of the box for 0.5 s, at 10–60 Hz', () => {
    for (const fps of [10, 15, 30, 60]) {
      const at = hold(fps, 2, (t) => (t >= 200 ? 0.1 : 0.5));
      expect(at).not.toBeNull();
      expect(at! - 200).toBeGreaterThanOrEqual(TAKEOFF_RAISE_HOLD * 1000);
      expect(at! - 200).toBeLessThan(TAKEOFF_RAISE_HOLD * 1000 + 1000 / fps + 1);
    }
  });

  it('a brief raise (a climb in flight, a flick) does not', () => {
    expect(hold(30, 2, (t) => (t >= 200 && t < 550 ? 0.05 : 0.5))).toBeNull();
  });

  it('dropping out of the zone restarts the hold', () => {
    expect(hold(30, 0.95, (t) => (t < 400 ? 0.1 : t < 450 ? 0.4 : 0.1))).toBeNull();
  });

  it('survives a short tracking dropout, not a long one', () => {
    expect(hold(15, 2, (t) => (t >= 300 && t < 400 ? null : 0.1))).not.toBeNull();
    expect(hold(15, 0.9, (t) => (t >= 200 && t < 500 ? null : 0.1))).toBeNull();
  });
});
