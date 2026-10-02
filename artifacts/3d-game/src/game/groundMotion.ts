// Moving on the ground and on the water: walking, turning, stepping up and down, jumping, falling
// off ledges, wading in and paddling out. Pure (no three.js, no DOM): it moves a point over a
// `LandingSurfaces`, so the unit tests drive it over analytic slopes, cliffs and beaches. The engine
// copies the result onto the bird and runs the animation; birdState.ts decides the mode changes
// from the events reported here.
import { turnAuthority } from './flightModel';
import {
  JUMP_FLUTTER_SPEED,
  JUMP_GRAVITY,
  LEDGE_DROP,
  LEDGE_PROBE,
  MAX_GROUND_SLOPE_DEG,
  MAX_STEP_UP,
  PADDLE_BACK_SPEED,
  PADDLE_SPEED,
  PADDLE_TURN_RATE_DEG,
  STEP_DOWN_FALL,
  WALK_ACCEL,
  WALK_BACK_SPEED,
  WALK_SPEED,
  WALK_TURN_RATE_DEG,
} from './flightTuning';
import {
  createFootprint,
  createSurfaceSample,
  isLandable,
  sampleFootprint,
  type LandingSurfaces,
} from './landingSurface';

const DEG = Math.PI / 180;
const MAX_GRADE = Math.tan(MAX_GROUND_SLOPE_DEG * DEG);

/** What a step did that may change the bird's mode (see BirdStateMachine). */
export type GroundEvent =
  /** Came down from a jump or a hop onto standable ground. */
  | 'landed'
  /** Came down from a jump into deep water: float. */
  | 'landed-water'
  /** Came down somewhere it can't stand (too steep, an edge): flap off into flight. */
  | 'landed-unstandable'
  /** Walked off a drop deeper than LEDGE_DROP: glide off into flight. */
  | 'ledge'
  /** Walked from the beach into water deep enough to float. */
  | 'enter-water'
  /** Paddled onto a beach shallow and gentle enough to stand on. */
  | 'exit-water';

export interface GroundInput {
  /** −1..1: forward (+) or back (−). */
  walk: number;
  /** −1..1: turn right (+) or left (−). */
  turn: number;
  sensitivity: number;
}

/** Where the bird is, on the ground or the water (or in the air during a jump). */
export interface GroundBody {
  x: number;
  z: number;
  /** Heading, same convention as the engine's headingYaw: forward is (sin h, 0, cos h); right turns lower it. */
  heading: number;
  /** Height of the feet (on water: of the water surface the bird rests on). */
  feetY: number;
  /** Vertical speed while airborne. */
  vy: number;
  /** Signed forward speed (m/s). */
  speed: number;
  /** Turn rate this step (rad/s, positive = right). */
  turnRate: number;
  airborne: boolean;
  /** The last step was stopped by a slope too steep or a step too high. */
  blocked: boolean;
}

export type GroundMedium = 'ground' | 'water';

export class GroundWalker {
  readonly body: GroundBody = { x: 0, z: 0, heading: 0, feetY: 0, vy: 0, speed: 0, turnRate: 0, airborne: false, blocked: false };
  private footprint = createFootprint();
  private sample = createSurfaceSample();

  constructor(private surfaces: LandingSurfaces) {}

  /** Puts the bird on the surface at (x, z), standing still. */
  place(x: number, z: number, heading: number) {
    const b = this.body;
    b.x = x;
    b.z = z;
    b.heading = heading;
    b.vy = 0;
    b.speed = 0;
    b.turnRate = 0;
    b.airborne = false;
    b.blocked = false;
    b.feetY = this.surfaces.sample(x, z, this.sample).height;
  }

  /** Leaves the ground with upward speed `vy` (a jump or the ground backflip). */
  jump(vy: number) {
    this.body.airborne = true;
    this.body.vy = vy;
  }

  /** The surface under the body right now (kind, height, normal). Reused object. */
  surfaceUnder() {
    return this.surfaces.sample(this.body.x, this.body.z, this.sample);
  }

