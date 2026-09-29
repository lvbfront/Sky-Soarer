import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Underwater atmosphere, all GPU-animated and one draw call each: soft light shafts slanting
// down from the surface, drifting "marine snow" specks (some glowing at night), and round,
// rim-lit bubbles (the old PointsMaterial drew them as white squares).
//
// Shafts and snow live in a box that wraps around the camera in the vertex shader (each element's
// position is taken modulo the box size), so they're endless with zero CPU work, and fade out
// near the box edge so the wrap never pops.

const SHAFT_BOX = 64;
const SHAFT_HEIGHT = 20;
const SHAFT_MAX = 8;
const SNOW_BOX = 34;
const SNOW_MAX = 700;
const BUBBLE_POOL_SIZE = 220;
const BUBBLE_SPAWN_PER_SECOND = 16;
const BUBBLE_RISE_MIN = 1.4;
const BUBBLE_RISE_MAX = 2.8;
const BUBBLE_LIFETIME = 3.4;
const BUBBLE_HIDDEN_Y = -5000;

const SHAFT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uBox;
uniform vec3 uLean;
attribute vec2 aCenter;
attribute float aPhase;
varying float vAlpha;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vec2 cam = cameraPosition.xz;
  vec2 c = cam + mod(aCenter - cam + uBox * 0.5, uBox) - uBox * 0.5;
  float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(c - cam));
  vec3 p = position;
  float depthT = clamp(-p.y / ${SHAFT_HEIGHT.toFixed(1)}, 0.0, 1.0);
  // Lean away from the sun and sway slowly with the surface.
  p.x += depthT * uLean.x + sin(uTime * 0.35 + aPhase) * 1.3 * depthT;
  p.z += depthT * uLean.z + cos(uTime * 0.27 + aPhase * 1.3) * 1.1 * depthT;
  vec3 world = vec3(c.x + p.x, p.y, c.y + p.z);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vNormalV = normalize((viewMatrix * vec4(normalize(vec3(normal.x, 0.0, normal.z)), 0.0)).xyz);
  vViewV = normalize(-mv.xyz);
  float dist = length(mv.xyz);
  float pulse = 0.6 + 0.4 * sin(uTime * 0.55 + aPhase * 2.0);
  vAlpha = edge * pulse * pow(1.0 - depthT, 1.3) * (1.0 - smoothstep(22.0, 58.0, dist)) * smoothstep(1.5, 5.0, dist);
}
`;

const SHAFT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vAlpha;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  // Brightest through the middle of the shaft, fading to nothing at its silhouette edges.
  float body = pow(abs(dot(vNormalV, vViewV)), 1.6);
  gl_FragColor = vec4(uColor, body * vAlpha * uIntensity);
  #include <colorspace_fragment>
}
`;

const SNOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uBox;
uniform float uSize;
attribute float aSeed;
varying float vAlpha;
varying float vGlow;
void main() {
  vec3 drift = vec3(sin(uTime * 0.11 + aSeed) * 0.7, -0.12 * uTime, cos(uTime * 0.13 + aSeed * 1.3) * 0.7);
  vec3 cam = cameraPosition;
  vec3 p = cam + mod(position + drift - cam + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  gl_PointSize = uSize * (0.5 + fract(aSeed * 7.13)) * (300.0 / max(dist, 0.5));
  float edge = 1.0 - smoothstep(uBox * 0.32, uBox * 0.5, length(p - cam));
  // Never above the water line.
  vAlpha = edge * smoothstep(0.5, 2.0, dist) * (1.0 - smoothstep(-0.8, -0.3, p.y));
  vGlow = step(0.72, fract(aSeed * 3.71));
  gl_Position = projectionMatrix * mv;
}
`;

const SNOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGlowColor;
uniform float uGlow;
varying float vAlpha;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = 1.0 - smoothstep(0.3, 1.0, d);
  float glow = vGlow * uGlow;
  vec3 col = mix(uColor, uGlowColor, glow);
  gl_FragColor = vec4(col, disc * vAlpha * (0.32 + 0.68 * glow));
  #include <colorspace_fragment>
}
`;

const BUBBLE_VERTEX = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(-mv.z, 0.2));
  gl_Position = projectionMatrix * mv;
}
`;

const BUBBLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float d = length(pc) * 2.0;
  if (d > 1.0 || vAlpha < 0.01) discard;
  // A thin bright rim, a faint body, and a specular highlight up and to the left.
  float rim = smoothstep(0.62, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
  float highlight = 1.0 - smoothstep(0.0, 0.22, length(pc - vec2(-0.17, -0.17)));
  float alpha = (0.12 + rim * 0.75 + highlight * 0.9) * vAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), highlight), alpha);
  #include <colorspace_fragment>
}
`;

