import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadCalibration, loadQuality, loadSettings, saveCalibration, saveQuality, saveSettings } from './settings';
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

describe('saved graphics quality', () => {
  beforeEach(() => store.clear());

  it('defaults to Auto and round-trips a choice', () => {
    expect(loadQuality()).toBe('auto');
    saveQuality('low');
    expect(loadQuality()).toBe('low');
    saveQuality('high');
    expect(loadQuality()).toBe('high');
  });

  it('falls back to Auto for an unknown stored value', () => {
    store.set('bird-flight-quality', 'ultra');
    expect(loadQuality()).toBe('auto');
  });
});

describe('steering settings (inside the settings object)', () => {
  beforeEach(() => store.clear());

  it('settings saved before steering existed still load, with default steering', () => {
    store.set(
      'bird-flight-settings',
      JSON.stringify({ bird: 'falcon', map: 'ocean', weather: 'night', ringChallenge: true, controls: 'keyboard' }),
    );
    const settings = loadSettings();
    expect(settings).toMatchObject({ bird: 'falcon', map: 'ocean', weather: 'night', ringChallenge: true, controls: 'keyboard' });
    expect(settings.steering).toEqual({ sensitivity: 1, invertPitch: false });
  });

  it('settings from before keyboard mode existed (no controls, no steering) still load', () => {
    store.set('bird-flight-settings', JSON.stringify({ bird: 'duck', map: 'mountain', weather: 'sunny', ringChallenge: false }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, bird: 'duck' });
  });

  it('an old hand player keeps the sensitivity they set on the calibration screen', () => {
    saveCalibration({ ...GOOD, sensitivity: 1.6 });
    store.set('bird-flight-settings', JSON.stringify({ bird: 'pigeon', map: 'mountain', weather: 'sunny', ringChallenge: false, controls: 'hand' }));
    expect(loadSettings().steering.sensitivity).toBe(1.6);
  });

  it('round-trips, and applies to both control modes (one shared value)', () => {
    for (const controls of ['hand', 'keyboard'] as const) {
      saveSettings({ ...DEFAULT_SETTINGS, controls, steering: { sensitivity: 1.7, invertPitch: true } });
      expect(loadSettings().steering).toEqual({ sensitivity: 1.7, invertPitch: true });
      expect(loadSettings().controls).toBe(controls);
    }
  });

  it('validates every field: out of range or wrong types fall back', () => {
    store.set(
      'bird-flight-settings',
      JSON.stringify({ ...DEFAULT_SETTINGS, steering: { sensitivity: 12, invertPitch: 'yes' } }),
    );
    expect(loadSettings().steering).toEqual({ sensitivity: 2, invertPitch: false });
  });

  it('writes no new storage key', () => {
    saveSettings({ ...DEFAULT_SETTINGS, steering: { sensitivity: 0.8, invertPitch: true } });
    expect([...store.keys()]).toEqual(['bird-flight-settings']);
  });
});

describe('calibration palm size (air brake)', () => {
  beforeEach(() => store.clear());

  it('old calibrations without a palm size still load (and have none)', () => {
    store.set('bird-flight-calibration', JSON.stringify({ version: 1, ...GOOD }));
    const loaded = loadCalibration();
    expect(loaded).toEqual(GOOD);
    expect(loaded?.handSize).toBeUndefined();
  });

  it('round-trips a palm size, and drops a nonsense one', () => {
    saveCalibration({ ...GOOD, handSize: 0.11 });
    expect(loadCalibration()?.handSize).toBe(0.11);
    store.set('bird-flight-calibration', JSON.stringify({ version: 1, ...GOOD, handSize: -3 }));
    expect(loadCalibration()).toEqual(GOOD);
  });
});
