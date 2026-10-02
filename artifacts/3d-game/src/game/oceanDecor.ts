import * as THREE from 'three';
import { bake, jitter, mergeBaked, ribbon } from './lowPoly';
import { ISLAND_CELL, cellSeed, islandAt, mulberry32, type Island, type OceanField } from './oceanField';
import { patchOceanMaterial, type OceanUniforms } from './oceanShaders';
import type { PerchPoint } from './landingSurface';

// Above-water island dressing: instanced palm trees, bushes and shore rocks on every island near
// the bird (three draw calls for all of them), and a ring of hazy island silhouettes on the
// horizon (one more), so the sea reads as an archipelago rather than a flat plane.

const PALM_CAPACITY = 640;
const BUSH_CAPACITY = 900;
const ROCK_CAPACITY = 720;
// Rebuild the instance lists once the bird has moved this far since the last rebuild. Islands
// come into range at the fogged edge, so a coarse step never shows popping.
const REFRESH_DISTANCE = 30;
// Bounded per-island decoration cache (matrices are deterministic, so evicting only costs a rebuild).
const DECOR_CACHE_LIMIT = 600;

const HORIZON_ISLANDS = 22;
const HORIZON_RADIUS_MIN = 620;
const HORIZON_RADIUS_MAX = 780;
const HORIZON_SINK = 14;
// A fog-coloured apron from just inside the water mesh's rim out past the silhouettes, so the
// horizon is one seamless haze instead of showing the sky dome under the world's edge.
const SKIRT_INNER = 440;
const SKIRT_OUTER = 890;

interface IslandDecorSet {
  palms: Float32Array;
  bushes: Float32Array;
  rocks: Float32Array;
  palmColors: Float32Array;
  bushColors: Float32Array;
  rockColors: Float32Array;
  /** Standable rock tops, computed once from the rock instance matrices (see rockTop). */
  perches: PerchPoint[];
}

// A rock's standable top: the vertices within this much of its highest point (in its own scaled
// height) make the flat-ish cap the bird can stand on.
const ROCK_TOP_BAND = 0.18;
const MIN_PERCH_RADIUS = 0.3;

function buildPalm() {
  const height = 7;
  const bend = 1.5;
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, height, 6, 7, true);
  trunk.translate(0, height / 2, 0);
  const tp = trunk.getAttribute('position');
  for (let i = 0; i < tp.count; i += 1) {
    const t = tp.getY(i) / height;
    tp.setX(i, tp.getX(i) + bend * t * t);
  }
  const parts = [
    bake(trunk, (_x, y) => (Math.floor(y / 0.55) % 2 === 0 ? '#8d6a43' : '#6f5233'), { aSway: (_x, y) => (y / height) ** 2 * 0.35 }),
  ];
  const frondCount = 8;
  for (let f = 0; f < frondCount; f += 1) {
    const leaf = ribbon(0.9, 3.6, 5, 0.9);
    // Droop: bend the ribbon over as it gets longer.
    const lp = leaf.getAttribute('position');
    for (let i = 0; i < lp.count; i += 1) {
      const s = lp.getY(i) / 3.6;
      lp.setXYZ(i, lp.getX(i), s * 1.4 - s * s * 2.3, s * 3.2);
    }
    leaf.rotateY((f / frondCount) * Math.PI * 2 + (f % 2) * 0.2);
    leaf.translate(bend, height - 0.05, 0);
    parts.push(bake(leaf, (x, y) => (y > height - 0.3 ? '#3f8f3a' : '#5eaa45'), { aSway: 1 }));
  }
  return mergeBaked(parts);
}

function buildBush() {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 0.55, 0, 0.8],
    [0.6, 0.4, 0.25, 0.6],
    [-0.5, 0.4, -0.3, 0.62],
    [0.1, 0.35, -0.65, 0.5],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    const g = jitter(new THREE.IcosahedronGeometry(r, 0), 0.18, i);
    g.translate(x, y, z);
    parts.push(bake(g, (_x, yy) => (yy > 0.7 ? '#8ccf5c' : '#5f9f45'), { aSway: 0 }));
  });
  return mergeBaked(parts);
}

function buildRock() {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.22, 3);
  g.scale(1, 0.6, 1);
  return mergeBaked([bake(g, (_x, y) => (y > 0.25 ? '#9a938a' : '#77716b'), { aSway: 0 })]);
}

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchColor = new THREE.Color();
const scratchVertex = new THREE.Vector3();

/**
 * The top of one rock instance, from the rock geometry's own vertices put through its instance
 * matrix: the highest point, and the cap of vertices just below it (their centroid and spread give
 * the perch's center and radius). Exact for the drawn mesh, and computed once per island, never
 * per frame (no raycasts).
 */
