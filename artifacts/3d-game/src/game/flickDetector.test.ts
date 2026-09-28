import { describe, expect, it } from 'vitest';
import { damp, perFrameRate } from './damping';
import { FlickDetector, type FlickFrame } from './flickDetector';
import { BACKFLIP_COOLDOWN_MS, FLICK_WINDOW_MS } from './trackingShared';

// Synthetic palm tracks fed to the detector at a fixed camera frame rate. Y is the raw camera-frame
// palm Y (0 top .. 1 bottom); distances below are given in heights of the calibrated box.
const BOX = 0.44; // the default calibration box's height
const REST_Y = 0.6;
const T0_MS = 10_000;

function smoothstep(u: number) {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/** A smooth upward move of `rise` box heights, starting at `start` s and taking `duration` s. */
function snap(start: number, duration: number, rise: number, box = BOX) {
  return (t: number) => -rise * box * smoothstep((t - start) / duration);
}

/** Deterministic ± `amplitude` frame-units of per-frame tracking jitter. */
function jitter(amplitude: number, seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (state / 2147483648 - 0.5) * 2 * amplitude;
  };
}

/** Steering pitch as the tracker would compute it for this Y: 0 at rest, +1 a full box-half up. */
function pitchFor(y: number) {
  return Math.max(-1, Math.min(1, (REST_Y - y) / (BOX / 2)));
}

interface SimFrame {
  t: number;
  y: number;
  pitchIn: number;
  out: FlickFrame;
}

function simulate(
  fps: number,
  seconds: number,
  offset: (t: number) => number,
  { box = BOX, noise = jitter(0.002), detector = new FlickDetector() } = {},
) {
  const frames: SimFrame[] = [];
  const stepMs = 1000 / fps;
  for (let i = 0; i * stepMs <= seconds * 1000; i += 1) {
    const t = (i * stepMs) / 1000;
    const y = REST_Y + offset(t) + noise();
    const pitchIn = pitchFor(y);
    frames.push({ t, y, pitchIn, out: detector.update(y, box, T0_MS + i * stepMs, pitchIn) });
  }
  return { frames, detector };
}

const backflips = (frames: SimFrame[]) => frames.filter((f) => f.out.backflip);

/**
 * The bird's actual pitch through `frames`: the engine's orientation chase (0.06 per frame at
 * 60 FPS, see GameEngine's ORIENTATION_RATE) run at a 120 Hz render rate on the latest camera
 * reading. Returns the peak |pitch| reached.
 */
function enginePitchPeak(frames: SimFrame[], target: (frame: SimFrame) => number) {
  const rate = perFrameRate(0.06, 60);
  const step = 1 / 120;
  let current = target(frames[0]);
  let peak = Math.abs(current);
  let index = 0;
  for (let t = frames[0].t; t <= frames[frames.length - 1].t; t += step) {
    while (index + 1 < frames.length && frames[index + 1].t <= t) index += 1;
    current += (target(frames[index]) - current) * damp(rate, step);
    peak = Math.max(peak, Math.abs(current));
  }
  return peak;
}
const nearMisses = (frames: SimFrame[]) => frames.map((f) => f.out.nearMiss).filter((m) => m !== null);

