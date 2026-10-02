import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WATER_LEVEL, WAVES, WAVE_SHORE_DAMP_DEPTH, smoothstep, waveHeight, wavesGlsl } from './oceanField';
import {
  DEPTH_DECODE,
  DEPTH_TEXEL_SIZE,
  DEPTH_TEX_SIZE,
  GroundDepthTexture,
  VERTEX_SHADER,
  WaterSurface,
  gridCell,
  gridLine,
  snappedOrigin,
} from './waterSurface';
import { QUALITY_PROFILES } from './quality';

// The floating bird's height must come from a CPU function that mirrors the water's vertex shader
// exactly: the same wave constants and formula, the same damping by the same depth texture, the
// same time, and the same grid (whose density depends on the quality level).

/** Evaluates the GLSL `oceanWaves` that wavesGlsl() generates, by parsing its terms back out. */
function evalGlslWaves(glsl: string, x: number, z: number, t: number) {
  const term = /a = ([\d.-]+) \* dot\(vec2\(([\d.-]+), ([\d.-]+)\), p\) \+ ([\d.-]+) \* t;\s+h \+= ([\d.-]+) \* sin\(a\);/g;
  let h = 0;
  let count = 0;
  for (const m of glsl.matchAll(term)) {
    const [k, dx, dz, speed, amp] = m.slice(1).map(Number);
    h += amp * Math.sin(k * (dx * x + dz * z) + speed * t);
    count += 1;
  }
  return { h, count };
}

const ground = (x: number, z: number) => -12 + 10 * Math.exp(-((x - 20) ** 2 + (z + 8) ** 2) / 400);

function filledDepthTexture() {
  const depth = new GroundDepthTexture();
  for (let tx = -1; tx <= 1; tx += 1) {
    for (let tz = -1; tz <= 1; tz += 1) depth.writeTileRows(tx, tz, 0, 60, ground);
  }
  return depth;
}

describe('water surface CPU mirror', () => {
  it('the shader is generated from the same WAVES table (constants and formula)', () => {
    const glsl = wavesGlsl();
    for (const [x, z, t] of [
      [0, 0, 0],
      [13.7, -4.2, 3.3],
      [-120.5, 77.1, 41.9],
      [5, 5, 1000.25],
    ]) {
      const { h, count } = evalGlslWaves(glsl, x, z, t);
      expect(count).toBe(WAVES.length);
      expect(h).toBeCloseTo(waveHeight(x, z, t), 6);
    }
  });

  it('the vertex shader damps the waves with the shared shore depth and the depth texture', () => {
    expect(VERTEX_SHADER).toContain(`smoothstep(0.0, ${WAVE_SHORE_DAMP_DEPTH.toFixed(2)}, -oceanGround(wp.xz))`);
    expect(VERTEX_SHADER).toContain('wp.y += oceanWaves(wp.xz, uTime, grad) * damp;');
    // The decode the shader uses matches the CPU sampler's: 1 / (size · texel), 255 / 8, −20.
    expect(DEPTH_DECODE).toContain((1 / (DEPTH_TEX_SIZE * DEPTH_TEXEL_SIZE)).toFixed(10));
    expect(DEPTH_DECODE).toContain((255 / 8).toFixed(4));
    expect(DEPTH_DECODE).toContain('-20.0');
  });

  it('samples the depth texture like the GPU: exact at texel centers, bilinear between, 1/8 m steps', () => {
    const depth = filledDepthTexture();
    // Texel centers sit at odd world coordinates (texel i covers [2i, 2i + 2]).
    for (const [x, z] of [
      [21, -7],
      [1, 1],
      [-33, 45],
    ]) {
      expect(Math.abs(depth.sampleHeight(x, z) - ground(x, z))).toBeLessThanOrEqual(1 / 16 + 1e-9);
    }
    const a = depth.sampleHeight(21, -7);
    const b = depth.sampleHeight(23, -7);
    expect(depth.sampleHeight(22, -7)).toBeCloseTo((a + b) / 2, 10);
  });

  it('matches the vertex formula exactly at grid vertices, and interpolates on the drawn triangles', () => {
    const depth = filledDepthTexture();
    const parent = new THREE.Group();
    const water = new WaterSurface(parent, depth.texture, { value: 0 }, 128);
    const t = 12.34;
    const originX = snappedOrigin(5);
    const originZ = snappedOrigin(-3);
    const vertex = (i: number, j: number) => {
      const x = originX + gridLine(i, 128);
      const z = originZ + gridLine(j, 128);
      return WATER_LEVEL + waveHeight(x, z, t) * smoothstep(0, WAVE_SHORE_DAMP_DEPTH, -depth.sampleHeight(x, z));
    };
    const i = gridCell(4 - originX, 128);
    const j = gridCell(-2 - originZ, 128);
    expect(water.surfaceHeightAt(originX + gridLine(i, 128), originZ + gridLine(j, 128), t, originX, originZ, depth)).toBeCloseTo(
      vertex(i, j),
      10,
    );
    // The middle of the b–c diagonal is the average of b and c.
    const mx = originX + (gridLine(i, 128) + gridLine(i + 1, 128)) / 2;
    const mz = originZ + (gridLine(j, 128) + gridLine(j + 1, 128)) / 2;
    expect(water.surfaceHeightAt(mx, mz, t, originX, originZ, depth)).toBeCloseTo((vertex(i + 1, j) + vertex(i, j + 1)) / 2, 10);
    water.dispose();
  });

  it('per quality: the drawn surface (and the mirror) differs from the smooth waves by < 1 cm (High) / < 2 cm (Low)', () => {
    const depth = filledDepthTexture();
    for (const level of ['high', 'low'] as const) {
      const water = new WaterSurface(new THREE.Group(), depth.texture, { value: 0 }, QUALITY_PROFILES[level].waterSegments);
      let worst = 0;
      for (let k = 0; k < 200; k += 1) {
        const x = 60 + Math.sin(k * 1.7) * 5;
        const z = -50 + Math.cos(k * 2.3) * 5;
        const t = k * 0.37;
        const smooth = WATER_LEVEL + waveHeight(x, z, t) * smoothstep(0, WAVE_SHORE_DAMP_DEPTH, -depth.sampleHeight(x, z));
        const drawn = water.surfaceHeightAt(x, z, t, snappedOrigin(x), snappedOrigin(z), depth);
        worst = Math.max(worst, Math.abs(drawn - smooth));
      }
      expect(worst).toBeLessThan(level === 'high' ? 0.01 : 0.02);
      water.dispose();
    }
  });

  it('flat water near the shore: the waves are damped exactly as drawn', () => {
    const depth = new GroundDepthTexture();
    depth.writeTileRows(0, 0, 0, 60, () => -0.25); // 0.25 m deep everywhere: damped hard
    const water = new WaterSurface(new THREE.Group(), depth.texture, { value: 0 }, 128);
    const damp = smoothstep(0, WAVE_SHORE_DAMP_DEPTH, 0.25);
    const h = water.surfaceHeightAt(0, 0, 3, 0, 0, depth);
    expect(Math.abs(h)).toBeLessThanOrEqual(Math.abs(waveHeight(0, 0, 3)) * damp + 1e-9);
    water.dispose();
  });
});
