import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AXIAL_HIT_THRESHOLD, RING_RADIUS, isRingHit, isRingPassed, ringFrame, selectNextRing } from './rings';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const PLUS_Z = v(0, 0, 1);

describe('ring hit test', () => {
  const ring = v(0, 20, 50);

  it('measures axial (along the normal) and radial distance', () => {
    const frame = ringFrame(ring, PLUS_Z, v(3, 24, 45));
    expect(frame.axial).toBeCloseTo(-5); // short of the ring's plane
    expect(frame.radial).toBeCloseTo(5);
  });

  it('hits inside the hoop, within the slab', () => {
    expect(isRingHit(ringFrame(ring, PLUS_Z, v(0, 20, 50)))).toBe(true);
    expect(isRingHit(ringFrame(ring, PLUS_Z, v(RING_RADIUS * 0.9, 20, 50 + AXIAL_HIT_THRESHOLD * 0.9)))).toBe(true);
    expect(isRingHit(ringFrame(ring, PLUS_Z, v(0, 20 - RING_RADIUS * 0.9, 50 - AXIAL_HIT_THRESHOLD * 0.9)))).toBe(true);
  });

  it('misses outside the hoop or outside the slab', () => {
    expect(isRingHit(ringFrame(ring, PLUS_Z, v(RING_RADIUS * 1.1, 20, 50)))).toBe(false);
    expect(isRingHit(ringFrame(ring, PLUS_Z, v(0, 20, 50 - AXIAL_HIT_THRESHOLD * 1.1)))).toBe(false);
  });

  it('works for a tilted ring', () => {
    const normal = v(1, 0, 1).normalize();
    expect(isRingHit(ringFrame(ring, normal, v(1, 21, 49)))).toBe(true);
    expect(isRingHit(ringFrame(ring, normal, v(4, 20, 46)))).toBe(false); // 4.2 off-axis
  });

  it('counts a ring as passed only once the bird is beyond its plane', () => {
    expect(isRingPassed(ringFrame(ring, PLUS_Z, v(10, 20, 40)))).toBe(false); // short of it
    expect(isRingPassed(ringFrame(ring, PLUS_Z, v(10, 20, 51)))).toBe(false); // inside the slab
    expect(isRingPassed(ringFrame(ring, PLUS_Z, v(10, 20, 53)))).toBe(true); // flew past beside it
  });
});

describe('selectNextRing', () => {
  const bird = v(0, 20, 0);
  const ring = (x: number, z: number, missed = false) => ({ position: v(x, 20, z), missed });

  it('picks the earliest-spawned ring ahead, not the nearest one', () => {
    // Spawn order: far ring first, then a nearer one (e.g. after a turn back toward it).
    const rings = [ring(0, 80), ring(5, 30)];
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(0);
  });

  it('skips missed rings', () => {
    const rings = [ring(0, 40, true), ring(10, 90)];
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(1);
  });

  it('skips rings behind the bird along its heading (after a sharp turn)', () => {
    const rings = [ring(0, -30), ring(2, -60), ring(0, 45)];
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(2);
    // Turned around: the first two are ahead again, and the earliest wins.
    expect(selectNextRing(rings, bird, v(0, 0, -1))).toBe(0);
  });

  it('keeps a ring being threaded (level with the bird, off to the side) as the target', () => {
    const rings = [ring(3, -1), ring(0, 60)];
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(0);
  });

  it('uses the horizontal heading, so pitching steeply does not drop a ring ahead', () => {
    const diving = v(0, -Math.sin(0.66), Math.cos(0.66)); // 38° nose down
    // Well above and a little ahead: "behind" along the 3D forward, ahead along the heading.
    const above = { position: v(0, 60, 10), missed: false };
    expect(above.position.clone().sub(bird).dot(diving)).toBeLessThan(0);
    expect(selectNextRing([above], bird, diving)).toBe(0);
  });

  it('returns -1 when nothing is ahead', () => {
    expect(selectNextRing([ring(0, -20), ring(0, 30, true)], bird, PLUS_Z)).toBe(-1);
    expect(selectNextRing([], bird, PLUS_Z)).toBe(-1);
  });

  it('moves on to the following ring once the target is collected or missed', () => {
    const rings = [ring(0, 40), ring(-12, 100), ring(8, 160)];
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(0);
    rings[0].missed = true; // flew past it
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(1);
    rings.splice(1, 1); // collected (removed from the active list)
    expect(selectNextRing(rings, bird, PLUS_Z)).toBe(1);
  });
});
