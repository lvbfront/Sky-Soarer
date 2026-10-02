import * as THREE from 'three';
import { TILE_SIZE, WATER_LEVEL, WAVE_SHORE_DAMP_DEPTH, smoothstep, waveHeight, wavesGlsl } from './oceanField';
import { FOG_CULL_EXPONENT } from './oceanShaders';

// The ocean's water surface: one grid mesh that follows the bird (a single draw call for the whole
// sea), waves animated entirely in the vertex shader, and a fragment shader that colours the water
// by the depth of the ground below it (turquoise shallows, deep blue offshore) with Fresnel sky
// reflection, sun glint and shore foam. The same mesh, seen from below, is the shimmering
// underside with its bright Snell's window overhead.
//
// The depth comes from a small toroidal "ground height" texture that OceanManager fills in tile
// by tile as the world streams (see GroundDepthTexture below), so the shader never needs the
// island layout.

// Grid: dense near the bird, sparse toward the fogged edge. f(u) = HALF·(a·u + (1-a)·u³) gives an
// inner spacing of ~1.5 units at 128 segments and ~19 units at the rim.
export const HALF_EXTENT = 470;
const INNER_WEIGHT = 0.2;
// The mesh moves in steps of this many units, so vertices near the bird land on the same world
// positions after a snap (no visible wave "swimming").
export const SNAP = 12;

/** Local offset of grid line `index` (0..segments) from the mesh's center. */
export function gridLine(index: number, segments: number) {
  const u = (index / segments) * 2 - 1;
  return HALF_EXTENT * (INNER_WEIGHT * u + (1 - INNER_WEIGHT) * u * u * u);
}

