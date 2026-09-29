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

/**
 * Tropical Ocean colours per sky: the water surface (turquoise shallows → deep blue, what it
 * reflects, glint strength) and the look below it. Underwater is always clearly water, blue-teal
 * and darker/bluer with depth; the sky only tints it slightly (warmer at sunset, deep navy with
 * bioluminescence at night). One table, read by the engine (and the landing's surface colours).
 */
export interface OceanLook {
  waterShallow: string;
  waterMid: string;
  waterDeep: string;
  /** What the water reflects at grazing angles (close to the horizon haze). */
  waterReflect: string;
  glint: number;
  /** Tint the distant horizon silhouettes deepen toward, and how strongly. */
  horizonTint: string;
  horizonStrength: number;
  /** Fog/background just below the surface and near the seabed (lerped by camera depth). */
  underwaterShallow: string;
  underwaterDeep: string;
  underwaterDensityShallow: number;
  underwaterDensityDeep: number;
  underwaterHemiSky: string;
  underwaterHemiGround: string;
  underwaterHemiIntensity: number;
  underwaterAmbient: string;
  underwaterAmbientIntensity: number;
  underwaterSunIntensity: number;
  /** The surface seen from below: outside and inside the Snell's window. */
  undersideDeep: string;
  undersideWindow: string;
  caustics: number;
  causticColor: string;
  shaftColor: string;
  shaftIntensity: number;
  snowColor: string;
  /** Bioluminescence (0..1): glowing reef tips, jellyfish and plankton. */
  glow: number;
  glowColor: string;
}

export const OCEAN_LOOKS: Record<WeatherPreset, OceanLook> = {
  sunny: {
    waterShallow: '#5fe0d2',
    waterMid: '#1fa6bf',
    waterDeep: '#0c5a92',
    waterReflect: '#c9ebf3',
    glint: 1,
    horizonTint: '#4f7f86',
    horizonStrength: 0.5,
    underwaterShallow: '#1f93b5',
    underwaterDeep: '#0b4a7c',
    underwaterDensityShallow: 0.022,
    underwaterDensityDeep: 0.03,
    underwaterHemiSky: '#9fe8f7',
    underwaterHemiGround: '#0e4262',
    underwaterHemiIntensity: 1.4,
    underwaterAmbient: '#a8ecff',
    underwaterAmbientIntensity: 0.7,
    underwaterSunIntensity: 0.95,
    undersideDeep: '#1a7ea0',
    undersideWindow: '#d9fbff',
    caustics: 1.1,
    causticColor: '#e8fdff',
    shaftColor: '#d8fbff',
    shaftIntensity: 0.26,
    snowColor: '#e6fbff',
    glow: 0,
    glowColor: '#5ff6ff',
  },
  sunset: {
    waterShallow: '#58c9bf',
    waterMid: '#2a8fae',
    waterDeep: '#1b4d80',
    waterReflect: '#ffc49c',
    glint: 1.25,
    horizonTint: '#7a5a78',
    horizonStrength: 0.45,
    // Still blue-teal, only nudged warm.
    underwaterShallow: '#2a8aa6',
    underwaterDeep: '#12426f',
    underwaterDensityShallow: 0.023,
    underwaterDensityDeep: 0.031,
    underwaterHemiSky: '#c2e2d6',
    underwaterHemiGround: '#123c58',
    underwaterHemiIntensity: 1.3,
    underwaterAmbient: '#bfe2dc',
    underwaterAmbientIntensity: 0.65,
    underwaterSunIntensity: 0.8,
    undersideDeep: '#1f7894',
    undersideWindow: '#ffe6c8',
    caustics: 0.9,
    causticColor: '#ffe7c4',
    shaftColor: '#ffe9cc',
    shaftIntensity: 0.22,
    snowColor: '#f2f4ea',
    glow: 0.12,
    glowColor: '#6ff2ff',
  },
  night: {
    waterShallow: '#1c6a78',
    waterMid: '#0f3f5e',
    waterDeep: '#071d3a',
    waterReflect: '#1c2c52',
    glint: 0.7,
    horizonTint: '#0a1226',
    horizonStrength: 0.6,
    underwaterShallow: '#0b3358',
    underwaterDeep: '#041532',
    underwaterDensityShallow: 0.026,
    underwaterDensityDeep: 0.034,
    underwaterHemiSky: '#4d74b8',
    underwaterHemiGround: '#06142c',
    underwaterHemiIntensity: 0.85,
    underwaterAmbient: '#5f7cc4',
    underwaterAmbientIntensity: 0.42,
    underwaterSunIntensity: 0.25,
    undersideDeep: '#0a2a4c',
    undersideWindow: '#6f8fc8',
    caustics: 0.35,
    causticColor: '#b6ccff',
    shaftColor: '#9fb8ff',
    shaftIntensity: 0.09,
    snowColor: '#9fc4ff',
    glow: 1,
    glowColor: '#4ff8ff',
  },
};