export interface UnderwaterFxLook {
  shaftColor: THREE.Color;
  shaftIntensity: number;
  snowColor: THREE.Color;
}

export class UnderwaterFx {
  readonly group = new THREE.Group();
  private shafts: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private shaftIndexPerShaft: number;
  private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private bubbles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private bubblePositions = new Float32Array(BUBBLE_POOL_SIZE * 3).fill(BUBBLE_HIDDEN_Y);
  private bubbleVelocities = new Float32Array(BUBBLE_POOL_SIZE * 3);
  private bubbleAges = new Float32Array(BUBBLE_POOL_SIZE).fill(BUBBLE_LIFETIME + 1);
  private bubbleAlpha: THREE.BufferAttribute;
  private bubbleCursor = 0;
  private bubbleAccumulator = 0;

  constructor(parent: THREE.Object3D, time: THREE.IUniform<number>, glow: THREE.IUniform<number>, glowColor: THREE.IUniform<THREE.Color>) {
    // Light shafts: open cones, wide at the bottom, merged into one geometry.
    const shaftParts: THREE.BufferGeometry[] = [];
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < SHAFT_MAX; i += 1) {
      const top = 1.1 + rand() * 1.2;
      const g = new THREE.CylinderGeometry(top, top * (2 + rand()), SHAFT_HEIGHT, 10, 1, true);
      g.translate(0, -SHAFT_HEIGHT / 2, 0);
      const count = g.getAttribute('position').count;
      const centers = new Float32Array(count * 2);
      const phases = new Float32Array(count);
      const cx = rand() * SHAFT_BOX;
      const cz = rand() * SHAFT_BOX;
      const phase = rand() * 20;
      for (let v = 0; v < count; v += 1) {
        centers[v * 2] = cx;
        centers[v * 2 + 1] = cz;
        phases[v] = phase;
      }
      g.setAttribute('aCenter', new THREE.BufferAttribute(centers, 2));
      g.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
      shaftParts.push(g);
    }
    this.shaftIndexPerShaft = shaftParts[0].index!.count;
    const shaftGeometry = mergeGeometries(shaftParts, false)!;
    shaftParts.forEach((g) => g.dispose());
    this.shafts = new THREE.Mesh(
      shaftGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: time,
          uBox: { value: SHAFT_BOX },
          uLean: { value: new THREE.Vector3(5, 0, 3.4) },
          uColor: { value: new THREE.Color('#d8fbff') },
          uIntensity: { value: 0.22 },
        },
        vertexShader: SHAFT_VERTEX,
        fragmentShader: SHAFT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 3;
    this.group.add(this.shafts);

    // Marine snow.
    const snowPositions = new Float32Array(SNOW_MAX * 3);
    const snowSeeds = new Float32Array(SNOW_MAX);
    for (let i = 0; i < SNOW_MAX; i += 1) {
      snowPositions[i * 3] = rand() * SNOW_BOX;
      snowPositions[i * 3 + 1] = rand() * SNOW_BOX;
      snowPositions[i * 3 + 2] = rand() * SNOW_BOX;
      snowSeeds[i] = rand() * 100;
    }
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
    snowGeometry.setAttribute('aSeed', new THREE.BufferAttribute(snowSeeds, 1));
    this.snow = new THREE.Points(
      snowGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: time,
          uBox: { value: SNOW_BOX },
          uSize: { value: 0.07 },
          uColor: { value: new THREE.Color('#e6fbff') },
          uGlowColor: glowColor,
          uGlow: glow,
        },
        vertexShader: SNOW_VERTEX,
        fragmentShader: SNOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 4;
    this.group.add(this.snow);

    // Bubbles.
    const bubbleGeometry = new THREE.BufferGeometry();
    bubbleGeometry.setAttribute('position', new THREE.BufferAttribute(this.bubblePositions, 3));
    this.bubbleAlpha = new THREE.BufferAttribute(new Float32Array(BUBBLE_POOL_SIZE), 1);
    bubbleGeometry.setAttribute('aAlpha', this.bubbleAlpha);
    const sizes = new Float32Array(BUBBLE_POOL_SIZE);
    for (let i = 0; i < BUBBLE_POOL_SIZE; i += 1) sizes[i] = 0.07 + rand() * 0.12;
    bubbleGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.bubbles = new THREE.Points(
      bubbleGeometry,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#bff0ff') } },
        vertexShader: BUBBLE_VERTEX,
        fragmentShader: BUBBLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 5;
    this.group.add(this.bubbles);

    parent.add(this.group);
  }

