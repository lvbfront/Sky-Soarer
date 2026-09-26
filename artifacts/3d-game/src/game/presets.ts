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
