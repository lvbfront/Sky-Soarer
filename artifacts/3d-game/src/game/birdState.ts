// The bird's locomotion state machine: FLYING → FLARE → TOUCHDOWN → GROUNDED (or FLOATING on
// water) → TAKEOFF → FLYING, with GROUNDED's substates (IDLE, WALK, TURN, JUMP, GROUND_FLIP) and
// FLOATING's (IDLE, PADDLE). Pure (no three.js, no DOM): it only decides *when* to change state, from
// the inputs and a few facts the engine measures (the landing envelope, what's under the bird, what
// the ground walker reported); the engine does the physics and the animation for whichever state
// it's in. Unit-tested on its own.
import type { GroundEvent } from './groundMotion';
import {
  GROUND_FLIP_COOLDOWN,
  FLARE_MAX_DURATION,
  FLARE_MIN_DURATION,
  FLARE_SINK_SPEED,
  TAKEOFF_DURATION,
  TOUCHDOWN_DURATION,
  WATER_TAKEOFF_RUN,
} from './flightTuning';
import type { SurfaceKind } from './landingSurface';

export type BirdMode = 'FLYING' | 'FLARE' | 'TOUCHDOWN' | 'GROUNDED' | 'FLOATING' | 'TAKEOFF';
export type GroundSubstate = 'IDLE' | 'WALK' | 'TURN' | 'JUMP' | 'GROUND_FLIP';
export type FloatSubstate = 'IDLE' | 'PADDLE';
export type BirdSubstate = GroundSubstate | FloatSubstate | null;

// Inputs below this count as "centered" (no walking, no turning).
const INPUT_EPSILON = 0.06;

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
  | 'airborne'
  /** GROUNDED: a jump (the boost input), or the ground backflip (the backflip input). */
  | 'jump'
  | 'ground-flip'
  /** GROUNDED: back on its feet after a jump or a flip. */
  | 'jump-landed'
  /** GROUNDED → FLYING: walked off a ledge, or a jump came down somewhere unstandable. */
  | 'glide'
  /** GROUNDED ↔ FLOATING: waded into the sea, or paddled onto a beach. */
  | 'enter-water'
  | 'exit-water';

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
  /** GROUNDED / FLOATING: walk (or paddle) forward (+) or back (−), and turn. */
  walk: number;
  turn: number;
  /** One-shot: the backflip input (F / the upward flick). */
  backflip: boolean;
  /** What the ground walker reported this step (see GroundWalker.step). */
  ground: GroundEvent | null;
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
  /** GROUNDED / FLOATING substate (null in the other modes). */
  substate: BirdSubstate = null;
  /** Seconds in the current substate. */
  substateTime = 0;
  /** The current takeoff started in the air (the second press of a double jump): no crouch. */
  airStart = false;
  /** Seconds in the current mode. */
  time = 0;
  /** Length of the current flare or takeoff. */
  duration = 0;
  /** The surface the bird is on (or touched down on, or is taking off from). */
  surface: SurfaceKind = 'ground';
  private boostWasHeld = false;
  // Seconds since the last ground backflip began (its cooldown).
  private sinceFlip = Infinity;
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

  /** Airborne in a jump or a ground backflip. */
  isJumping() {
    return this.mode === 'GROUNDED' && (this.substate === 'JUMP' || this.substate === 'GROUND_FLIP');
  }

  private enter(mode: BirdMode, duration = 0) {
    this.mode = mode;
    this.time = 0;
    this.duration = duration;
    this.airStart = false;
    this.setSubstate(mode === 'GROUNDED' || mode === 'FLOATING' ? 'IDLE' : null);
  }

  private setSubstate(substate: BirdSubstate) {
    if (substate === this.substate) return;
    this.substate = substate;
    this.substateTime = 0;
  }

  private takeoff(from: SurfaceKind, airStart = false): BirdEvent {
    this.surface = from;
    this.enter('TAKEOFF', takeoffDuration(from));
    this.airStart = airStart;
    return 'takeoff';
  }

  /** GROUNDED: jumps, flips, the double-jump takeoff, ledges, wading in, and walk/turn/idle. */
  private stepGrounded(input: BirdStepInput, boostPressed: boolean): BirdEvent | null {
    const jumping = this.substate === 'JUMP' || this.substate === 'GROUND_FLIP';
    if (input.takeoffHold) return this.takeoff('ground', jumping);
    if (jumping) {
      // Pressed again while airborne from a jump: take off (double-jump style).
      if (this.substate === 'JUMP' && boostPressed) return this.takeoff('ground', true);
      switch (input.ground) {
        case 'landed':
          this.setSubstate('IDLE');
          return 'jump-landed';
        case 'landed-water':
          this.enter('FLOATING');
          this.surface = 'water';
          return 'enter-water';
        case 'landed-unstandable':
          this.enter('FLYING');
          return 'glide';
        default:
          return null;
      }
    }
    if (input.ground === 'ledge') {
      this.enter('FLYING');
      return 'glide';
    }
    if (input.ground === 'enter-water') {
      this.enter('FLOATING');
      this.surface = 'water';
      return 'enter-water';
    }
    if (boostPressed) {
      this.setSubstate('JUMP');
      return 'jump';
    }
    if (input.backflip && this.sinceFlip >= GROUND_FLIP_COOLDOWN) {
      this.sinceFlip = 0;
      this.setSubstate('GROUND_FLIP');
      return 'ground-flip';
    }
    if (Math.abs(input.walk) > INPUT_EPSILON) this.setSubstate('WALK');
    else if (Math.abs(input.turn) > INPUT_EPSILON) this.setSubstate('TURN');
    else this.setSubstate('IDLE');
    return null;
  }

  /**
   * Advances by `dt` seconds. Returns the transition that happened, if any (at most one per step).
   * A zero `dt` (or simply not calling it, as while paused) changes nothing.
   */
  step(dt: number, input: BirdStepInput): BirdEvent | null {
    if (dt <= 0) return null;
    this.time += dt;
    this.substateTime += dt;
    this.sinceFlip += dt;
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
        return this.stepGrounded(input, boostPressed);
      case 'FLOATING':
        // A tap of the boost input (Space / the fist), or the hold gesture, starts the takeoff run.
        // No jumping or flipping on water.
        if (input.takeoffHold || boostPressed) return this.takeoff('water');
        if (input.ground === 'exit-water') {
          this.enter('GROUNDED');
          this.surface = 'ground';
          return 'exit-water';
        }
        this.setSubstate(Math.abs(input.walk) > INPUT_EPSILON || Math.abs(input.turn) > INPUT_EPSILON ? 'PADDLE' : 'IDLE');
        return null;
      case 'TAKEOFF':
        if (this.time >= this.duration) {
          this.enter('FLYING');
          return 'airborne';
        }
        return null;
    }
  }
}
