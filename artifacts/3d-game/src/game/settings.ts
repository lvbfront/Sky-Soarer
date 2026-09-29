import type { BirdType } from './bird';
import type { MapType, WeatherPreset } from './presets';
import { QUALITY_SETTINGS, type QualitySetting } from './quality';
import { clamp, computeBox, validateCalibration } from './trackingMath';
import {
  MAX_SENSITIVITY,
  MIN_SENSITIVITY,
  type CalibrationCorner,
  type CalibrationData,
  type CalibrationPoint,
} from './trackingShared';

// Same "bird-flight-" prefix as the best-score key in highscore.ts.
const STORAGE_KEY = 'bird-flight-settings';
// Which control modes the player has ticked "Don't show again" for on the "How to fly" guide.
const GUIDE_DISMISSED_KEY = 'bird-flight-guide-dismissed';
// The last hand calibration (center, 4 corners, sensitivity), so returning players can skip it.
const CALIBRATION_KEY = 'bird-flight-calibration';
const CALIBRATION_VERSION = 1;
// Graphics quality (Auto / High / Low), chosen in the pause menu.
const QUALITY_KEY = 'bird-flight-quality';

/** How the bird is flown: a hand in front of the webcam, or the keyboard (no camera at all). */
export type ControlMode = 'hand' | 'keyboard';

export interface FlightSettings {
  bird: BirdType;
  map: MapType;
  weather: WeatherPreset;
  ringChallenge: boolean;
  controls: ControlMode;
}

export const DEFAULT_SETTINGS: FlightSettings = {
  bird: 'pigeon',
  map: 'mountain',
  weather: 'sunny',
  ringChallenge: false,
  controls: 'hand',
};

const BIRDS: readonly BirdType[] = ['pigeon', 'falcon', 'flamingo', 'duck'];
const MAPS: readonly MapType[] = ['mountain', 'ocean'];
const WEATHERS: readonly WeatherPreset[] = ['sunny', 'sunset', 'night'];
const CONTROLS: readonly ControlMode[] = ['hand', 'keyboard'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * The last bird/map/sky/ring choices, persisted in this browser for the landing page's
 * "Quick start". Every field is validated on read, so a stale or hand-edited value falls back to
 * its default instead of reaching the engine.
 */
export function loadSettings(): FlightSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof FlightSettings, unknown>>;
    return {
      bird: pick(parsed.bird, BIRDS, DEFAULT_SETTINGS.bird),
      map: pick(parsed.map, MAPS, DEFAULT_SETTINGS.map),
      weather: pick(parsed.weather, WEATHERS, DEFAULT_SETTINGS.weather),
      ringChallenge: typeof parsed.ringChallenge === 'boolean' ? parsed.ringChallenge : DEFAULT_SETTINGS.ringChallenge,
      // Settings saved before keyboard mode existed have no `controls`, and fall back to hand.
      controls: pick(parsed.controls, CONTROLS, DEFAULT_SETTINGS.controls),
    };
  } catch {
    // Storage disabled, or unparseable JSON: fall back to defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

/** True once the player has saved settings at least once (the Quick start label uses it). */
export function hasSavedSettings(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveSettings(settings: FlightSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore write failures (e.g. storage disabled); the in-memory choice still applies.
  }
}

/** The saved graphics quality setting; Auto when none (or an unknown value) is stored. */
export function loadQuality(): QualitySetting {
  try {
    return pick(window.localStorage.getItem(QUALITY_KEY), QUALITY_SETTINGS, 'auto');
  } catch {
    return 'auto';
  }
}

export function saveQuality(quality: QualitySetting) {
  try {
    window.localStorage.setItem(QUALITY_KEY, quality);
  } catch {
    // Storage disabled: the choice applies to this session only.
  }
}

function loadDismissedGuides(): Partial<Record<ControlMode, boolean>> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(GUIDE_DISMISSED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<ControlMode, boolean>>) : {};
  } catch {
    return {};
  }
}

/**
 * Whether the "How to fly" guide opens by itself before a flight in this control mode. It does
 * until the player ticks "Don't show again", separately per mode since the two guides differ.
 */
export function shouldAutoShowGuide(mode: ControlMode): boolean {
  return loadDismissedGuides()[mode] !== true;
}

export function dismissGuide(mode: ControlMode) {
  try {
    window.localStorage.setItem(GUIDE_DISMISSED_KEY, JSON.stringify({ ...loadDismissedGuides(), [mode]: true }));
  } catch {
    // Storage disabled: the guide just keeps showing.
  }
}

const CORNERS: readonly CalibrationCorner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

function readPoint(value: unknown): CalibrationPoint | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/**
 * The hand calibration saved at the last takeoff, or null if there isn't one or it's unusable: every
 * point must be a finite 0..1 coordinate and the whole must pass `validateCalibration`, so a stale
 * or hand-edited value can't reach the tracker. The sensitivity is clamped to the slider's range.
 */
export function loadCalibration(): CalibrationData | null {
  try {
    const raw = window.localStorage.getItem(CALIBRATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== CALIBRATION_VERSION) return null;
    const center = readPoint(parsed.center);
    const cornersIn = (parsed.corners ?? {}) as Record<string, unknown>;
    const corners: Partial<Record<CalibrationCorner, CalibrationPoint>> = {};
    for (const corner of CORNERS) {
      const point = readPoint(cornersIn[corner]);
      if (!point) return null;
      corners[corner] = point;
    }
    if (!center) return null;
    if (validateCalibration(center, computeBox(corners)).length > 0) return null;
    const sensitivity = typeof parsed.sensitivity === 'number' && Number.isFinite(parsed.sensitivity) ? parsed.sensitivity : 1;
    return {
      center,
      corners: corners as Record<CalibrationCorner, CalibrationPoint>,
      sensitivity: clamp(sensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY),
    };
  } catch {
    return null;
  }
}

export function saveCalibration(calibration: CalibrationData) {
  try {
    window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ version: CALIBRATION_VERSION, ...calibration }));
  } catch {
    // Storage disabled: the player just calibrates again next time.
  }
}