function rockTop(vertices: Float32Array, matrix: THREE.Matrix4, heightScale: number): PerchPoint {
  let maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    scratchVertex.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(matrix);
    if (scratchVertex.y > maxY) maxY = scratchVertex.y;
  }
  const band = ROCK_TOP_BAND * heightScale;
  let cx = 0;
  let cz = 0;
  let count = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    scratchVertex.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(matrix);
    if (scratchVertex.y < maxY - band) continue;
    cx += scratchVertex.x;
    cz += scratchVertex.z;
    count += 1;
  }
  cx /= count;
  cz /= count;
  let radius = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    scratchVertex.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(matrix);
    if (scratchVertex.y < maxY - band) continue;
    radius = Math.max(radius, Math.hypot(scratchVertex.x - cx, scratchVertex.z - cz));
  }
  return { x: cx, y: maxY, z: cz, radius: Math.max(MIN_PERCH_RADIUS, radius), kind: 'rock' };
}
/** Palms, bushes and shore rocks for every island near the bird, as three instanced meshes. */
export class IslandDecor {
  private palms: THREE.InstancedMesh;
  private bushes: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private cache = new Map<number, IslandDecorSet>();
  private lastRefresh = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private radius: number;
  // The rock geometry's vertex positions, for computing each rock's standable top.
  private rockVertices: Float32Array;
  private perchScratch: PerchPoint[] = [];