describe.each([30, 60])('FlickDetector at %i FPS', (fps) => {
  describe('natural flicks fire', () => {
    it('about half the box in 0.15 s fires once, within ~0.15 s', () => {
      const { frames } = simulate(fps, 1.5, snap(0.5, 0.15, 0.5));
      const fired = backflips(frames);
      expect(fired).toHaveLength(1);
      expect(fired[0].t - 0.5).toBeLessThan(0.16);
      expect(nearMisses(frames)).toEqual([]);
    });

    it('half the box in 0.2 s fires', () => {
      expect(backflips(simulate(fps, 1.5, snap(0.5, 0.2, 0.5)).frames)).toHaveLength(1);
    });

    it('a larger, faster flick fires', () => {
      expect(backflips(simulate(fps, 1.5, snap(0.5, 0.12, 0.8)).frames)).toHaveLength(1);
    });

    it('with heavier tracking jitter it still fires exactly once', () => {
      const { frames } = simulate(fps, 1.5, snap(0.5, 0.15, 0.5), { noise: jitter(0.005, 7) });
      expect(backflips(frames)).toHaveLength(1);
    });
  });

  it('measures the flick in box heights, not frame heights', () => {
    // The same quick 0.25-frame-height snap: over half a 0.44 box, but under a third of a 0.9 box.
    const move = (t: number) => -0.25 * smoothstep((t - 0.5) / 0.1);
    expect(backflips(simulate(fps, 1.5, move, { box: 0.44 }).frames)).toHaveLength(1);
    const big = simulate(fps, 1.5, move, { box: 0.9 }).frames;
    expect(backflips(big)).toHaveLength(0);
    expect(nearMisses(big)).toEqual(['too-short']);
  });

  describe('no false triggers', () => {
    it('a still hand with jitter: no backflip, no hint, pitch untouched', () => {
      const { frames } = simulate(fps, 5, () => 0, { noise: jitter(0.004, 3) });
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual([]);
      expect(frames.every((f) => f.out.pitch === f.pitchIn)).toBe(true);
    });

    it('brisk steering: center to the top edge in 0.35 s', () => {
      const { frames } = simulate(fps, 1.5, snap(0.3, 0.35, 0.5));
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual([]);
      // Too slow to look like a flick, so the climb isn't held back at all.
      expect(frames.every((f) => f.out.pitch === f.pitchIn)).toBe(true);
    });

    it('a full bottom-to-top sweep in 0.6 s', () => {
      const { frames } = simulate(fps, 1.5, (t) => 0.5 * BOX + snap(0.3, 0.6, 1)(t));
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual([]);
    });

    it('slow weaving up and down for 6 s', () => {
      const { frames } = simulate(fps, 6, (t) => 0.4 * BOX * Math.sin(t * 3));
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual([]);
    });

    it('boosting: a fist closing and opening shifts the palm center a little', () => {
      // 0.03 frame heights (~0.07 box) down in 0.1 s and back up, every 0.8 s.
      const fist = (t: number) => {
        const phase = t % 0.8;
        return phase < 0.1 ? 0.03 * smoothstep(phase / 0.1) : phase < 0.4 ? 0.03 : 0.03 * (1 - smoothstep((phase - 0.4) / 0.1));
      };
      const { frames } = simulate(fps, 4, fist);
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual([]);
    });
  });

  describe('near-miss hints', () => {
    it('far enough but not fast enough: too-slow', () => {
      const { frames } = simulate(fps, 1.5, snap(0.3, 0.3, 0.6));
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual(['too-slow']);
    });

    it('fast but not far enough: too-short', () => {
      const { frames } = simulate(fps, 1.5, snap(0.3, 0.07, 0.25));
      expect(backflips(frames)).toHaveLength(0);
      expect(nearMisses(frames)).toEqual(['too-short']);
    });
  });

  it('honors the cooldown, and a flick swallowed by it is not a near miss', () => {
    // Flicks at 0.3 s, 0.8 s (inside the cooldown) and 0.3 s + cooldown + 0.3 s, each returning to rest.
    const third = 0.3 + BACKFLIP_COOLDOWN_MS / 1000 + 0.3;
    const flickAndBack = (start: number) => (t: number) =>
      snap(start, 0.15, 0.5)(t) + snap(start + 0.3, 0.15, -0.5)(t);
    const { frames } = simulate(fps, third + 1, (t) => flickAndBack(0.3)(t) + flickAndBack(0.8)(t) + flickAndBack(third)(t));
    const fired = backflips(frames);
    expect(fired).toHaveLength(2);
    expect(fired[1].t).toBeGreaterThan(third);
    expect(nearMisses(frames)).toEqual([]);
  });

  it('holds the pitch through a flick and its return, then lets steering through again', () => {
    // Flick half the box up at 0.5 s, hold there, drop back at 0.85 s.
    const move = (t: number) => snap(0.5, 0.15, 0.5)(t) + snap(0.85, 0.2, -0.5)(t);
    const { frames } = simulate(fps, 2.5, move);
    expect(backflips(frames)).toHaveLength(1);
    const during = frames.filter((f) => f.t >= 0.5 && f.t <= 1.1);
    expect(Math.max(...during.map((f) => f.pitchIn))).toBeGreaterThan(0.9); // the spike it would have caused
    // The hold starts once the stroke is measurably flick-fast (its first ~50 ms get through); from
    // then on the output is the pre-flick pitch (~0 here) until after the hand has dropped back.
    const held = during.filter((f) => f.t >= 0.6);
    expect(Math.max(...held.map((f) => Math.abs(f.out.pitch)))).toBeLessThan(0.05);
    // What the bird actually does: the engine chases the pitch target (ORIENTATION_RATE). Without
    // the hold the nose would come up by more than half of full pitch; with it, barely at all.
    expect(enginePitchPeak(during, (f) => f.pitchIn)).toBeGreaterThan(0.5);
    expect(enginePitchPeak(during, (f) => f.out.pitch)).toBeLessThan(0.06);
    const after = frames.filter((f) => f.t > 1.8);
    expect(after.every((f) => f.out.pitch === f.pitchIn)).toBe(true);
  });

  it('releases the pitch within one flick window during a very fast steering sweep', () => {
    // A full sweep in 0.5 s peaks near the flick speed but never rises fast enough over the window.
    const { frames } = simulate(fps, 1.5, (t) => 0.5 * BOX + snap(0.3, 0.5, 1)(t));
    expect(backflips(frames)).toHaveLength(0);
    const held = frames.filter((f) => f.out.pitch !== f.pitchIn);
    if (held.length > 0) {
      expect(held[held.length - 1].t - held[0].t).toBeLessThanOrEqual(FLICK_WINDOW_MS / 1000);
    }
  });

  it('fires once if the hand leaves the frame mid-flick', () => {
    const stepMs = 1000 / fps;
    const detector = new FlickDetector();
    const move = snap(0, 0.12, 0.5);
    let i = 0;
    for (; i * stepMs <= 70; i += 1) {
      const y = REST_Y + move((i * stepMs) / 1000);
      expect(detector.update(y, BOX, T0_MS + i * stepMs, 0).backflip).toBe(false);
    }
    expect(detector.handLost(T0_MS + i * stepMs).backflip).toBe(true);
    // ...and only once.
    expect(detector.handLost(T0_MS + (i + 1) * stepMs).backflip).toBe(false);
  });
});

