// What the bird can land and stand on, and the landing envelope. Pure (no three.js, no DOM): the
// engine builds a `LandingSurfaces` over each map's height field, and the unit tests build them over
// analytic ones (flat, slopes, cliffs, a beach meeting the sea).
//
// v1 surfaces: any ground above water with a slope ≤ MAX_GROUND_SLOPE_DEG (valley floor, hilltops,
// ledges, island beaches and grass), the tops of the islands' shore rocks (precomputed from their
// instance data, see `PerchPoint`), and the sea itself (the bird floats on the waves). Trees, the
// seabed and landing underwater are out of scope; trees can plug in later as perches.
import {
  FOOTPRINT_MAX_STEP,
  FOOTPRINT_RADIUS,
  LANDING_MAX_AGL,
  LANDING_MAX_CLIMB_DEG,
  LANDING_MAX_DESCENT_DEG,
  LANDING_SPEED_MARGIN,
  MAX_GROUND_SLOPE_DEG,
  MIN_FLOAT_DEPTH,
} from './flightTuning';

export type SurfaceKind = 'ground' | 'water';

/** The surface under one point: what it is, its height, normal and slope. Reused, never allocated per frame. */
export interface SurfaceSample {
  kind: SurfaceKind;
  /** Top of the surface: ground (or a perch), or the animated water. */
  height: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  /** Degrees from horizontal (water is always 0). */
  slope: number;
  /** Standing on a perch (a rock top), not the height field. */
  perch: PerchPoint | null;
}

export function createSurfaceSample(): SurfaceSample {
  return { kind: 'ground', height: 0, normalX: 0, normalY: 1, normalZ: 0, slope: 0, perch: null };
}

/**
 * Something to stand on that isn't the height field: a flat-topped disc. Rock tops on the ocean map
 * today (computed once per island from the rocks' own instance matrices); tree branches can join
 * later (the Mountain Valley upgrade) without touching the landing logic.
 */
export interface PerchPoint {
  x: number;
  y: number;
  z: number;
  /** Standable radius around (x, z). */
  radius: number;
  kind: 'rock' | 'branch';
}

/** One map's surfaces, for landing, standing, walking and floating. */
export interface LandingSurfaces {
  /** Fills `out` with the top surface at (x, z) and returns it. */
  sample(x: number, z: number, out: SurfaceSample): SurfaceSample;
}

