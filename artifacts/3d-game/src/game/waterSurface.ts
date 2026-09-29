import * as THREE from 'three';
import { TILE_SIZE, WAVE_SHORE_DAMP_DEPTH, wavesGlsl } from './oceanField';
import { FOG_CULL_EXPONENT } from './oceanShaders';

// The ocean's water surface: one grid mesh that follows the bird (a single draw call for the whole
// sea), waves animated entirely in the vertex shader, and a fragment shader that tints the water by
// the depth of the ground below it. The same mesh, seen from below, is the shimmering underside
// with its bright Snell's window overhead.
//
// The depth comes from a small toroidal "ground height" texture that OceanManager fills in tile
// by tile as the world streams (see GroundDepthTexture below), so the shader never needs the
// island layout.

// Grid: dense near the bird, sparse toward the fogged edge. f(u) = HALF·(a·u + (1-a)·u³) gives an
// inner spacing of ~1.5 units at 128 segments and ~19 units at the rim.
const HALF_EXTENT = 470;
const INNER_WEIGHT = 0.2;
// The mesh moves in steps of this many units, so vertices near the bird land on the same world
// positions after a snap (no visible wave "swimming").
const SNAP = 12;

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
  const map = (u: number) => HALF_EXTENT * (INNER_WEIGHT * u + (1 - INNER_WEIGHT) * u * u * u);
  for (let j = 0; j < n; j += 1) {
    const z = map((j / segments) * 2 - 1);
    for (let i = 0; i < n; i += 1) {
      const k = (j * n + i) * 3;
      positions[k] = map((i / segments) * 2 - 1);
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

const DEPTH_DECODE = /* glsl */ `
uniform sampler2D uDepthTex;
float oceanGround(vec2 xz) {
  return texture(uDepthTex, xz * ${(1 / (DEPTH_TEX_SIZE * DEPTH_TEXEL_SIZE)).toFixed(10)}).r * ${(255 / DEPTH_SCALE).toFixed(4)} + ${DEPTH_MIN.toFixed(1)};
}
`;

const VERTEX_SHADER = /* glsl */ `
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
  // Fine ripples on top of the vertex waves, for the underside shimmer.
  vec2 ripple = vec2(sin(p.x * 0.93 + p.y * 0.41 + t * 2.1), cos(p.y * 1.07 - p.x * 0.33 - t * 1.7)) * 0.06;
  vec3 n = normalize(vWaveNormal + vec3(ripple.x, 0.0, ripple.y));
  vec3 col;
  if (gl_FrontFacing) {
    float depth = -oceanGround(p);
    vec3 base = mix(uShallow, uMid, smoothstep(0.2, 4.5, depth));
    col = mix(base, uDeep, smoothstep(3.5, 13.0, depth));
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
    this.mesh.position.set(Math.round(position.x / SNAP) * SNAP, 0, Math.round(position.z / SNAP) * SNAP);
    this.uniforms.uFocus.value.copy(position);
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
    u.uUnderDeep.value.copy(look.underDeep);
    u.uWindow.value.copy(look.window);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
