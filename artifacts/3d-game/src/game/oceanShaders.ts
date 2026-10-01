import * as THREE from 'three';

// Shared GLSL and material patching for the ocean overhaul: animated caustics on the seabed and
// the reef, vertex-shader motion (swaying kelp, swimming fish, flapping flippers), and night-time
// bioluminescence. Everything animates on the GPU from one shared time uniform, so no per-frame
// CPU vertex work is needed.

/**
 * Fragments whose FogExp2 exponent (density·depth)² exceeds this are 99.6% fog (exp(-5.5) ≈
 * 0.004): they just write the fog colour, which is what the full shader would have produced.
 */
export const FOG_CULL_EXPONENT = 5.5;

/**
 * Uniforms shared by every patched ocean material. The same objects are handed to each shader,
 * so one write per frame (GameEngine → OceanManager / UnderwaterEnvironment) updates them all.
 */
export interface OceanUniforms {
  uTime: THREE.IUniform<number>;
  /** Caustic strength; 0 turns them off (Low quality, or above water). */
  uCaustics: THREE.IUniform<number>;
  uCausticColor: THREE.IUniform<THREE.Color>;
  /** Bioluminescence, 0..1 (night). Lights up vertices whose `aGlow` attribute is > 0. */
  uGlow: THREE.IUniform<number>;
  uGlowColor: THREE.IUniform<THREE.Color>;
}

export function createOceanUniforms(): OceanUniforms {
  return {
    uTime: { value: 0 },
    uCaustics: { value: 0 },
    uCausticColor: { value: new THREE.Color('#dffcff') },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color('#5ff6ff') },
  };
}

/**
 * Animated caustics: two layers of domain-warped sine ridges, bright where each layer's sum
 * crosses zero, which draws the wandering web of light lines sunlight makes on a seabed. All ALU
 * (ten sines, no texture). `world` is a world-space XZ position; cells are ~2-4 units across.
 */
export const CAUSTICS_GLSL = /* glsl */ `
float oceanCausticLayer(vec2 p, float t, float s) {
  vec2 q = p * s + 0.9 * vec2(sin(p.y * s * 1.3 + t * 0.7), cos(p.x * s * 1.1 - t * 0.6));
  float v = sin(q.x + t * 0.5) + sin(q.y * 1.13 - t * 0.4) + sin((q.x + q.y) * 0.71 + t * 0.3);
  return 1.0 - smoothstep(0.0, 0.45, abs(v));
}
float oceanCaustic(vec2 world, float time) {
  float a = oceanCausticLayer(world, time, 0.55);
  float b = oceanCausticLayer(world + vec2(17.3, -9.1), time * 1.3, 0.83);
  return min(1.6, pow(a * 0.7 + b * 0.5, 1.5) * 1.3);
}
`;

export interface OceanPatchOptions {
  /** Project animated caustics onto upward-facing surfaces below the water line. */
  caustics?: boolean;
  /** Emissive glow at night on vertices with an `aGlow` attribute (the geometry must have it). */
  glow?: boolean;
  /**
   * GLSL run right after `<begin_vertex>`, free to modify `transformed` (object space). In scope:
   * `uTime`, `oceanOrigin` (the instance's or mesh's world position) and `oceanIndex` (the
   * instance index as a float, 0 when not instanced), plus any `uniforms` given here.
   */
  vertex?: string;
  /** Extra uniforms for `vertex` (declared automatically as floats unless `vertexHeader` is set). */
  uniforms?: Record<string, THREE.IUniform>;
  /** Declarations for `vertex` (uniforms, attributes, helpers). */
  vertexHeader?: string;
  /**
   * Skip lighting for fully fogged fragments (writes the fog colour). On by default; off for
   * transparent materials, whose alpha that shortcut would get wrong.
   */
  fogCull?: boolean;
  /** Program cache key: materials with the same key and options share one compiled shader. */
  key: string;
}

/**
 * Patches a built-in lit material (MeshStandardMaterial / MeshLambertMaterial) with the ocean
 * extras. Returns the material for chaining.
 */
export function patchOceanMaterial<T extends THREE.Material>(material: T, shared: OceanUniforms, options: OceanPatchOptions): T {
  const { caustics = false, glow = false, fogCull = true, vertex = '', uniforms = {}, vertexHeader, key } = options;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, uniforms);
    const uniformDecls =
      vertexHeader ?? Object.keys(uniforms).map((name) => `uniform float ${name};`).join('\n');
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
varying vec3 vOceanWorld;
${glow ? 'attribute float aGlow;\nvarying float vOceanGlow;' : ''}
${uniformDecls}`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 oceanOrigin = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float oceanIndex = float(gl_InstanceID);
#else
  vec3 oceanOrigin = modelMatrix[3].xyz;
  float oceanIndex = 0.0;
#endif
${glow ? 'vOceanGlow = aGlow;' : ''}
${vertex}`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
#ifdef USE_INSTANCING
  vOceanWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vOceanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform float uCaustics;
uniform vec3 uCausticColor;
uniform float uGlow;
uniform vec3 uGlowColor;
varying vec3 vOceanWorld;
${glow ? 'varying float vOceanGlow;' : ''}
${caustics ? CAUSTICS_GLSL : ''}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        fogCull
          ? /* glsl */ `#include <clipping_planes_fragment>
#ifdef FOG_EXP2
  if (fogDensity * fogDensity * vFogDepth * vFogDepth > ${FOG_CULL_EXPONENT.toFixed(2)}) {
    gl_FragColor = vec4(fogColor, 1.0);
    return;
  }
#endif`
          : '#include <clipping_planes_fragment>',
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `${
          caustics
            ? `if (uCaustics > 0.0 && vOceanWorld.y < 0.3) {
  vec3 oceanUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float facing = clamp(dot(normal, oceanUp) * 0.8 + 0.2, 0.0, 1.0);
  float below = (1.0 - smoothstep(-0.9, 0.3, vOceanWorld.y)) * exp(vOceanWorld.y * 0.025);
  outgoingLight += diffuseColor.rgb * uCausticColor * (oceanCaustic(vOceanWorld.xz, uTime) * uCaustics * facing * below);
}`
            : ''
        }
${glow ? 'outgoingLight += uGlowColor * (uGlow * vOceanGlow) + diffuseColor.rgb * (uGlow * vOceanGlow * 0.6);' : ''}
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `ocean:${key}:${caustics ? 1 : 0}${glow ? 1 : 0}${fogCull ? 1 : 0}`;
  return material;
}

/** Soft round point sprite shading, shared by bubbles, marine snow and far particles. */
export const SOFT_POINT_GLSL = /* glsl */ `
float softDisc(vec2 pc) {
  float d = length(pc - 0.5) * 2.0;
  return 1.0 - smoothstep(0.55, 1.0, d);
}
`;
