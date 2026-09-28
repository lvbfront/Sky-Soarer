import type { BirdType } from './bird';
import type { MapType, WeatherPreset } from './presets';

// Same "bird-flight-" prefix as the best-score key in highscore.ts.
const STORAGE_KEY = 'bird-flight-settings';
// Which control modes the player has ticked "Don't show again" for on the "How to fly" guide.
const GUIDE_DISMISSED_KEY = 'bird-flight-guide-dismissed';

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
