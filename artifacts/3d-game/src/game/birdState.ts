// The bird's locomotion state machine: FLYING → FLARE → TOUCHDOWN → GROUNDED (or FLOATING on
// water) → TAKEOFF → FLYING. Pure (no three.js, no DOM): it only decides *when* to change state, from
// the inputs and a few facts the engine measures (the landing envelope, what's under the bird); the
// engine does the physics and the animation for whichever state it's in. Unit-tested on its own.
import {
  FLARE_MAX_DURATION,
  FLARE_MIN_DURATION,
  FLARE_SINK_SPEED,
  TAKEOFF_DURATION,
  TOUCHDOWN_DURATION,
  WATER_TAKEOFF_RUN,
} from './flightTuning';
import type { SurfaceKind } from './landingSurface';

export type BirdMode = 'FLYING' | 'FLARE' | 'TOUCHDOWN' | 'GROUNDED' | 'FLOATING' | 'TAKEOFF';

/** What changed on a step, for the engine's sounds, particles and HUD. */
export type BirdEvent =
  /** FLYING → FLARE: the landing began. */
  | 'flare'
  /** FLARE → FLYING: the approach broke (brake released, surface ended or too steep). */
  | 'go-around'
  /** FLARE → TOUCHDOWN: feet (or belly) on the surface. */
  | 'touchdown'
  /** TOUCHDOWN → GROUNDED / FLOATING. */
  | 'settled'
  /** GROUNDED / FLOATING → TAKEOFF. */
  | 'takeoff'
  /** TAKEOFF → FLYING. */
  | 'airborne';

export interface BirdStepInput {
  /** The air brake is held. */
  brake: boolean;
  /** The boost input (Space / fist), as a level; the machine finds its edges. */
  boost: boolean;
  /** The input's own hold-to-take-off gesture has been held long enough (Space 0.4 s, palm raised 0.5 s). */
  takeoffHold: boolean;
  /** FLYING: every landing envelope condition holds (see evaluateLandingEnvelope). */
  envelopeOk: boolean;
  /** FLARE: the approach is still good (brake held, the spot ahead still landable). */
  approachOk: boolean;
  /** Height of the feet above the surface (for the flare's length). */
  agl: number;
  /** What's under the bird. */
  surface: SurfaceKind;
}

/** The flare stretches with height so the final descent is never faster than FLARE_SINK_SPEED. */
export function flareDuration(agl: number) {
  return Math.min(FLARE_MAX_DURATION, Math.max(FLARE_MIN_DURATION, agl / FLARE_SINK_SPEED));
}

/** Takeoff length: a jump and strong flaps from the ground, a run along the surface first from water. */
export function takeoffDuration(from: SurfaceKind) {
  return from === 'water' ? WATER_TAKEOFF_RUN + TAKEOFF_DURATION * 0.8 : TAKEOFF_DURATION;
}

export class BirdStateMachine {
  mode: BirdMode = 'FLYING';
  /** Seconds in the current mode. */
  time = 0;
  /** Length of the current flare or takeoff. */
  duration = 0;
  /** The surface the bird is on (or touched down on, or is taking off from). */
  surface: SurfaceKind = 'ground';
  private boostWasHeld = false;
  /** prefers-reduced-motion: shorter scripted transitions (the touchdown settle). */
  reducedMotion = false;

  /** Boost, the barrel roll and the flying backflip only exist in FLYING. */
  allowsFlightTricks() {
    return this.mode === 'FLYING';
  }

  /** The flight controls (steering, speed) drive the bird; everything else is scripted or ground. */
  isFlying() {
    return this.mode === 'FLYING';
  }

  /** Standing, floating, or in a scripted landing/takeoff. */
  isOnSurface() {
    return this.mode === 'GROUNDED' || this.mode === 'FLOATING' || this.mode === 'TOUCHDOWN';
  }

  private enter(mode: BirdMode, duration = 0) {
    this.mode = mode;
    this.time = 0;
    this.duration = duration;
  }

  /**
   * Advances by `dt` seconds. Returns the transition that happened, if any (at most one per step).
   * A zero `dt` (or simply not calling it, as while paused) changes nothing.
   */
  step(dt: number, input: BirdStepInput): BirdEvent | null {
    if (dt <= 0) return null;
    this.time += dt;
    const boostPressed = input.boost && !this.boostWasHeld;
    this.boostWasHeld = input.boost;

    switch (this.mode) {
      case 'FLYING':
        if (input.envelopeOk) {
          this.enter('FLARE', flareDuration(input.agl));
          this.surface = input.surface;
          return 'flare';
        }
        return null;
      case 'FLARE':
        if (!input.approachOk) {
          this.enter('FLYING');
          return 'go-around';
        }
        this.surface = input.surface;
        if (this.time >= this.duration) {
          this.enter('TOUCHDOWN', TOUCHDOWN_DURATION * (this.reducedMotion ? 0.5 : 1));
          return 'touchdown';
        }
        return null;
      case 'TOUCHDOWN':
        if (this.time >= this.duration) {
          this.enter(this.surface === 'water' ? 'FLOATING' : 'GROUNDED');
          return 'settled';
        }
        return null;
      case 'GROUNDED':
      case 'FLOATING': {
        // Floating: a tap of the boost input (Space / the fist) also starts the takeoff run.
        const tapOffWater = this.mode === 'FLOATING' && boostPressed;
        if (input.takeoffHold || tapOffWater) {
          this.surface = this.mode === 'FLOATING' ? 'water' : 'ground';
          this.enter('TAKEOFF', takeoffDuration(this.surface));
          return 'takeoff';
        }
        return null;
      }
      case 'TAKEOFF':
        if (this.time >= this.duration) {
          this.enter('FLYING');
          return 'airborne';
        }
        return null;
    }
  }
}
