import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { IslandDecor } from './oceanDecor';
import { ISLAND_CELL, OceanField, islandAt, mulberry32 } from './oceanField';
import { createOceanUniforms } from './oceanShaders';

describe('rock perches (standable rock tops from the instance data)', () => {
  const field = new OceanField(mulberry32(7));
  const decor = new IslandDecor(new THREE.Group(), field, createOceanUniforms(), 260);

  it('every island cell nearby yields rock tops sitting on their rocks', () => {
    let found = 0;
    for (let cx = -4; cx <= 4; cx += 1) {
      for (let cz = -4; cz <= 4; cz += 1) {
        const island = islandAt(cx, cz);
        if (!island) continue;
        for (const perch of decor.perchesNear(cx * ISLAND_CELL, cz * ISLAND_CELL)) {
          found += 1;
          const ground = field.groundHeight(perch.x, perch.z);
          // The top of a rock is above the ground it stands on, by at most its (scaled) height.
          expect(perch.y).toBeGreaterThan(ground - 0.1);
          expect(perch.y).toBeLessThan(ground + 3.5);
          expect(perch.radius).toBeGreaterThanOrEqual(0.3);
          expect(perch.kind).toBe('rock');
        }
      }
    }
    expect(found).toBeGreaterThan(10);
  });

  it('returns the same cached perches (no per-query allocation of perch objects)', () => {
    const a = [...decor.perchesNear(0, 0)];
    const b = [...decor.perchesNear(0, 0)];
    expect(b).toEqual(a);
    for (let i = 0; i < a.length; i += 1) expect(b[i]).toBe(a[i]);
    decor.dispose();
  });
});