/** The grid cell containing local offset `local`: its index (0..segments-1). Bisection on gridLine. */
export function gridCell(local: number, segments: number) {
  let lo = 0;
  let hi = segments;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (gridLine(mid, segments) <= local) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Where the water mesh's center sits when it follows a bird at (x, z) (see WaterSurface.follow). */
export function snappedOrigin(value: number) {
  return Math.round(value / SNAP) * SNAP;
}

// Toroidal ground-height texture: TEX_SIZE² texels of TEXEL_SIZE world units. It covers 1024
// units, more than the 7x7 streamed tiles (840), so the loaded area never wraps onto itself.
export const DEPTH_TEX_SIZE = 512;
export const DEPTH_TEXEL_SIZE = 2;
// One byte per texel: height = byte / DEPTH_SCALE + DEPTH_MIN, i.e. -20 .. +11.9 in 1/8 steps.
const DEPTH_MIN = -20;
const DEPTH_SCALE = 8;
const TEXELS_PER_TILE = TILE_SIZE / DEPTH_TEXEL_SIZE;


export interface SurfaceLook {
  shallow: THREE.Color;
  mid: THREE.Color;
  deep: THREE.Color;
  reflect: THREE.Color;
  foam: THREE.Color;
  sunColor: THREE.Color;
  glint: number;
  /** Underside: the colour outside the Snell's window, and inside it. */
  underDeep: THREE.Color;
  window: THREE.Color;
}

/** The ground-height texture the water shader reads its depth from. */
export class GroundDepthTexture {
  readonly texture: THREE.DataTexture;
  private data: Uint8Array;

  constructor() {
    // Zero means the deepest encodable ground, so unstreamed areas read as open ocean.
    this.data = new Uint8Array(DEPTH_TEX_SIZE * DEPTH_TEX_SIZE);
    this.texture = new THREE.DataTexture(this.data, DEPTH_TEX_SIZE, DEPTH_TEX_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  /**
   * The ground height the water shader reads at (x, z): the same 8-bit texels, bilinearly filtered
   * the way the GPU's LinearFilter + RepeatWrapping does it, decoded like DEPTH_DECODE. So the CPU
   * mirror of the waves damps them by exactly the depth the shader sees, not the exact ground.
   */
  sampleHeight(x: number, z: number) {
    const size = DEPTH_TEX_SIZE;
    const sx = x / DEPTH_TEXEL_SIZE - 0.5;
    const sz = z / DEPTH_TEXEL_SIZE - 0.5;
    const i0 = Math.floor(sx);
    const j0 = Math.floor(sz);
    const fx = sx - i0;
    const fz = sz - j0;
    const c0 = ((i0 % size) + size) % size;
    const c1 = (c0 + 1) % size;
    const r0 = (((j0 % size) + size) % size) * size;
    const r1 = ((((j0 + 1) % size) + size) % size) * size;
    const d = this.data;
    const top = d[r0 + c0] + (d[r0 + c1] - d[r0 + c0]) * fx;
    const bottom = d[r1 + c0] + (d[r1 + c1] - d[r1 + c0]) * fx;
    return (top + (bottom - top) * fz) / DEPTH_SCALE + DEPTH_MIN;
  }

  /**
   * Writes rows [rowStart, rowEnd) of one tile's texels from `heightAt`. Split into row ranges so
   * the tile streamer can spread a tile over several frames.
   */
  writeTileRows(tileX: number, tileZ: number, rowStart: number, rowEnd: number, heightAt: (x: number, z: number) => number) {
    const baseI = tileX * TEXELS_PER_TILE - TEXELS_PER_TILE / 2;
    const baseJ = tileZ * TEXELS_PER_TILE - TEXELS_PER_TILE / 2;
    const size = DEPTH_TEX_SIZE;
    for (let r = rowStart; r < rowEnd; r += 1) {
      const gj = baseJ + r;
      const worldZ = (gj + 0.5) * DEPTH_TEXEL_SIZE;
      const row = (((gj % size) + size) % size) * size;
      for (let c = 0; c < TEXELS_PER_TILE; c += 1) {
        const gi = baseI + c;
        const h = heightAt((gi + 0.5) * DEPTH_TEXEL_SIZE, worldZ);
        const encoded = Math.round((h - DEPTH_MIN) * DEPTH_SCALE);
        this.data[row + (((gi % size) + size) % size)] = encoded < 0 ? 0 : encoded > 255 ? 255 : encoded;
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

export const TILE_TEXEL_ROWS = TEXELS_PER_TILE;

function buildGrid(segments: number) {
  const n = segments + 1;
  const positions = new Float32Array(n * n * 3);
  // gridLine is also what the CPU wave mirror (surfaceHeightAt) uses, so both agree on every vertex.
  for (let j = 0; j < n; j += 1) {
    const z = gridLine(j, segments);
    for (let i = 0; i < n; i += 1) {
      const k = (j * n + i) * 3;
      positions[k] = gridLine(i, segments);
      positions[k + 1] = 0;
      positions[k + 2] = z;
    }
  }
  const indices = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise seen from above, so the top is the front face.
      indices[p++] = a;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), HALF_EXTENT * 1.5);
  return geometry;
}

export const DEPTH_DECODE = /* glsl */ `
uniform sampler2D uDepthTex;
float oceanGround(vec2 xz) {
  return texture(uDepthTex, xz * ${(1 / (DEPTH_TEX_SIZE * DEPTH_TEXEL_SIZE)).toFixed(10)}).r * ${(255 / DEPTH_SCALE).toFixed(4)} + ${DEPTH_MIN.toFixed(1)};
}
`;

export const VERTEX_SHADER = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
varying vec3 vWorld;
varying vec3 vWaveNormal;
${DEPTH_DECODE}
${wavesGlsl()}
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float damp = smoothstep(0.0, ${WAVE_SHORE_DAMP_DEPTH.toFixed(2)}, -oceanGround(wp.xz));
  vec2 grad;
  wp.y += oceanWaves(wp.xz, uTime, grad) * damp;
  grad *= damp;
  vWaveNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
  vWorld = wp;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uReflect;
uniform vec3 uFoam;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGlint;
uniform vec3 uUnderDeep;
uniform vec3 uWindow;
uniform vec3 uFocus;
varying vec3 vWorld;
varying vec3 vWaveNormal;
${DEPTH_DECODE}
void main() {
  #ifdef FOG_EXP2
  // Fully fogged (the far sea, the horizon): skip all the water maths.
  if (fogDensity * fogDensity * vFogDepth * vFogDepth > ${FOG_CULL_EXPONENT.toFixed(2)}) {
    gl_FragColor = vec4(fogColor, 1.0);
    return;
  }
  #endif
  vec2 p = vWorld.xz;
  float t = uTime;
  // Fine ripples on top of the vertex waves, for the glint and the underside shimmer.
  vec2 ripple = vec2(sin(p.x * 0.93 + p.y * 0.41 + t * 2.1), cos(p.y * 1.07 - p.x * 0.33 - t * 1.7)) * 0.06;
  vec3 n = normalize(vWaveNormal + vec3(ripple.x, 0.0, ripple.y));
  vec3 toCamera = normalize(cameraPosition - vWorld);
  vec3 col;
  if (gl_FrontFacing) {
    float depth = -oceanGround(p);
    vec3 base = mix(uShallow, uMid, smoothstep(0.2, 4.5, depth));
    base = mix(base, uDeep, smoothstep(3.5, 13.0, depth));
    float ndv = clamp(dot(n, toCamera), 0.0, 1.0);
    float m = 1.0 - ndv;
    float fresnel = 0.03 + 0.97 * m * m * m * m * m;
    col = mix(base, uReflect, clamp(fresnel * 0.9, 0.0, 1.0));
    float spec = pow(max(dot(n, normalize(uSunDir + toCamera)), 0.0), 220.0) * 3.0;
    col += uSunColor * spec * uGlint;
    // Shore foam: a band hugging the beach, broken up and slowly washing in and out.
    float shore = 1.0 - smoothstep(0.0, 1.8, depth + 0.35 * sin(t * 0.9 + p.x * 0.05 + p.y * 0.04));
    if (shore > 0.0) {
      float breakup = 0.5 + 0.5 * sin(p.x * 0.57 + t * 1.1) * sin(p.y * 0.63 - t * 0.8);
      col = mix(col, uFoam, clamp(shore * smoothstep(0.3, 0.7, breakup + shore * 0.45), 0.0, 1.0) * 0.85);
    }
  } else {
    // From below: total internal reflection outside a ~49° cone (the dark, deep colour), and the
    // bright refracted sky inside it, shimmering with the ripples and brightest overhead.
    vec3 up = normalize(vWorld - cameraPosition);
    float window = smoothstep(0.6, 0.8, dot(up, n));
    float shimmer = 0.75 + 0.5 * sin(p.x * 1.3 + t * 2.0 + ripple.x * 40.0) * sin(p.y * 1.1 - t * 1.6 + ripple.y * 40.0);
    col = mix(uUnderDeep, uWindow * shimmer, window);
    vec2 d = p - uFocus.xz;
    col += uWindow * 0.35 * exp(-dot(d, d) / 260.0) * shimmer;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The single, bird-following water surface mesh. */
export class WaterSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly uniforms: {
    uTime: THREE.IUniform<number>;
    uDepthTex: THREE.IUniform<THREE.Texture>;
    uShallow: THREE.IUniform<THREE.Color>;
    uMid: THREE.IUniform<THREE.Color>;
    uDeep: THREE.IUniform<THREE.Color>;
    uReflect: THREE.IUniform<THREE.Color>;
    uFoam: THREE.IUniform<THREE.Color>;
    uSunDir: THREE.IUniform<THREE.Vector3>;
    uSunColor: THREE.IUniform<THREE.Color>;
    uGlint: THREE.IUniform<number>;
    uUnderDeep: THREE.IUniform<THREE.Color>;
    uWindow: THREE.IUniform<THREE.Color>;
    uFocus: THREE.IUniform<THREE.Vector3>;
  };
  private segments: number;

  constructor(parent: THREE.Object3D, depthTexture: THREE.Texture, time: THREE.IUniform<number>, segments: number) {
    this.segments = segments;
    this.uniforms = {
      uTime: time,
      uDepthTex: { value: depthTexture },
      uShallow: { value: new THREE.Color('#4fd6cf') },
      uMid: { value: new THREE.Color('#1f9fb8') },
      uDeep: { value: new THREE.Color('#0d4f86') },
      uReflect: { value: new THREE.Color('#bfe6ef') },
      uFoam: { value: new THREE.Color('#f4fdff') },
      // Toward the sun: GameEngine's sun sits at (-55, 85, -38) relative to the bird.
      uSunDir: { value: new THREE.Vector3(-55, 85, -38).normalize() },
      uSunColor: { value: new THREE.Color('#fff1d6') },
      uGlint: { value: 1 },
      uUnderDeep: { value: new THREE.Color('#0f5a7a') },
      uWindow: { value: new THREE.Color('#bff4ff') },
      uFocus: { value: new THREE.Vector3() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      fog: true,
    });
    // UniformsUtils.merge clones values; attach ours afterwards so they stay shared (time, texture).
    Object.assign(material.uniforms, this.uniforms);
    this.mesh = new THREE.Mesh(buildGrid(segments), material);
    this.mesh.frustumCulled = false;
    // Drawn first among opaques, so the seabed under open water fails the depth test cheaply.
    this.mesh.renderOrder = -1;
    parent.add(this.mesh);
  }

  /** Follow the bird in SNAP-unit steps; `focus` brightens the underside right above it. */
  follow(position: THREE.Vector3) {
    this.mesh.position.set(snappedOrigin(position.x), 0, snappedOrigin(position.z));
    this.uniforms.uFocus.value.copy(position);
  }

  getSegments() {
    return this.segments;
  }

  /**
   * The rendered water height at (x, z), for a floating bird: the CPU mirror of the vertex shader.
   * Each grid vertex around the point is displaced exactly as the shader does it (the shared WAVES
   * table, damped by smoothstep(0, WAVE_SHORE_DAMP_DEPTH, depth) with the depth read from the same
   * ground texture), then the point is interpolated on the same triangle the GPU rasterises. So it
   * follows the grid density of the current quality level too. `originX/Z` is where the mesh sits
   * (snappedOrigin of the followed position), `time` the shared uTime.
   */
  surfaceHeightAt(x: number, z: number, time: number, originX: number, originZ: number, depth: GroundDepthTexture) {
    const n = this.segments;
    const lx = Math.max(-HALF_EXTENT, Math.min(HALF_EXTENT, x - originX));
    const lz = Math.max(-HALF_EXTENT, Math.min(HALF_EXTENT, z - originZ));
    const i = gridCell(lx, n);
    const j = gridCell(lz, n);
    const x0 = gridLine(i, n);
    const x1 = gridLine(i + 1, n);
    const z0 = gridLine(j, n);
    const z1 = gridLine(j + 1, n);
    const tx = (lx - x0) / (x1 - x0);
    const tz = (lz - z0) / (z1 - z0);
    const vertex = (vx: number, vz: number) => {
      const wx = originX + vx;
      const wz = originZ + vz;
      const damp = smoothstep(0, WAVE_SHORE_DAMP_DEPTH, -depth.sampleHeight(wx, wz));
      return WATER_LEVEL + waveHeight(wx, wz, time) * damp;
    };
    // The grid's triangles are (a, c, b) and (b, c, d), split along the b–c diagonal (see buildGrid).
    const hb = vertex(x1, z0);
    const hc = vertex(x0, z1);
    if (tx + tz <= 1) {
      const ha = vertex(x0, z0);
      return ha + (hb - ha) * tx + (hc - ha) * tz;
    }
    const hd = vertex(x1, z1);
    return hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - tz);
  }

  setSegments(segments: number) {
    if (segments === this.segments) return;
    this.segments = segments;
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildGrid(segments);
  }

  applyLook(look: SurfaceLook) {
    const u = this.uniforms;
    u.uShallow.value.copy(look.shallow);
    u.uMid.value.copy(look.mid);
    u.uDeep.value.copy(look.deep);
    u.uReflect.value.copy(look.reflect);
    u.uFoam.value.copy(look.foam);
    u.uSunColor.value.copy(look.sunColor);
    u.uGlint.value = look.glint;
    u.uUnderDeep.value.copy(look.underDeep);
    u.uWindow.value.copy(look.window);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
