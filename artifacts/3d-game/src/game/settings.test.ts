import { beforeEach, describe, expect, it } from 'vitest';
import { loadCalibration, saveCalibration } from './settings';
import type { CalibrationData } from './trackingShared';

// A minimal in-memory localStorage on a stand-in `window` (the tests run in Node).
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  },
});

const GOOD: CalibrationData = {
  center: { x: 0.5, y: 0.5 },
  corners: {
    topLeft: { x: 0.25, y: 0.3 },
    topRight: { x: 0.75, y: 0.3 },
    bottomLeft: { x: 0.25, y: 0.7 },
    bottomRight: { x: 0.75, y: 0.7 },
  },
  sensitivity: 1.4,
};

describe('saved calibration', () => {
  beforeEach(() => store.clear());

  it('round-trips a valid calibration', () => {
    saveCalibration(GOOD);
    expect(loadCalibration()).toEqual(GOOD);
  });

  it('returns null when nothing is saved, or the JSON is broken', () => {
    expect(loadCalibration()).toBeNull();
    store.set('bird-flight-calibration', '{not json');
    expect(loadCalibration()).toBeNull();
  });

  it('rejects a calibration that would fail validation (center outside the box)', () => {
    saveCalibration({ ...GOOD, center: { x: 0.95, y: 0.5 } });
    expect(loadCalibration()).toBeNull();
  });

  it('rejects out-of-range or missing points', () => {
    saveCalibration({ ...GOOD, corners: { ...GOOD.corners, topLeft: { x: -0.2, y: 0.3 } } });
    expect(loadCalibration()).toBeNull();
    store.set('bird-flight-calibration', JSON.stringify({ version: 1, center: GOOD.center, sensitivity: 1 }));
    expect(loadCalibration()).toBeNull();
  });

  it('clamps the sensitivity to the slider range', () => {
    saveCalibration({ ...GOOD, sensitivity: 9 });
    expect(loadCalibration()?.sensitivity).toBe(2);
  });
});
