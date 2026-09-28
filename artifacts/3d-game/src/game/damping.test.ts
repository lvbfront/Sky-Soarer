import { describe, expect, it } from 'vitest';
import { damp, perFrameRate } from './damping';

describe('damp / perFrameRate', () => {
  it('reproduces the old per-frame factor at its reference frame rate', () => {
    for (const alpha of [0.02, 0.04, 0.06, 0.35]) {
      expect(damp(perFrameRate(alpha, 60), 1 / 60)).toBeCloseTo(alpha, 10);
    }
    expect(damp(perFrameRate(0.35, 30), 1 / 30)).toBeCloseTo(0.35, 10);
  });

  it('converges the same amount per second at any frame rate', () => {
    const rate = perFrameRate(0.06, 60);
    const after = (fps: number) => {
      let value = 0;
      for (let i = 0; i < fps; i += 1) value += (1 - value) * damp(rate, 1 / fps);
      return value;
    };
    expect(after(30)).toBeCloseTo(after(60), 10);
    expect(after(144)).toBeCloseTo(after(60), 10);
  });
});