  setQuality(shafts: number, snow: number) {
    this.shafts.geometry.setDrawRange(0, Math.min(SHAFT_MAX, shafts) * this.shaftIndexPerShaft);
    this.snow.geometry.setDrawRange(0, Math.min(SNOW_MAX, snow));
  }

  setLook(look: UnderwaterFxLook) {
    const u = this.shafts.material.uniforms;
    u.uColor.value.copy(look.shaftColor);
    u.uIntensity.value = look.shaftIntensity;
    this.snow.material.uniforms.uColor.value.copy(look.snowColor);
  }

  /** Shafts lean away from the sun: pass the horizontal direction toward it. */
  setSunLean(toSunX: number, toSunZ: number) {
    const len = Math.hypot(toSunX, toSunZ) || 1;
    this.shafts.material.uniforms.uLean.value.set((-toSunX / len) * 6, 0, (-toSunZ / len) * 6);
  }

  private spawnBubble(x: number, y: number, z: number, spread: number) {
    const i = this.bubbleCursor;
    this.bubbleCursor = (this.bubbleCursor + 1) % BUBBLE_POOL_SIZE;
    this.bubblePositions[i * 3] = x + (Math.random() - 0.5) * spread;
    this.bubblePositions[i * 3 + 1] = y + (Math.random() - 0.5) * spread * 0.5;
    this.bubblePositions[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    this.bubbleVelocities[i * 3] = (Math.random() - 0.5) * 0.3;
    this.bubbleVelocities[i * 3 + 1] = BUBBLE_RISE_MIN + Math.random() * (BUBBLE_RISE_MAX - BUBBLE_RISE_MIN);
    this.bubbleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    this.bubbleAges[i] = 0;
  }

  /** A burst of bubbles (the splash of a dive). */
  burst(origin: THREE.Vector3, count: number) {
    for (let n = 0; n < count; n += 1) this.spawnBubble(origin.x, origin.y - 0.6, origin.z, 2.4);
  }

  update(dt: number, birdPosition: THREE.Vector3, surfaceY: number) {
    this.bubbleAccumulator += dt * BUBBLE_SPAWN_PER_SECOND;
    while (this.bubbleAccumulator >= 1) {
      this.spawnBubble(birdPosition.x, birdPosition.y, birdPosition.z, 1.2);
      this.bubbleAccumulator -= 1;
    }
    const alpha = this.bubbleAlpha.array as Float32Array;
    for (let i = 0; i < BUBBLE_POOL_SIZE; i += 1) {
      const age = this.bubbleAges[i];
      if (age > BUBBLE_LIFETIME) {
        this.bubblePositions[i * 3 + 1] = BUBBLE_HIDDEN_Y;
        alpha[i] = 0;
        continue;
      }
      this.bubbleAges[i] = age + dt;
      // A little wobble as they rise.
      this.bubblePositions[i * 3] += (this.bubbleVelocities[i * 3] + Math.sin(age * 7 + i) * 0.25) * dt;
      this.bubblePositions[i * 3 + 1] += this.bubbleVelocities[i * 3 + 1] * dt;
      this.bubblePositions[i * 3 + 2] += (this.bubbleVelocities[i * 3 + 2] + Math.cos(age * 6 + i) * 0.25) * dt;
      if (this.bubblePositions[i * 3 + 1] > surfaceY - 0.3) {
        this.bubbleAges[i] = BUBBLE_LIFETIME + 1;
        this.bubblePositions[i * 3 + 1] = BUBBLE_HIDDEN_Y;
        alpha[i] = 0;
        continue;
      }
      const t = age / BUBBLE_LIFETIME;
      alpha[i] = Math.min(1, age * 6) * (1 - t * t);
    }
    (this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.bubbleAlpha.needsUpdate = true;
  }

  /** Hide pending bubbles (on surfacing), so a re-dive doesn't show stale ones. */
  clearBubbles() {
    this.bubbleAges.fill(BUBBLE_LIFETIME + 1);
    this.bubblePositions.fill(BUBBLE_HIDDEN_Y);
    (this.bubbleAlpha.array as Float32Array).fill(0);
  }

  dispose() {
    this.group.removeFromParent();
    for (const obj of [this.shafts, this.snow, this.bubbles]) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
  }
}
