import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small helpers for building merged, vertex-coloured low-poly geometry: every part is baked to
// the same attribute set (position, color, and any extra per-vertex floats) so one merge gives one
// draw call per species, and InstancedMesh then draws every copy of it in that same call.

export type ColorFn = (x: number, y: number, z: number) => THREE.ColorRepresentation;
export type FloatFn = (x: number, y: number, z: number) => number;

const tmpColor = new THREE.Color();

/**
 * Converts `geometry` to non-indexed, drops uv/normal, and bakes a `color` attribute plus the
 * given extra float attributes (e.g. `aSway`, `aGlow`) from functions of object-space position.
 */
export function bake(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation | ColorFn,
  extras: Record<string, number | FloatFn> = {},
) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const fixed = typeof color === 'function' ? null : tmpColor.set(color).clone();
  for (let i = 0; i < pos.count; i += 1) {
    const c = fixed ?? tmpColor.set((color as ColorFn)(pos.getX(i), pos.getY(i), pos.getZ(i)));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const [name, value] of Object.entries(extras)) {
    const data = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i += 1) {
      data[i] = typeof value === 'function' ? value(pos.getX(i), pos.getY(i), pos.getZ(i)) : value;
    }
    g.setAttribute(name, new THREE.BufferAttribute(data, 1));
  }
  return g;
}

/** Merges baked parts (same attribute set) and adds flat normals for shadows/lighting. */
export function mergeBaked(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('lowPoly: incompatible geometry parts');
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/** Deterministically jitters vertices (shared corners move together) for organic rocks. */
export function jitter(geometry: THREE.BufferGeometry, amount: number, seed = 1) {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1) * 43758.5453;
    const k = 1 + ((h - Math.floor(h)) * 2 - 1) * amount;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  return geometry;
}

/** A flat ribbon along +Y (width in X), `segments` long, for kelp blades, fronds and fins. */
export function ribbon(width: number, height: number, segments: number, taper = 1) {
  const g = new THREE.PlaneGeometry(width, height, 1, segments);
  g.translate(0, height / 2, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i += 1) {
    const t = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) * (1 - taper * t * t));
  }
  return g;
}

/**
 * A simple streamlined body along +Z (nose at +Z), from cross-section stations. Each station is
 * [z, halfWidth, halfHeight, yOffset]; `sides` vertices per ring. Used for fish, sharks, dolphins.
 */
export function streamlinedBody(stations: [number, number, number, number][], sides = 6) {
  const positions: number[] = [];
  const ring = (s: [number, number, number, number], k: number) => {
    const a = (k / sides) * Math.PI * 2;
    return [Math.cos(a) * s[1], Math.sin(a) * s[2] + s[3], s[0]];
  };
  for (let si = 0; si < stations.length - 1; si += 1) {
    const s0 = stations[si];
    const s1 = stations[si + 1];
    for (let k = 0; k < sides; k += 1) {
      const a0 = ring(s0, k);
      const a1 = ring(s0, k + 1);
      const b0 = ring(s1, k);
      const b1 = ring(s1, k + 1);
      // Stations go nose → tail (decreasing z); wind so faces point outward.
      positions.push(...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

/** A single triangle as geometry (fins, flukes). */
export function triangle(a: number[], b: number[], c: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  return g;
}
