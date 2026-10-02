import { describe, expect, it } from 'vitest';
import { GroundWalker, type GroundEvent, type GroundMedium } from './groundMotion';
import { heightFieldSurfaces } from './landingSurface';
import {
  GROUND_FLIP_SPEED,
  JUMP_SPEED,
  LEDGE_DROP,
  PADDLE_SPEED,
  WALK_SPEED,
  WALK_TURN_RATE_DEG,
} from './flightTuning';

const DEG = Math.PI / 180;
const DT = 1 / 60;
/** A plane rising `deg` degrees along +z (the walker's forward at heading 0). */
const ramp = (deg: number) => heightFieldSurfaces({ ground: (_x, z) => (z > 0 ? Math.tan(deg * DEG) * z : 0), gridSpacing: 1 });
const flat = heightFieldSurfaces({ ground: () => 0, gridSpacing: 2 });
/** A step down of `drop` m at z = 2. */
const step = (drop: number) => heightFieldSurfaces({ ground: (_x, z) => (z < 2 ? 0 : -drop), gridSpacing: 0.1 });
/** A beach: ground falls 0.2 m per m along +z from +1 m, sea at 0. */
const beach = heightFieldSurfaces({ ground: (_x, z) => 1 - z * 0.2, gridSpacing: 0.5, water: () => 0 });

function walk(walker: GroundWalker, seconds: number, input: { walk?: number; turn?: number }, medium: GroundMedium = 'ground') {
  const events: GroundEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const event = walker.step(DT, { walk: 0, turn: 0, sensitivity: 1, ...input }, medium);
    if (event) events.push(event);
  }
  return events;
}

