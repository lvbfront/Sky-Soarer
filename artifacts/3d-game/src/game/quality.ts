// Graphics quality: the player's setting (Auto / High / Low, chosen in the pause menu) and the
// level actually rendered. Auto starts at High and drops to Low for the rest of the flight when
// the average frame rate stays under AUTO_MIN_FPS for AUTO_WINDOW_SECONDS. Pure (no three.js, no
// DOM) so the pause menu can import it without pulling in the engine, and Vitest can test it.

export type QualitySetting = 'auto' | 'high' | 'low';
export type QualityLevel = 'high' | 'low';

export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'high', 'low'];

export interface QualityProfile {
  /** Renderer pixel ratio cap (the device pixel ratio is used up to this). */
  pixelRatioCap: number;
  /** Fraction of reef items drawn (each item has a fixed random rank, so Low keeps a subset). */
  reefDensity: number;
  /** Reef items are only drawn within this horizontal distance of the bird (fog hides beyond ~60). */
  reefRadius: number;
  /** Fraction of each fish school that swims. */
  fishDensity: number;
  marineSnow: number;
  lightShafts: number;
  caustics: boolean;
  waterSegments: number;
  shadowMapSize: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  high: {
    pixelRatioCap: 2,
    reefDensity: 1,
    reefRadius: 62,
    fishDensity: 1,
    marineSnow: 700,
    lightShafts: 8,
    caustics: true,
    waterSegments: 128,
    shadowMapSize: 1024,
  },
  low: {
    pixelRatioCap: 1,
    reefDensity: 0.5,
    reefRadius: 50,
    fishDensity: 0.55,
    marineSnow: 260,
    lightShafts: 4,
    caustics: false,
    waterSegments: 80,
    shadowMapSize: 512,
  },
};

export const AUTO_MIN_FPS = 50;
export const AUTO_WINDOW_SECONDS = 4;
// Ignore the first seconds of a flight (shader compiles, streaming the first tiles, the takeoff
// swoop) before judging the frame rate.
export const AUTO_WARMUP_SECONDS = 3;
// A single frame longer than this is a hitch (tab switch, GC, a compile), not the sustained frame
// rate, and is left out of the average.
const MAX_SAMPLE_SECONDS = 0.25;

export function levelFor(setting: QualitySetting, autoLevel: QualityLevel): QualityLevel {
  return setting === 'auto' ? autoLevel : setting;
}

/**
 * Decides when Auto should drop to Low. Feed it every rendered frame's real (unclamped) duration;
 * `sample` returns true once, on the frame the rolling average over the window falls below the
 * threshold. Call `reset` after a pause or a big scene change so those frames don't count.
 */
export class AutoQualityMonitor {
  private warmup = AUTO_WARMUP_SECONDS;
  private windowTime = 0;
  private windowFrames = 0;
  private dropped = false;

  constructor(
    private readonly minFps = AUTO_MIN_FPS,
    private readonly windowSeconds = AUTO_WINDOW_SECONDS,
  ) {}

  reset(warmupSeconds = 1) {
    this.warmup = Math.max(this.warmup, warmupSeconds);
    this.windowTime = 0;
    this.windowFrames = 0;
  }

  hasDropped() {
    return this.dropped;
  }

  sample(frameSeconds: number): boolean {
    if (this.dropped || !(frameSeconds > 0)) return false;
    if (this.warmup > 0) {
      this.warmup -= Math.min(frameSeconds, MAX_SAMPLE_SECONDS);
      return false;
    }
    if (frameSeconds > MAX_SAMPLE_SECONDS) return false;
    this.windowTime += frameSeconds;
    this.windowFrames += 1;
    if (this.windowTime < this.windowSeconds) return false;
    const fps = this.windowFrames / this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;
    if (fps < this.minFps) {
      this.dropped = true;
      return true;
    }
    return false;
  }
}
