import type { BirdType } from '@/game/bird';
import type { MapType, WeatherPreset } from '@/game/presets';
import type { ControlMode } from '@/game/settings';

/** One chapter of "The Ascent": each is a full-viewport section and one setup step. */
export interface Chapter {
  id: 'hero' | 'bird' | 'world' | 'sky' | 'takeoff';
  /** Altitude shown on the rail and in the chapter eyebrow. */
  meters: number;
  label: string;
}

export const CHAPTERS: Chapter[] = [
  { id: 'hero', meters: 0, label: 'Ground' },
  { id: 'bird', meters: 300, label: 'Choose your bird' },
  { id: 'world', meters: 1200, label: 'Choose your world' },
  { id: 'sky', meters: 3000, label: 'Choose the sky' },
  { id: 'takeoff', meters: 5000, label: 'Above the clouds' },
];

export const TAGLINE = 'Fly a bird with nothing but your hand.';

/** One-line personalities. Cosmetic only: every bird flies with identical physics in-game. */
export const BIRD_PERSONALITY: Record<BirdType, string> = {
  pigeon: 'The steady one. Curious, forgiving, happy anywhere the wind goes.',
  falcon: 'Sharp-eyed and sleek, built for clean, fast lines across the valley.',
  flamingo: 'All elegance and long lines. The showpiece of any sky.',
  duck: 'Unbothered and waterproof. Never met a wave it didn’t want to dive under.',
};

export const MAP_DETAILS: Record<MapType, { blurb: string; meta: string[] }> = {
  mountain: {
    blurb: 'Endless rolling hills, carved fresh from noise every flight.',
    meta: ['Terrain · procedural', 'Seed · new every flight'],
  },
  ocean: {
    blurb: 'Turquoise water and palm islands. Dive in to find a reef below.',
    meta: ['Sea level · 0 m', 'Dive · reef, turtles, mantas'],
  },
};

export const WEATHER_DETAILS: Record<WeatherPreset, { time: string; blurb: string }> = {
  sunny: { time: '07:40', blurb: 'Clear air, long shadows, warm light.' },
  sunset: { time: '19:12', blurb: 'Golden hour across the whole horizon.' },
  night: { time: '23:50', blurb: 'Moonlight and a sky full of stars.' },
};

/** Compact controls briefing shown before pre-flight, per control mode. */
export const CONTROLS_BRIEFING: Record<ControlMode, readonly { key: string; action: string; detail: string }[]> = {
  hand: [
    { key: 'Palm', action: 'Steer', detail: 'Move inside your calibrated box to pitch and bank.' },
    { key: 'Fist', action: 'Boost', detail: 'Plus an automatic barrel roll as it closes.' },
    { key: 'Flick up', action: 'Backflip', detail: 'A fast upward flick of the hand.' },
  ],
  keyboard: [
    { key: 'WASD / ←↑↓→', action: 'Steer', detail: 'W or ↑ climbs, S or ↓ dives, A/D or ←/→ bank.' },
    { key: 'Space', action: 'Boost', detail: 'Hold to boost; each press also fires a barrel roll.' },
    { key: 'F', action: 'Backflip', detail: 'One press, one backflip. Esc pauses.' },
  ],
};

export const CONTROL_MODE_OPTIONS: { id: ControlMode; name: string; short: string }[] = [
  { id: 'hand', name: 'Hand (webcam)', short: 'Hand' },
  { id: 'keyboard', name: 'Keyboard', short: 'Keyboard' },
];

/** "0 m" → "00 000", "1200" → "01 200": the instrument-style altitude readout. */
export function formatAltitude(meters: number) {
  const padded = Math.max(0, Math.round(meters)).toString().padStart(5, '0');
  return `${padded.slice(0, -3)} ${padded.slice(-3)}`;
}

export function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}