describe('ground walker', () => {
  it('walks at ~2 m/s, turns at ~90°/s, backs up slowly, and stops when released', () => {
    const walker = new GroundWalker(flat);
    walker.place(0, 0, 0);
    walk(walker, 2, { walk: 1 });
    expect(walker.body.speed).toBeCloseTo(WALK_SPEED, 5);
    walk(walker, 1, {});
    expect(walker.body.speed).toBe(0);
    const z = walker.body.z;
    walk(walker, 1, { walk: -1 });
    expect(walker.body.z).toBeLessThan(z);
    expect(Math.abs(walker.body.speed)).toBeLessThan(WALK_SPEED / 2);
    walker.place(0, 0, 0);
    walk(walker, 1, { turn: 1 });
    expect(-walker.body.heading / DEG).toBeCloseTo(WALK_TURN_RATE_DEG, 0);
  });

  it('sensitivity applies to ground turning too', () => {
    const walker = new GroundWalker(flat);
    walker.place(0, 0, 0);
    for (let t = 0; t < 1; t += DT) walker.step(DT, { walk: 0, turn: 1, sensitivity: 2 }, 'ground');
    expect(-walker.body.heading / DEG).toBeCloseTo(WALK_TURN_RATE_DEG * Math.SQRT2, 0);
  });

  it('follows a walkable slope (25°) up', () => {
    const walker = new GroundWalker(ramp(25));
    walker.place(0, -1, 0);
    walk(walker, 3, { walk: 1 });
    expect(walker.body.z).toBeGreaterThan(3);
    expect(walker.body.feetY).toBeCloseTo(Math.tan(25 * DEG) * walker.body.z, 1);
  });

  it('stops at a slope over 30°, smoothly: no jitter, no clipping', () => {
    const walker = new GroundWalker(ramp(40));
    walker.place(0, -1, 0);
    walk(walker, 2, { walk: 1 });
    const stopped = { z: walker.body.z, y: walker.body.feetY };
    expect(stopped.z).toBeLessThan(0.1);
    const positions: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      walker.step(DT, { walk: 1, turn: 0, sensitivity: 1 }, 'ground');
      positions.push(walker.body.z);
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.02);
    expect(walker.body.blocked).toBe(true);
    expect(walker.body.feetY).toBeGreaterThanOrEqual(-1e-9);
  });

  it('steps down a small drop (it hops down if it has to); a drop over 2 m is a ledge (glide)', () => {
    const small = new GroundWalker(step(0.8));
    small.place(0, 0, 0);
    const events = walk(small, 3, { walk: 1 });
    expect(events).not.toContain('ledge');
    expect(small.body.airborne).toBe(false);
    expect(small.body.feetY).toBeCloseTo(-0.8, 5);
    // A drop the mesh draws as a steep 60°+ slope (a 6 m triangle) is a ledge as well.
    const steep = new GroundWalker(heightFieldSurfaces({ ground: (_x, z) => (z < 2 ? 0 : -12), gridSpacing: 6 }));
    steep.place(0, -4, 0);
    expect(walk(steep, 4, { walk: 1 })[0]).toBe('ledge');
    const cliff = new GroundWalker(step(LEDGE_DROP + 1));
    cliff.place(0, 0, 0);
    // (The engine leaves the ground on the first 'ledge'.)
    expect(walk(cliff, 3, { walk: 1 })[0]).toBe('ledge');
  });

  it('jumps ~1.5–2 m high and comes back down on its feet', () => {
    const walker = new GroundWalker(flat);
    walker.place(0, 0, 0);
    walker.jump(JUMP_SPEED);
    let apex = 0;
    let events: GroundEvent[] = [];
    for (let t = 0; t < 3 && walker.body.airborne; t += DT) {
      const e = walker.step(DT, { walk: 0, turn: 0, sensitivity: 1 }, 'ground');
      if (e) events = [...events, e];
      apex = Math.max(apex, walker.body.feetY);
    }
    expect(apex).toBeGreaterThan(1.5);
    expect(apex).toBeLessThan(2.05);
    expect(events).toEqual(['landed']);
    expect(walker.body.feetY).toBe(0);
    // The ground backflip goes a little higher (time for the full turn).
    walker.jump(GROUND_FLIP_SPEED);
    let flipApex = 0;
    while (walker.body.airborne) {
      walker.step(DT, { walk: 0, turn: 0, sensitivity: 1 }, 'ground');
      flipApex = Math.max(flipApex, walker.body.feetY);
    }
    expect(flipApex).toBeGreaterThan(apex);
  });

  it('jumps up onto a ledge it couldn’t walk up, and never clips into its face', () => {
    // A 1 m ledge at z = 1.
    const ledge = heightFieldSurfaces({ ground: (_x, z) => (z < 1 ? 0 : 1), gridSpacing: 0.05 });
    const walker = new GroundWalker(ledge);
    walker.place(0, 0, 0);
    walk(walker, 1, { walk: 1 });
    expect(walker.body.z).toBeLessThan(1);
    walker.jump(JUMP_SPEED);
    const events = walk(walker, 2, { walk: 1 });
    expect(events).toContain('landed');
    expect(walker.body.z).toBeGreaterThan(1);
    expect(walker.body.feetY).toBeCloseTo(1, 5);
    // Jumping into a wall too tall to clear stops against it.
    const wall = heightFieldSurfaces({ ground: (_x, z) => (z < 1 ? 0 : 5), gridSpacing: 0.05 });
    const blocked = new GroundWalker(wall);
    blocked.place(0, 0.5, 0);
    blocked.jump(JUMP_SPEED);
    for (let t = 0; t < 2; t += DT) {
      blocked.step(DT, { walk: 1, turn: 0, sensitivity: 1 }, 'ground');
      // Never inside the ground under it.
      expect(blocked.body.feetY).toBeGreaterThanOrEqual(blocked.surfaceUnder().height - 1e-9);
    }
    expect(blocked.body.z).toBeLessThan(1);
  });

  it('beach ↔ water: walks in and floats, paddles back out and stands', () => {
    const walker = new GroundWalker(beach);
    walker.place(0, 0, 0);
    const events = walk(walker, 6, { walk: 1 });
    expect(events[0]).toBe('enter-water');
    const z = walker.body.z;
    // Now paddle (slower), turn round, and paddle back out.
    walk(walker, 1, { walk: 1 }, 'water');
    // Paddling is slower than walking (it slows from walking speed within the first steps).
    expect(walker.body.z - z).toBeLessThan(PADDLE_SPEED * 1.2);
    expect(walker.body.speed).toBeCloseTo(PADDLE_SPEED, 5);
    walk(walker, 3, { turn: 1 }, 'water');
    expect(walk(walker, 10, { walk: 1 }, 'water')).toContain('exit-water');
  });
});
