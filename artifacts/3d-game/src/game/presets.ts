/**
 * Map + weather presets shared by the in-game engine (GameEngine) and the scroll-driven landing
 * scene (LandingScene). Kept in their own module so the landing page can use them without pulling
 * the whole engine (underwater, rings, particles) into the first-load bundle.
 */

export type MapType = 'mountain' | 'ocean';

export const MAP_OPTIONS: { id: MapType; name: string; tagline: string }[] = [
  { id: 'mountain', name: 'Mountain Valley', tagline: 'Rolling procedural hills.' },
  { id: 'ocean', name: 'Tropical Ocean & Islands', tagline: 'Skim the waves, or dive beneath them, between palm-dotted islands.' },
];

export type WeatherPreset = 'sunny' | 'sunset' | 'night';

export const WEATHER_OPTIONS: { id: WeatherPreset; name: string; tagline: string }[] = [
  { id: 'sunny', name: 'Sunny Morning', tagline: 'Bright skies and warm light.' },
  { id: 'sunset', name: 'Sunset Gold', tagline: 'Golden hour glow across the horizon.' },
  { id: 'night', name: 'Starry Night', tagline: 'Cool moonlight under a field of stars.' },
];

export interface WeatherLook {
  skyTop: string;
  skyBottom: string;
  fogMountain: string;
  fogOcean: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fillColor: string;
  ambientColor: string;
  ambientIntensity: number;
  stars: boolean;
}

export const WEATHER_LOOKS: Record<WeatherPreset, WeatherLook> = {
  sunny: {
    skyTop: '#7ec3e0',
    skyBottom: '#fdeecb',
    fogMountain: '#dcefe6',
    fogOcean: '#bfe6ef',
    sunColor: '#ffdfb0',
    sunIntensity: 1.15,
    hemiSky: '#fff3df',
    hemiGround: '#9fcf9a',
    hemiIntensity: 0.9,
    fillColor: '#bcd8ff',
    ambientColor: '#ffffff',
    ambientIntensity: 0.15,
    stars: false,
  },
  sunset: {
    skyTop: '#5b6ea8',
    skyBottom: '#ff9f6b',
    fogMountain: '#ffcf9e',
    fogOcean: '#ffb98f',
    sunColor: '#ff7f4d',
    sunIntensity: 1.0,
    hemiSky: '#ffd9a0',
    hemiGround: '#7a5a4a',
    hemiIntensity: 0.7,
    fillColor: '#8a6bb0',
    ambientColor: '#ff9d6e',
    ambientIntensity: 0.18,
    stars: false,
  },
  night: {
    skyTop: '#050c24',
    skyBottom: '#182848',
    fogMountain: '#101a33',
    fogOcean: '#0b1830',
    sunColor: '#9fb4ff',
    sunIntensity: 0.55,
    hemiSky: '#4a5a8f',
    hemiGround: '#141d33',
    hemiIntensity: 0.35,
    fillColor: '#5c73b0',
    ambientColor: '#8fa5ff',
    ambientIntensity: 0.12,
    stars: true,
  },
};

// Flight numbers the UI quotes (the "How to fly" guide) as well as the engine using them, kept here
// so the guide stays accurate without importing the lazily loaded engine.
/** Cruise and boost airspeed, in world units (meters) per second. */
export const BASE_SPEED = 9;
export const BOOST_SPEED = 20;
/** Length of the barrel roll and backflip sweeps, in seconds. */
export const BARREL_ROLL_DURATION = 0.8;
export const BACKFLIP_DURATION = 0.9;

/**
 * Ring Challenge: the color of the *next* ring (the one the guide arrow points at), per map and
 * sky. Ordinary rings are always gold, which already reads against every palette, so the target
 * needs a hue that's clearly not gold and also stands out from that combination's sky, fog and
 * ground: magenta against the green valley and turquoise sea at noon, cyan against the orange
 * valley sunset, violet where a sunset meets the teal sea, and cool mint or hot pink against the
 * navy night. All six combinations live in this one table, which the engine (ring + arrow
 * materials) and the HUD (the NEXT RING readout's marker) both read.
 */
export interface RingHighlight {
  /** Base color of the highlighted ring and the guide arrow. */
  color: string;
  /** Emissive color, pulsed by the ring manager. */
  emissive: string;
  /** Pale tint of the glow disc and the additive halo around the ring. */
  glow: string;
}

export const NEXT_RING_HIGHLIGHTS: Record<MapType, Record<WeatherPreset, RingHighlight>> = {
  mountain: {
    sunny: { color: '#ff4fb8', emissive: '#ff1f8f', glow: '#ffc2e6' },
    sunset: { color: '#43f3ff', emissive: '#00c8ff', glow: '#c8fbff' },
    night: { color: '#6bffc1', emissive: '#1dffa0', glow: '#d0ffe9' },
  },
  ocean: {
    sunny: { color: '#ff4fa0', emissive: '#ff1a7a', glow: '#ffc6e0' },
    sunset: { color: '#c26bff', emissive: '#9b3dff', glow: '#ead6ff' },
    night: { color: '#ff5cd6', emissive: '#ff2bc0', glow: '#ffd1f3' },
  },
};