describe('FlickDetector across frame rates', () => {
  it('fires on the same flick at 30 and 60 FPS at about the same time', () => {
    const at30 = backflips(simulate(30, 1.5, snap(0.5, 0.15, 0.5), { noise: () => 0 }).frames)[0].t;
    const at60 = backflips(simulate(60, 1.5, snap(0.5, 0.15, 0.5), { noise: () => 0 }).frames)[0].t;
    expect(Math.abs(at30 - at60)).toBeLessThan(0.05);
  });
});

describe('FlickDetector with sparse, irregular tracking', () => {
  // A loaded machine can drop the tracker to 15–20 Hz with uneven frame spacing. Each case runs 40
  // phase offsets with ±10% deterministic jitter on every frame interval.
  function fireCount(fps: number, move: (t: number) => number) {
    let fired = 0;
    for (let k = 0; k < 40; k += 1) {
      const detector = new FlickDetector();
      const step = 1000 / fps;
      let hit = false;
      for (let t = (k / 40) * step, i = 0; t < 2000; i += 1) {
        if (detector.update(REST_Y + move(t / 1000), BOX, T0_MS + t, 0).backflip) hit = true;
        t += step * (0.9 + (((k * 7 + i * 3) % 11) / 10) * 0.2);
      }
      if (hit) fired += 1;
    }
    return fired;
  }

  it.each([15, 20, 30, 60])('the natural half-box flick fires every time at %i Hz', (fps) => {
    expect(fireCount(fps, snap(0.5, 0.15, 0.5))).toBe(40);
  });

  it.each([15, 20, 30, 60])('a full-range steering sweep in 0.45 s never fires at %i Hz', (fps) => {
    expect(fireCount(fps, (t) => 0.5 * BOX + snap(0.5, 0.45, 1)(t))).toBe(0);
  });
});
