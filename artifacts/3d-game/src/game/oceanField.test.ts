import { describe, expect, it } from 'vitest';
import {
  ISLAND_CELL,
  ISLAND_SKIRT,
  OceanField,
  SEABED_BASE_Y,
  WATER_LEVEL,
  WAVES,
  WAVE_MAX_HEIGHT,
  islandAt,
  mulberry32,
  waveHeight,
  wavesGlsl,
  type Island,
} from './oceanField';

const field = new OceanField(mulberry32(42));

function firstIsland(): Island {
  for (let cz = 0; cz < 20; cz += 1) {
    for (let cx = 0; cx < 20; cx += 1) {
      const island = islandAt(cx, cz);
      if (island) return island;
    }
  }
  throw new Error('no island');
}

/** A point at least `margin` past every island's reef slope. */
function openSeaPoint(margin = 10) {
  for (let z = 0; z < 5000; z += 7) {
    for (let x = -300; x < 300; x += 7) {
      const near = field.islandsNear(x, z);
      if (near.every((i) => Math.hypot(x - i.x, z - i.z) > i.radius + ISLAND_SKIRT + margin)) return { x, z };
    }
  }
  throw new Error('no open sea');
}

describe('OceanField ground', () => {
  it('keeps the open seabed near its mean depth, always under water', () => {
    const { x, z } = openSeaPoint();
    for (let i = 0; i < 40; i += 1) {
      const h = field.groundHeight(x + i * 0.9, z);
      expect(h).toBeGreaterThan(SEABED_BASE_Y - 3);
      expect(h).toBeLessThan(SEABED_BASE_Y + 4);
    }
  });

  it('rises from the seabed to the shoreline across the reef slope, with no floating gap', () => {
    const island = firstIsland();
    let previous = -Infinity;
    // Walk inward from past the skirt to the shoreline: the ground never has a cliff taller
    // than the slope allows, and meets the water level at the shore.
    for (let d = island.radius + ISLAND_SKIRT + 5; d >= island.radius; d -= 0.5) {
      const h = field.groundHeight(island.x + d, island.z);
      if (previous !== -Infinity) expect(Math.abs(h - previous)).toBeLessThan(2.2);
      previous = h;
    }
    expect(Math.abs(field.groundHeight(island.x + island.radius, island.z) - WATER_LEVEL)).toBeLessThan(0.5);
    // The island itself is dry land.
    expect(field.groundHeight(island.x, island.z)).toBeGreaterThan(5);
  });

  it('is continuous at the shoreline (no step between the dome and the slope)', () => {
    const island = firstIsland();
    const inside = field.groundHeight(island.x + island.radius - 0.05, island.z);
    const outside = field.groundHeight(island.x + island.radius + 0.05, island.z);
    expect(Math.abs(inside - outside)).toBeLessThan(0.1);
  });

  it('keeps the old island footprint for isOverWater', () => {
    const island = firstIsland();
    expect(field.isOverWater(island.x, island.z)).toBe(false);
    expect(field.isOverWater(island.x + island.radius + 1, island.z)).toBe(true);
  });

  it('reports reef-slope context near islands and none out at sea', () => {
    const island = firstIsland();
    const s = { height: 0, rock: 0, reef: 0, shoreDistance: 0 };
    field.sample(island.x + island.radius + 6, island.z, s);
    expect(s.reef).toBeGreaterThan(0.8);
    const open = openSeaPoint(40);
    field.sample(open.x, open.z, s);
    expect(s.reef).toBe(0);
  });

  it('surfaceHeight is the land, or the calm water level over the sea', () => {
    const island = firstIsland();
    const open = openSeaPoint();
    expect(field.surfaceHeight(open.x, open.z)).toBe(WATER_LEVEL);
    expect(field.surfaceHeight(island.x, island.z)).toBe(field.groundHeight(island.x, island.z));
  });

  it('bounds its island cache', () => {
    const f = new OceanField(mulberry32(1));
    for (let i = 0; i < 6000; i += 1) f.islandsNear(i * ISLAND_CELL, 0);
    // No public size; just make sure lookups stay correct after eviction.
    expect(f.islandsNear(0, 0)).toEqual(new OceanField(mulberry32(1)).islandsNear(0, 0));
  });
});

describe('waves', () => {
  it('stay within the summed amplitude', () => {
    for (let i = 0; i < 500; i += 1) {
      const h = waveHeight(i * 3.7, i * -2.3, i * 0.13);
      expect(Math.abs(h)).toBeLessThanOrEqual(WAVE_MAX_HEIGHT + 1e-9);
    }
  });

  it('lie flat against the beach and move freely in deep water', () => {
    const island = firstIsland();
    const shore = { x: island.x + island.radius + 0.2, z: island.z };
    const open = openSeaPoint();
    let shoreMax = 0;
    let openMax = 0;
    for (let t = 0; t < 20; t += 0.25) {
      shoreMax = Math.max(shoreMax, Math.abs(field.waterHeight(shore.x, shore.z, t)));
      openMax = Math.max(openMax, Math.abs(field.waterHeight(open.x, open.z, t)));
    }
    expect(shoreMax).toBeLessThan(0.05);
    expect(openMax).toBeGreaterThan(0.2);
  });

  it('generate one GLSL term per wave', () => {
    const glsl = wavesGlsl();
    expect(glsl.match(/h \+=/g)).toHaveLength(WAVES.length);
    expect(glsl).toContain('float oceanWaves(vec2 p, float t, out vec2 grad)');
  });
});

describe('mulberry32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
