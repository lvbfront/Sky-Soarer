import { describe, expect, it } from 'vitest';
import { applyDeadzone, applySensitivity, axisValue, computeBox, validateCalibration } from './trackingMath';
import { DEFAULT_BOX, MIN_BOX_SIZE, STEERING_DEADZONE } from './trackingShared';

describe('axisValue', () => {
  // center 0.5, positive extent 0.8 (span 0.3), negative extent 0.3 (span 0.2): asymmetric on purpose.
  const map = (value: number) => axisValue(value, 0.5, 0.8, 0.3);

  it('reads 0 at the center and ±1 at each extent', () => {
    expect(map(0.5)).toBe(0);
    expect(map(0.8)).toBeCloseTo(1);
    expect(map(0.3)).toBeCloseTo(-1);
  });

  it('normalizes each side against its own extent', () => {
    expect(map(0.65)).toBeCloseTo(0.5); // half of the 0.3 span
    expect(map(0.4)).toBeCloseTo(-0.5); // half of the 0.2 span
  });

  it('clamps beyond the box', () => {
    expect(map(1)).toBe(1);
    expect(map(0)).toBe(-1);
  });

  it('returns 0 on a side with no span (center at or beyond that edge)', () => {
    expect(axisValue(0.9, 0.5, 0.5, 0.2)).toBe(0);
    expect(axisValue(0.1, 0.5, 0.8, 0.6)).toBe(0);
  });
});

describe('applyDeadzone', () => {
  it('zeroes values inside the deadzone', () => {
    expect(applyDeadzone(0, 0.1)).toBe(0);
    expect(applyDeadzone(0.1, 0.1)).toBe(0);
    expect(applyDeadzone(-0.05, 0.1)).toBe(0);
  });

  it('rescales the rest so the output is continuous and still reaches ±1', () => {
    expect(applyDeadzone(1, 0.1)).toBeCloseTo(1);
    expect(applyDeadzone(-1, 0.1)).toBeCloseTo(-1);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5);
    expect(applyDeadzone(0.1001, 0.1)).toBeLessThan(0.001);
  });

  it('keeps the sign', () => {
    expect(applyDeadzone(-0.55, STEERING_DEADZONE)).toBeLessThan(0);
  });
});

describe('applySensitivity', () => {
  const sensitivities = [0.5, 1, 1.5, 2];

  it('keeps 0 and full deflection fixed at every sensitivity', () => {
    for (const s of sensitivities) {
      expect(applySensitivity(0, s)).toBe(0);
      expect(applySensitivity(1, s)).toBeCloseTo(1);
      expect(applySensitivity(-1, s)).toBeCloseTo(-1);
    }
  });

  it('is linear at 1x', () => {
    expect(applySensitivity(0.37, 1)).toBeCloseTo(0.37);
  });

  it('still reaches full pitch/roll at 0.5x (a plain gain topped out at 0.5)', () => {
    expect(applySensitivity(1, 0.5)).toBeCloseTo(1);
    expect(applySensitivity(0.5, 0.5)).toBeCloseTo(1 / 3);
  });

  it("doesn't saturate mid-box at 2x (a plain gain hit 1 at 0.5)", () => {
    expect(applySensitivity(0.5, 2)).toBeCloseTo(2 / 3);
    expect(applySensitivity(0.9, 2)).toBeLessThan(1);
  });

  it('has a center gain equal to the sensitivity, and is monotonic', () => {
    for (const s of sensitivities) {
      expect(applySensitivity(0.001, s) / 0.001).toBeCloseTo(s, 2);
      let previous = -Infinity;
      for (let v = -1; v <= 1; v += 0.01) {
        const out = applySensitivity(v, s);
        expect(out).toBeGreaterThanOrEqual(previous);
        previous = out;
      }
    }
  });
});

describe('computeBox (recomputeBox)', () => {
  it('uses the defaults until corners exist', () => {
    expect(computeBox({})).toEqual(DEFAULT_BOX);
  });

  it('averages the two corners that share a side', () => {
    const box = computeBox({
      topLeft: { x: 0.2, y: 0.3 },
      topRight: { x: 0.8, y: 0.2 },
      bottomLeft: { x: 0.3, y: 0.7 },
      bottomRight: { x: 0.7, y: 0.9 },
    });
    expect(box.left).toBeCloseTo(0.25);
    expect(box.right).toBeCloseTo(0.75);
    expect(box.top).toBeCloseTo(0.25);
    expect(box.bottom).toBeCloseTo(0.8);
  });

  it('only finalizes a side once both of its corners are captured', () => {
    const box = computeBox({ topLeft: { x: 0.1, y: 0.1 }, topRight: { x: 0.9, y: 0.15 } });
    expect(box.top).toBeCloseTo(0.125); // both top corners
    expect(box.left).toBe(DEFAULT_BOX.left); // bottomLeft missing
    expect(box.right).toBe(DEFAULT_BOX.right);
    expect(box.bottom).toBe(DEFAULT_BOX.bottom);
  });
});

describe('validateCalibration', () => {
  const box = { left: 0.2, right: 0.8, top: 0.25, bottom: 0.75 };

  it('accepts a centered point in a roomy box', () => {
    expect(validateCalibration({ x: 0.5, y: 0.5 }, box)).toEqual([]);
  });

  it('rejects a center outside the box, or hugging an edge', () => {
    expect(validateCalibration({ x: 0.9, y: 0.5 }, box)).toEqual(['center-outside']);
    expect(validateCalibration({ x: 0.5, y: 0.1 }, box)).toEqual(['center-outside']);
    expect(validateCalibration({ x: 0.22, y: 0.5 }, box)).toEqual(['center-outside']);
  });

  it('rejects a box smaller than the minimum on either axis', () => {
    const narrow = { left: 0.45, right: 0.45 + MIN_BOX_SIZE * 0.9, top: 0.2, bottom: 0.8 };
    expect(validateCalibration({ x: 0.5, y: 0.5 }, narrow)).toContain('box-too-narrow');
    const short = { left: 0.2, right: 0.8, top: 0.45, bottom: 0.45 + MIN_BOX_SIZE * 0.9 };
    expect(validateCalibration({ x: 0.5, y: 0.5 }, short)).toContain('box-too-short');
  });

  it('rejects an inside-out box (corners captured on the wrong sides)', () => {
    const swapped = { left: 0.8, right: 0.2, top: 0.25, bottom: 0.75 };
    expect(validateCalibration({ x: 0.5, y: 0.5 }, swapped)).toContain('box-too-narrow');
  });

  it('accepts the default box with a centered center', () => {
    expect(validateCalibration({ x: 0.5, y: 0.5 }, DEFAULT_BOX)).toEqual([]);
  });
});
