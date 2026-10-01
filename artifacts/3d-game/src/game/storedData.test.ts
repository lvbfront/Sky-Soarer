import { beforeEach, describe, expect, it } from 'vitest';
import { saveBestScoreIfHigher } from './highscore';
import { DEFAULT_SETTINGS, dismissGuide, saveCalibration, saveQuality, saveSettings } from './settings';
import { STORAGE_PREFIX, STORED_DATA, clearStoredData, readStoredData } from './storedData';

// A minimal in-memory localStorage on a stand-in `window` (the tests run in Node).
const store = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  },
});

/** Writes every kind of data the game stores, through the game's own save functions. */
function saveEverything() {
  saveSettings({ ...DEFAULT_SETTINGS, controls: 'keyboard' });
  saveCalibration({
    center: { x: 0.5, y: 0.5 },
    corners: {
      topLeft: { x: 0.25, y: 0.3 },
      topRight: { x: 0.75, y: 0.3 },
      bottomLeft: { x: 0.25, y: 0.7 },
      bottomRight: { x: 0.75, y: 0.7 },
    },
    sensitivity: 1.2,
  });
  saveBestScoreIfHigher(7);
  dismissGuide('hand');
  saveQuality('low');
}

describe('stored data registry', () => {
  beforeEach(() => store.clear());

  it('lists exactly the keys the game writes, all with the shared prefix', () => {
    saveEverything();
    expect([...store.keys()].sort()).toEqual(STORED_DATA.map((entry) => entry.key).sort());
    STORED_DATA.forEach((entry) => expect(entry.key.startsWith(STORAGE_PREFIX)).toBe(true));
  });

  it('stores only small, image-free values', () => {
    saveEverything();
    for (const value of store.values()) {
      expect(value.length).toBeLessThan(400);
      expect(value).not.toMatch(/data:|base64|blob:|landmark/i);
    }
  });

  it('reads each entry with its raw value', () => {
    saveBestScoreIfHigher(3);
    const snapshot = readStoredData();
    expect(snapshot.find((entry) => entry.key === 'bird-flight-best-score')?.value).toBe('3');
    expect(snapshot.find((entry) => entry.key === 'bird-flight-calibration')?.value).toBeNull();
  });

  it('clears every game key, including unknown prefixed ones, and leaves other keys alone', () => {
    saveEverything();
    store.set('bird-flight-legacy', 'x');
    store.set('other-app', 'keep');
    expect(clearStoredData()).toBe(true);
    expect([...store.keys()]).toEqual(['other-app']);
    expect(readStoredData().every((entry) => entry.value === null)).toBe(true);
  });
});