  constructor(
    parent: THREE.Object3D,
    private field: OceanField,
    uniforms: OceanUniforms,
    radius: number,
  ) {
    this.radius = radius;
    const sway = /* glsl */ `
      float w = sin(uTime * 1.3 + oceanOrigin.x * 0.13 + oceanOrigin.z * 0.11) * 0.6 + sin(uTime * 2.3 + oceanOrigin.z * 0.3) * 0.25;
      transformed.x += w * aSway * 0.35;
      transformed.z += w * aSway * 0.22;`;
    const makeMaterial = (key: string, side: THREE.Side) =>
      patchOceanMaterial(
        new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side }),
        uniforms,
        { key, vertex: sway, vertexHeader: 'attribute float aSway;' },
      );
    this.palms = new THREE.InstancedMesh(buildPalm(), makeMaterial('palm', THREE.DoubleSide), PALM_CAPACITY);
    this.bushes = new THREE.InstancedMesh(buildBush(), makeMaterial('bush', THREE.FrontSide), BUSH_CAPACITY);
    this.rocks = new THREE.InstancedMesh(buildRock(), makeMaterial('rock', THREE.FrontSide), ROCK_CAPACITY);
    this.rockVertices = (this.rocks.geometry.getAttribute('position').array as Float32Array).slice();
    for (const mesh of [this.palms, this.bushes, this.rocks]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      // Allocate instanceColor up front (setColorAt does it lazily otherwise).
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      parent.add(mesh);
    }
  }

  setRadius(radius: number) {
    this.radius = radius;
    this.lastRefresh.set(Number.NaN, 0, Number.NaN);
  }

  setVisible(visible: boolean) {
    this.palms.visible = visible;
    this.bushes.visible = visible;
    this.rocks.visible = visible;
  }

  private buildIsland(cx: number, cz: number, island: Island): IslandDecorSet {
    const rng = mulberry32(cellSeed(cx, cz, 17));
    const palms: number[] = [];
    const bushes: number[] = [];
    const rocks: number[] = [];
    const palmColors: number[] = [];
    const bushColors: number[] = [];
    const rockColors: number[] = [];
    const perches: PerchPoint[] = [];
    const push = (out: number[], colors: number[], x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tint: THREE.Color, tilt = 0) => {
      scratchPos.set(x, y, z);
      scratchEuler.set(tilt, yaw, tilt * 0.5);
      scratchQuat.setFromEuler(scratchEuler);
      scratchScale.set(sx, sy, sz);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      out.push(...scratchMatrix.elements);
      colors.push(tint.r, tint.g, tint.b);
    };
    const r = island.radius;

    // Palms in the sandy/grassy ring above the beach, leaning seaward.
    const palmCount = 2 + Math.floor(rng() * (r / 3.2));
    for (let i = 0; i < palmCount; i += 1) {
      const a = rng() * Math.PI * 2;
      const d = r * (0.32 + rng() * 0.42);
      const x = island.x + Math.cos(a) * d;
      const z = island.z + Math.sin(a) * d;
      const h = this.field.groundHeight(x, z);
      if (h < 0.6) continue;
      const s = 0.75 + rng() * 0.55;
      // The model leans along +X; point that outward (seaward), with some spread.
      const yaw = -a + (rng() - 0.5) * 0.9;
      push(palms, palmColors, x, h - 0.2, z, yaw, s, s * (0.85 + rng() * 0.3), s, scratchColor.setHSL(0.28, 0.2, 0.9 + rng() * 0.1));
    }
    // Bushes on the green top.
    const bushCount = 3 + Math.floor(rng() * (r / 2.6));
    for (let i = 0; i < bushCount; i += 1) {
      const a = rng() * Math.PI * 2;
      const d = r * Math.sqrt(rng()) * 0.62;
      const x = island.x + Math.cos(a) * d;
      const z = island.z + Math.sin(a) * d;
      const h = this.field.groundHeight(x, z);
      if (h < 1.6) continue;
      const s = 0.8 + rng() * 1.1;
      push(bushes, bushColors, x, h - 0.15, z, rng() * 6.28, s, s * (0.7 + rng() * 0.5), s, scratchColor.setHSL(0.22 + rng() * 0.1, 0.5, 0.7 + rng() * 0.3));
    }
    // Rocks along the shoreline, half in the surf.
    const rockCount = 2 + Math.floor(rng() * 5);
    for (let i = 0; i < rockCount; i += 1) {
      const a = rng() * Math.PI * 2;
      const d = r * (0.9 + rng() * 0.22);
      const x = island.x + Math.cos(a) * d;
      const z = island.z + Math.sin(a) * d;
      const h = this.field.groundHeight(x, z);
      const s = 0.6 + rng() * 1.3;
      const sy = s * (0.8 + rng() * 0.8);
      push(rocks, rockColors, x, h - 0.1, z, rng() * 6.28, s * (1 + rng() * 0.5), sy, s, scratchColor.setHSL(0.08, 0.1, 0.75 + rng() * 0.25), (rng() - 0.5) * 0.4);
      // `push` left this rock's matrix in scratchMatrix.
      perches.push(rockTop(this.rockVertices, scratchMatrix, sy));
    }
    return {
      palms: new Float32Array(palms),
      bushes: new Float32Array(bushes),
      rocks: new Float32Array(rocks),
      palmColors: new Float32Array(palmColors),
      bushColors: new Float32Array(bushColors),
      rockColors: new Float32Array(rockColors),
      perches,
    };
  }

  private islandSet(cx: number, cz: number, island: Island) {
    const key = (cx + 32768) * 65536 + (cz + 32768);
    let set = this.cache.get(key);
    if (!set) {
      if (this.cache.size >= DECOR_CACHE_LIMIT) this.cache.clear();
      set = this.buildIsland(cx, cz, island);
      this.cache.set(key, set);
    }
    return set;
  }

  /**
   * The standable rock tops of the islands around (x, z) (the 3x3 island cells). Returns a reused
   * array; its perches are cached per island, so this allocates nothing once an island is built.
   */
  perchesNear(x: number, z: number): readonly PerchPoint[] {
    const out = this.perchScratch;
    out.length = 0;
    const ccx = Math.round(x / ISLAND_CELL);
    const ccz = Math.round(z / ISLAND_CELL);
    for (let cx = ccx - 1; cx <= ccx + 1; cx += 1) {
      for (let cz = ccz - 1; cz <= ccz + 1; cz += 1) {
        const island = islandAt(cx, cz);
        if (!island) continue;
        for (const perch of this.islandSet(cx, cz, island).perches) out.push(perch);
      }
    }
    return out;
  }

  /** Rebuilds the instance lists when the bird has moved far enough. Cheap: cached per island. */
  update(position: THREE.Vector3) {
    const dx = position.x - this.lastRefresh.x;
    const dz = position.z - this.lastRefresh.z;
    if (dx * dx + dz * dz < REFRESH_DISTANCE * REFRESH_DISTANCE) return;
    this.lastRefresh.set(position.x, 0, position.z);

    let palmCount = 0;
    let bushCount = 0;
    let rockCount = 0;
    const cells = Math.ceil(this.radius / ISLAND_CELL) + 1;
    const ccx = Math.round(position.x / ISLAND_CELL);
    const ccz = Math.round(position.z / ISLAND_CELL);
    const r2 = this.radius * this.radius;
    const copy = (mesh: THREE.InstancedMesh, matrices: Float32Array, colors: Float32Array, start: number) => {
      const n = Math.min(matrices.length / 16, mesh.instanceMatrix.count - start);
      if (n <= 0) return start;
      (mesh.instanceMatrix.array as Float32Array).set(matrices.subarray(0, n * 16), start * 16);
      (mesh.instanceColor!.array as Float32Array).set(colors.subarray(0, n * 3), start * 3);
      return start + n;
    };
    for (let cx = ccx - cells; cx <= ccx + cells; cx += 1) {
      for (let cz = ccz - cells; cz <= ccz + cells; cz += 1) {
        const island = islandAt(cx, cz);
        if (!island) continue;
        const ix = island.x - position.x;
        const iz = island.z - position.z;
        if (ix * ix + iz * iz > r2) continue;
        const set = this.islandSet(cx, cz, island);
        palmCount = copy(this.palms, set.palms, set.palmColors, palmCount);
        bushCount = copy(this.bushes, set.bushes, set.bushColors, bushCount);
        rockCount = copy(this.rocks, set.rocks, set.rockColors, rockCount);
      }
    }
    for (const [mesh, count] of [
      [this.palms, palmCount],
      [this.bushes, bushCount],
      [this.rocks, rockCount],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of [this.palms, this.bushes, this.rocks]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}

const HORIZON_VERTEX = /* glsl */ `
attribute float aShade;
attribute float aSkirt;
varying float vShade;
varying float vSkirt;
void main() {
  vShade = aShade;
  vSkirt = aSkirt;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HORIZON_FRAGMENT = /* glsl */ `
uniform vec3 fogColor;
uniform vec3 uTint;
uniform float uOpacity;
varying float vShade;
varying float vSkirt;
void main() {
  // Silhouettes: the horizon haze, deepening toward their peaks; the skirt is pure haze.
  vec3 col = mix(fogColor, uTint, vShade * uOpacity);
  gl_FragColor = vec4(mix(col, fogColor, vSkirt), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Distant island silhouettes and a fog-coloured horizon apron, following the bird on XZ. */
export class HorizonIslands {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(parent: THREE.Object3D) {
    const rng = mulberry32(90210);
    const positions: number[] = [];
    const shade: number[] = [];
    const skirt: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], sa: number, sb: number, sc: number, sd: number, k: number) => {
      positions.push(...a, ...c, ...b, ...b, ...c, ...d);
      shade.push(sa, sc, sb, sb, sc, sd);
      skirt.push(k, k, k, k, k, k);
    };
    for (let i = 0; i < HORIZON_ISLANDS; i += 1) {
      const angle = (i / HORIZON_ISLANDS) * Math.PI * 2 + rng() * 0.2;
      const radius = HORIZON_RADIUS_MIN + rng() * (HORIZON_RADIUS_MAX - HORIZON_RADIUS_MIN);
      const width = 60 + rng() * 150;
      const height = 12 + rng() * 38;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      // Tangent direction, so each silhouette faces the ring's center (where the camera is).
      const tx = -Math.sin(angle);
      const tz = Math.cos(angle);
      const steps = 9;
      let prev: [number[], number[], number] | null = null;
      for (let s = 0; s <= steps; s += 1) {
        const u = (s / steps) * 2 - 1;
        const profile = Math.pow(Math.max(0, 1 - u * u), 0.75) * (0.75 + 0.25 * Math.sin(u * 7 + i));
        const peak = height * profile;
        const px = cx + tx * u * width * 0.5;
        const pz = cz + tz * u * width * 0.5;
        const bottom = [px, -HORIZON_SINK, pz];
        const top = [px, peak, pz];
        const topShade = profile;
        if (prev) quad(prev[0], prev[1], bottom, top, 0, prev[2], 0, topShade, 0);
        prev = [bottom, top, topShade];
      }
    }
    // The skirt: a flat ring just below the water line, drawn as pure fog colour.
    const segments = 48;
    for (let s = 0; s < segments; s += 1) {
      const a0 = (s / segments) * Math.PI * 2;
      const a1 = ((s + 1) / segments) * Math.PI * 2;
      const y = -0.6;
      quad(
        [Math.cos(a0) * SKIRT_INNER, y, Math.sin(a0) * SKIRT_INNER],
        [Math.cos(a1) * SKIRT_INNER, y, Math.sin(a1) * SKIRT_INNER],
        [Math.cos(a0) * SKIRT_OUTER, y, Math.sin(a0) * SKIRT_OUTER],
        [Math.cos(a1) * SKIRT_OUTER, y, Math.sin(a1) * SKIRT_OUTER],
        0,
        0,
        0,
        0,
        1,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    geometry.setAttribute('aSkirt', new THREE.Float32BufferAttribute(skirt, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTint: { value: new THREE.Color('#5d7f8f') }, uOpacity: { value: 0.55 } }]),
      vertexShader: HORIZON_VERTEX,
      fragmentShader: HORIZON_FRAGMENT,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }

  follow(position: THREE.Vector3) {
    this.mesh.position.set(position.x, 0, position.z);
  }

  /** The silhouettes' peak colour and how far they deepen from the haze toward it. */
  setTint(tint: THREE.Color, opacity: number) {
    this.mesh.material.uniforms.uTint.value.copy(tint);
    this.mesh.material.uniforms.uOpacity.value = opacity;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