export interface HeightFieldSurfaceOptions {
  /** Solid ground height at a vertex of the map's tile grid (terrain, island, seabed). */
  ground: (x: number, z: number) => number;
  /**
   * Spacing of the map's ground-tile vertices (world units). The ground is drawn as triangles between
   * vertices on this grid, so standing height and slope are read from the same triangle the GPU draws,
   * not the smooth height function (which differs by up to ~2 m on an island's dome).
   */
  gridSpacing: number;
  /** The water surface where the bird would float (null: no sea on this map). */
  water?: ((x: number, z: number) => number) | null;
  /** Perches whose disc might cover (x, z). */
  perches?: ((x: number, z: number) => readonly PerchPoint[]) | null;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * The ground as drawn: (x, z) is located in its grid cell, and the height is interpolated on the
 * cell's triangle the way PlaneGeometry triangulates it, (a, b, d) and (b, c, d), split along the
 * diagonal from (x0, z1) to (x1, z0). Writes the triangle's normal into `out` (flat shading: exact).
 */
export function meshGroundHeight(
  ground: (x: number, z: number) => number,
  spacing: number,
  x: number,
  z: number,
  out?: SurfaceSample,
) {
  const cx = Math.floor(x / spacing);
  const cz = Math.floor(z / spacing);
  const x0 = cx * spacing;
  const z0 = cz * spacing;
  const tx = (x - x0) / spacing;
  const tz = (z - z0) / spacing;
  const hb = ground(x0, z0 + spacing);
  const hd = ground(x0 + spacing, z0);
  let height: number;
  // Height differences along the cell's x and z edges of the triangle the point is in.
  let gx: number;
  let gz: number;
  if (tx + tz <= 1) {
    const ha = ground(x0, z0);
    gx = hd - ha;
    gz = hb - ha;
    height = ha + gx * tx + gz * tz;
  } else {
    const hc = ground(x0 + spacing, z0 + spacing);
    gx = hc - hb;
    gz = hc - hd;
    height = hc - gx * (1 - tx) - gz * (1 - tz);
  }
  if (out) {
    // The plane y = h + gx·(x/spacing) + gz·(z/spacing) has the normal (−gx, spacing, −gz).
    const length = Math.hypot(gx, spacing, gz);
    out.normalX = -gx / length;
    out.normalY = spacing / length;
    out.normalZ = -gz / length;
    out.slope = Math.acos(Math.min(1, out.normalY)) * RAD_TO_DEG;
  }
  return height;
}

/** LandingSurfaces over a tile-grid height field, an optional sea and optional perches. */
export function heightFieldSurfaces({
  ground,
  gridSpacing,
  water = null,
  perches = null,
}: HeightFieldSurfaceOptions): LandingSurfaces {
  return {
    sample(x, z, out) {
      out.perch = null;
      out.kind = 'ground';
      const h = meshGroundHeight(ground, gridSpacing, x, z, out);
      out.height = h;
      if (water) {
        const w = water(x, z);
        if (w - h >= MIN_FLOAT_DEPTH) {
          out.kind = 'water';
          out.height = w;
          out.normalX = 0;
          out.normalY = 1;
          out.normalZ = 0;
          out.slope = 0;
        }
      }
      // A rock standing out of the sea or off the beach is a perch.
      return applyPerch(perches, x, z, out.height, out);
    },
  };
}

function applyPerch(
  perches: HeightFieldSurfaceOptions['perches'],
  x: number,
  z: number,
  below: number,
  out: SurfaceSample,
) {
  if (!perches) return out;
  let best: PerchPoint | null = null;
  for (const perch of perches(x, z)) {
    const dx = x - perch.x;
    const dz = z - perch.z;
    if (dx * dx + dz * dz > perch.radius * perch.radius || perch.y <= below) continue;
    if (!best || perch.y > best.y) best = perch;
  }
  if (best) {
    out.kind = 'ground';
    out.height = best.y;
    out.normalX = 0;
    out.normalY = 1;
    out.normalZ = 0;
    out.slope = 0;
    out.perch = best;
  }
  return out;
}

/** The center and four footprint points around (x, z): what a landing or a step is judged on. */
export interface Footprint {
  center: SurfaceSample;
  points: [SurfaceSample, SurfaceSample, SurfaceSample, SurfaceSample];
  /** Highest minus lowest of the five heights. */
  step: number;
  /** Lowest of the five heights. */
  lowest: number;
  /**
   * How far the outer points stray from the plane through the center (its own slope): 0 on any
   * even slope, large at a cliff edge, a ledge or a rock rising inside the footprint.
   */
  deviation: number;
}

export function createFootprint(): Footprint {
  return {
    center: createSurfaceSample(),
    points: [createSurfaceSample(), createSurfaceSample(), createSurfaceSample(), createSurfaceSample()],
    step: 0,
    lowest: 0,
    deviation: 0,
  };
}

const OFFSETS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Samples the footprint (center + 4 points FOOTPRINT_RADIUS out) into `out`. Allocation-free. */
export function sampleFootprint(surfaces: LandingSurfaces, x: number, z: number, out: Footprint, radius = FOOTPRINT_RADIUS) {
  surfaces.sample(x, z, out.center);
  surfaces.sample(x + radius, z, out.points[0]);
  surfaces.sample(x - radius, z, out.points[1]);
  surfaces.sample(x, z + radius, out.points[2]);
  surfaces.sample(x, z - radius, out.points[3]);
  let lo = out.center.height;
  let hi = out.center.height;
  for (const point of out.points) {
    lo = Math.min(lo, point.height);
    hi = Math.max(hi, point.height);
  }
  out.step = hi - lo;
  out.lowest = lo;
  // The plane through the center along its normal: h = hc − (nx·dx + nz·dz) / ny.
  const c = out.center;
  let deviation = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ox, oz] = OFFSETS[i];
    const predicted = c.height - ((c.normalX * ox + c.normalZ * oz) * radius) / c.normalY;
    deviation = Math.max(deviation, Math.abs(out.points[i].height - predicted));
  }
  out.deviation = deviation;
  return out;
}

