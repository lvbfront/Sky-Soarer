// Everything the game keeps in this browser, in one list: the Privacy panel shows it entry by entry
// (with the raw stored value) and "Clear my data" removes it. localStorage is the only storage the
// game uses (no cookies, sessionStorage, IndexedDB or Cache Storage), and no entry ever holds a
// camera frame, an image or hand landmarks: the calibration is five 0..1 points and a number.
//
// A new localStorage key must be added here (the test pins the list), so the panel stays exact.
import { BEST_SCORE_KEY } from './highscore';
import { CALIBRATION_KEY, GUIDE_DISMISSED_KEY, QUALITY_KEY, SETTINGS_KEY } from './settings';

/** Every key the game writes starts with this, so Clear also catches keys from older versions. */
export const STORAGE_PREFIX = 'bird-flight-';

export interface StoredDataEntry {
  key: string;
  label: string;
  /** What the value holds, in plain words. */
  contents: string;
}

export const STORED_DATA: readonly StoredDataEntry[] = [
  {
    key: SETTINGS_KEY,
    label: 'Last flight settings',
    contents:
      'Bird, world, sky, Ring Challenge on/off, input (hand or keyboard) and steering (sensitivity, invert), for Quick start.',
  },
  {
    key: CALIBRATION_KEY,
    label: 'Hand calibration',
    contents:
      'Five points (x, y between 0 and 1), a sensitivity number and your palm’s apparent size (one number, for the air brake). No image, no video, no hand shape.',
  },
  {
    key: BEST_SCORE_KEY,
    label: 'Best ring score',
    contents: 'One number.',
  },
  {
    key: GUIDE_DISMISSED_KEY,
    label: '“How to fly” dismissed',
    contents: 'Whether you ticked “Don’t show again”, per input mode.',
  },
  {
    key: QUALITY_KEY,
    label: 'Graphics quality',
    contents: 'Auto, High or Low.',
  },
];

export interface StoredDataSnapshot extends StoredDataEntry {
  /** The raw stored string, or null when nothing is stored under this key. */
  value: string | null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked (some privacy modes throw on access): nothing is stored.
    return null;
  }
}

/** Each entry with its current raw value, for the Privacy panel. */
export function readStoredData(): StoredDataSnapshot[] {
  const store = storage();
  return STORED_DATA.map((entry) => {
    let value: string | null = null;
    try {
      value = store?.getItem(entry.key) ?? null;
    } catch {
      value = null;
    }
    return { ...entry, value };
  });
}

/**
 * Removes everything the game stored in this browser: every listed key plus any other key with the
 * game's prefix. Returns false if storage couldn't be reached (then there was nothing to clear).
 */
export function clearStoredData(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const keys = new Set(STORED_DATA.map((entry) => entry.key));
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.add(key);
    }
    keys.forEach((key) => store.removeItem(key));
    return true;
  } catch {
    return false;
  }
}
