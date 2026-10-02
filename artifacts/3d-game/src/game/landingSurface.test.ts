import { describe, expect, it } from 'vitest';
import {
  createFootprint,
  createSurfaceSample,
  evaluateLandingEnvelope,
  heightFieldSurfaces,
  isLandable,
  meshGroundHeight,
  sampleFootprint,
  type LandingEnvelopeInput,
  type PerchPoint,
} from './landingSurface';
import {
  FOOTPRINT_RADIUS,
  LANDING_MAX_AGL,
  LANDING_MAX_DESCENT_DEG,
  LANDING_SPEED_MARGIN,
  MAX_GROUND_SLOPE_DEG,
} from './flightTuning';

const DEG = Math.PI / 180;
const flat = heightFieldSurfaces({ ground: () => 2, gridSpacing: 5 });
/** A plane rising `deg` degrees along +x. */
const slope = (deg: number) => heightFieldSurfaces({ ground: (x) => Math.tan(deg * DEG) * x, gridSpacing: 5 });
/** A cliff: ground 10 m high for x < 0, 0 beyond. */
const cliff = heightFieldSurfaces({ ground: (x) => (x < 0 ? 10 : 0), gridSpacing: 0.25 });
/** A beach meeting the sea: ground falls 1 m per 10 m along +x, water at 0. */
const beach = heightFieldSurfaces({ ground: (x) => 2 - x * 0.1, gridSpacing: 1, water: () => 0 });

function envelope(overrides: Partial<LandingEnvelopeInput> = {}, surfaces = flat, x = 0, z = 0) {
  const footprint = sampleFootprint(surfaces, x, z, createFootprint());
  return evaluateLandingEnvelope({
    braking: true,
    underwater: false,
    trick: false,
    speed: 4.5,
    brakeSpeed: 4.5,
    pathAngle: -15 * DEG,
    agl: 3,
    footprint,
    ...overrides,
  });
}

describe('surfaces', () => {
  it('reads the ground as drawn: interpolated on the tile triangles, with their normal', () => {
    // A dome: the smooth function is higher between vertices than the triangles drawn over it.
    const dome = (x: number, z: number) => 20 - (x * x + z * z) / 20;
    const sample = createSurfaceSample();
    const h = meshGroundHeight(dome, 5, 2.5, 1, sample);
    expect(h).toBeLessThan(dome(2.5, 1));
    // At a vertex it's exact; on a plane it's exact everywhere.
    expect(meshGroundHeight(dome, 5, 5, 5)).toBeCloseTo(dome(5, 5), 10);
    expect(meshGroundHeight((x, z) => 0.3 * x - 0.2 * z, 5, 1.7, 3.1)).toBeCloseTo(0.3 * 1.7 - 0.2 * 3.1, 10);
    expect(sample.normalY).toBeGreaterThan(0.9);
  });

  it('measures slope in degrees', () => {
    const sample = createSurfaceSample();
    expect(slope(20).sample(3, 3, sample).slope).toBeCloseTo(20, 5);
    expect(flat.sample(3, 3, sample).slope).toBeCloseTo(0, 5);
  });

  it('water deeper than the float depth is water; the shallows of a beach are ground', () => {
    const sample = createSurfaceSample();
    expect(beach.sample(10, 0, sample).kind).toBe('ground'); // 1 m above the sea
    expect(beach.sample(21, 0, sample).kind).toBe('ground'); // 0.1 m of water: wading
    expect(beach.sample(30, 0, sample).kind).toBe('water');
    expect(sample.height).toBe(0);
  });

  it('perches (rock tops) are standable discs above the ground or water', () => {
    const rock: PerchPoint = { x: 30, y: 1.2, z: 0, radius: 0.5, kind: 'rock' };
    const withRock = heightFieldSurfaces({ ground: (x) => 2 - x * 0.1, gridSpacing: 1, water: () => 0, perches: () => [rock] });
    const sample = createSurfaceSample();
    expect(withRock.sample(30.2, 0, sample)).toMatchObject({ kind: 'ground', height: 1.2, perch: rock });
    expect(withRock.sample(31, 0, sample).kind).toBe('water');
    const footprint = sampleFootprint(withRock, 30, 0, createFootprint());
    expect(isLandable(footprint)).toBe(true);
  });
});

describe('landing envelope', () => {
  it('lands when every condition holds', () => {
    expect(envelope()).toMatchObject({ ok: true, landable: true, failure: null });
  });

  it('never lands without the brake (skimming low and fast stays fun)', () => {
    expect(envelope({ braking: false })).toMatchObject({ ok: false, failure: 'not-braking' });
    expect(envelope({ braking: false, speed: 9, agl: 0.5 }).ok).toBe(false);
  });

  it('checks each condition', () => {
    expect(envelope({ agl: LANDING_MAX_AGL + 0.1 }).failure).toBe('too-high');
    expect(envelope({ agl: LANDING_MAX_AGL }).ok).toBe(true);
    expect(envelope({ speed: 4.5 + LANDING_SPEED_MARGIN + 0.1 }).failure).toBe('too-fast');
    expect(envelope({ pathAngle: -(LANDING_MAX_DESCENT_DEG + 1) * DEG }).failure).toBe('diving');
    expect(envelope({ pathAngle: 20 * DEG }).failure).toBe('climbing');
    expect(envelope({ underwater: true }).failure).toBe('underwater');
    expect(envelope({ trick: true }).failure).toBe('trick');
  });

  it('slope: lands up to 30°, not steeper', () => {
    expect(envelope({}, slope(MAX_GROUND_SLOPE_DEG - 2)).ok).toBe(true);
    expect(envelope({}, slope(MAX_GROUND_SLOPE_DEG + 2))).toMatchObject({ ok: false, failure: 'too-steep', landable: false });
  });

  it('footprint: rejects a cliff edge under any of its points', () => {
    // Center on the high side, an outer point over the drop.
    expect(envelope({}, cliff, -FOOTPRINT_RADIUS / 2)).toMatchObject({ ok: false, failure: 'edge' });
    // Well away from the edge on either side: fine.
    expect(envelope({}, cliff, -3).ok).toBe(true);
    expect(envelope({}, cliff, 3).ok).toBe(true);
  });

  it('water is landable (the bird floats); the shore is fine too', () => {
    expect(envelope({}, beach, 40).ok).toBe(true);
    expect(envelope({}, beach, 20).ok).toBe(true);
  });
});