/** Can the bird stand or float on this footprint: gentle slope, no cliff edge under it? */
export function isLandable(footprint: Footprint) {
  // A rock top is flat and the bird's feet fit on it; the footprint's outer points fall off its edge.
  if (footprint.center.perch) return true;
  if (footprint.center.kind === 'water') {
    // Floating: the water under the center is enough, unless a cliff or rock rises inside the footprint.
    return footprint.deviation <= FOOTPRINT_MAX_STEP;
  }
  return footprint.center.slope <= MAX_GROUND_SLOPE_DEG && footprint.deviation <= FOOTPRINT_MAX_STEP;
}

export interface LandingEnvelopeInput {
  braking: boolean;
  underwater: boolean;
  /** A barrel roll or backflip is in progress. */
  trick: boolean;
  /** Airspeed (m/s) and the brake's target speed. */
  speed: number;
  brakeSpeed: number;
  /** Flight path angle in radians (negative = descending). */
  pathAngle: number;
  /** Height of the bird's feet above the surface under its center. */
  agl: number;
  footprint: Footprint;
}

export type EnvelopeFailure =
  | 'not-braking'
  | 'underwater'
  | 'trick'
  | 'too-high'
  | 'too-fast'
  | 'diving'
  | 'climbing'
  | 'too-steep'
  | 'edge';

export interface LandingEnvelope {
  /** Every condition holds: the landing starts. */
  ok: boolean;
  /** The surface below is one the bird could land on (slope and footprint), whatever else fails. */
  landable: boolean;
  /** The first condition that fails (null when ok). */
  failure: EnvelopeFailure | null;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * The landing envelope: intent (the brake held) and a safe approach — low (≤ LANDING_MAX_AGL), slow
 * (≤ brake speed + margin), not diving or climbing hard, over a gentle slope with no cliff edge in
 * the footprint, not underwater and not mid-trick. Skimming fast without braking never lands.
 */
export function evaluateLandingEnvelope(input: LandingEnvelopeInput, out?: LandingEnvelope): LandingEnvelope {
  const result = out ?? { ok: false, landable: false, failure: null };
  result.landable = isLandable(input.footprint);
  result.ok = false;
  result.failure = envelopeFailure(input, result.landable);
  result.ok = result.failure === null;
  return result;
}

function envelopeFailure(input: LandingEnvelopeInput, landable: boolean): EnvelopeFailure | null {
  if (input.underwater) return 'underwater';
  if (input.trick) return 'trick';
  if (input.footprint.center.kind === 'ground' && !input.footprint.center.perch && input.footprint.center.slope > MAX_GROUND_SLOPE_DEG) {
    return 'too-steep';
  }
  if (!landable) return 'edge';
  if (input.agl > LANDING_MAX_AGL) return 'too-high';
  if (input.pathAngle < -LANDING_MAX_DESCENT_DEG * DEG_TO_RAD) return 'diving';
  if (input.pathAngle > LANDING_MAX_CLIMB_DEG * DEG_TO_RAD) return 'climbing';
  if (input.speed > input.brakeSpeed + LANDING_SPEED_MARGIN) return 'too-fast';
  if (!input.braking) return 'not-braking';
  return null;
}