  /**
   * One step on `medium` (ground or water). Turns and walks (or paddles) from the input, follows the
   * surface, refuses slopes over 30° and steps higher than MAX_STEP_UP without jittering (it just
   * stops), drops off small steps, and reports leaving or entering the water, walking off a ledge,
   * and landing from a jump. Allocation-free.
   */
  step(dt: number, input: GroundInput, medium: GroundMedium): GroundEvent | null {
    const b = this.body;
    const floating = medium === 'water';
    const authority = turnAuthority(input.sensitivity);
    const turnInput = Math.max(-1, Math.min(1, input.turn));
    b.turnRate = turnInput * (floating ? PADDLE_TURN_RATE_DEG : WALK_TURN_RATE_DEG) * DEG * authority;
    b.heading -= b.turnRate * dt;

    const walk = Math.max(-1, Math.min(1, input.walk));
    const forwardSpeed = floating ? PADDLE_SPEED : WALK_SPEED;
    const backSpeed = floating ? PADDLE_BACK_SPEED : WALK_BACK_SPEED;
    const target = walk >= 0 ? walk * forwardSpeed : walk * backSpeed;
    const maxChange = WALK_ACCEL * dt;
    b.speed += Math.max(-maxChange, Math.min(maxChange, target - b.speed));

    const nx = b.x + Math.sin(b.heading) * b.speed * dt;
    const nz = b.z + Math.cos(b.heading) * b.speed * dt;
    b.blocked = false;

    if (b.airborne) return this.stepAirborne(dt, nx, nz);

    const footprint = sampleFootprint(this.surfaces, nx, nz, this.footprint);
    const ahead = footprint.center;
    if (floating) {
      if (ahead.kind === 'ground') {
        // Paddling onto land: only a beach (shallow and gentle) — not a cliff or a rock face.
        if (ahead.height - b.feetY <= MAX_STEP_UP && isLandable(footprint)) {
          this.moveTo(nx, nz, ahead.height);
          return 'exit-water';
        }
        this.stop();
        return null;
      }
      this.moveTo(nx, nz, ahead.height);
      return null;
    }

    if (ahead.kind === 'water') {
      this.moveTo(nx, nz, ahead.height);
      return 'enter-water';
    }
    const rise = ahead.height - b.feetY;
    const distance = Math.hypot(nx - b.x, nz - b.z);
    // A ledge: the ground a little ahead (in the direction of travel) is more than LEDGE_DROP down.
    if (b.speed > 0.05) {
      const probe = this.surfaces.sample(nx + Math.sin(b.heading) * LEDGE_PROBE, nz + Math.cos(b.heading) * LEDGE_PROBE, this.sample);
      if (probe.kind === 'ground' && b.feetY - probe.height > LEDGE_DROP) {
        this.moveTo(nx, nz, b.feetY);
        return 'ledge';
      }
    }
    if (rise > 0 && distance > 1e-6 && (rise > MAX_STEP_UP || rise / distance > MAX_GRADE)) {
      // Too steep or too high a step: stop where it is (no clipping, no jitter).
      this.stop();
      return null;
    }
    if (-rise > LEDGE_DROP) {
      this.moveTo(nx, nz, b.feetY);
      return 'ledge';
    }
    if (-rise > STEP_DOWN_FALL) {
      // A small drop (stepping off a rock): hop down and land.
      b.x = nx;
      b.z = nz;
      b.airborne = true;
      b.vy = 0;
      return null;
    }
    this.moveTo(nx, nz, ahead.height);
    return null;
  }

  private stepAirborne(dt: number, nx: number, nz: number): GroundEvent | null {
    const b = this.body;
    // Gravity, halved near the apex while the wings flutter.
    const gravity = Math.abs(b.vy) < JUMP_FLUTTER_SPEED ? JUMP_GRAVITY * 0.5 : JUMP_GRAVITY;
    b.vy -= gravity * dt;
    b.feetY += b.vy * dt;
    // Can't move into ground that's above the feet (a wall, a ledge face): no clipping.
    const ahead = this.surfaces.sample(nx, nz, this.sample);
    if (ahead.height > b.feetY) {
      b.blocked = true;
      b.speed = 0;
    } else {
      b.x = nx;
      b.z = nz;
    }
    if (b.vy > 0) return null;
    const under = this.surfaces.sample(b.x, b.z, this.sample);
    if (b.feetY > under.height) return null;
    // Down on whatever is below. A hop is judged on the ground under the feet only (not the
    // footprint a landing approach needs): coming down beside a rock or at the foot of a wall is
    // fine, only a slope too steep to stand on takes off into a glide.
    b.feetY = under.height;
    b.vy = 0;
    b.airborne = false;
    if (under.kind === 'water') return 'landed-water';
    return under.perch || under.slope <= MAX_GROUND_SLOPE_DEG ? 'landed' : 'landed-unstandable';
  }

  private moveTo(x: number, z: number, feetY: number) {
    const b = this.body;
    b.x = x;
    b.z = z;
    b.feetY = feetY;
  }

  private stop() {
    this.body.speed = 0;
    this.body.blocked = true;
  }
}
