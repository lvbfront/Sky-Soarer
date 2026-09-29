import * as THREE from 'three';
import { bake, jitter, mergeBaked, ribbon } from './lowPoly';
import { TILE_SIZE, cellSeed, mulberry32, smoothstep, type GroundSample, type OceanField } from './oceanField';
import { patchOceanMaterial, type OceanUniforms } from './oceanShaders';

// The reef: nine species (branching, brain and fan coral, kelp, seaweed, anemones, rocks,
// starfish, shells), each ONE InstancedMesh, so the whole reef is nine draw calls however dense it
// is. Items are scattered per streamed tile from a seeded RNG (the same reef every visit), sitting
// on the real ground height, clustered by a low-frequency noise and much denser on the reef
// slopes around islands. Kelp, seaweed, fans and anemone tentacles sway in the vertex shader.
//
// Tiles are generated in half-tile jobs (~1 ms each) ahead of time, whenever the bird is low over
// the sea, so a dive never waits on them. Only items within the quality's radius are copied into
// the instance buffers, refreshed every few units of travel.

type Species = 'branch' | 'brain' | 'fan' | 'kelp' | 'seaweed' | 'anemone' | 'rock' | 'starfish' | 'shell';
const SPECIES: readonly Species[] = ['branch', 'brain', 'fan', 'kelp', 'seaweed', 'anemone', 'rock', 'starfish', 'shell'];

const PALETTES: Record<Species, string[]> = {
  branch: ['#ff6f61', '#ff9a3c', '#f76fc0', '#ffd23f', '#c77dff', '#ff5d8f'],
  brain: ['#e9b872', '#d98c5f', '#b5c96a', '#c9a0dc', '#f2c14e'],
  fan: ['#ff4f79', '#a56cff', '#ff8a3d', '#ffcf40', '#ff6fb5'],
  kelp: ['#4f8f3f', '#6a9b3a', '#3f7d4f', '#7ea343'],
  seaweed: ['#5aa04a', '#9ccf4a', '#c0533f', '#3f8f6f', '#d9803f'],
  anemone: ['#ff7ac8', '#ffa64d', '#8f86ff', '#58e0d0', '#b4ff6a'],
  rock: ['#8a8178', '#76706a', '#9a9087', '#6d6863', '#877c86'],
  starfish: ['#ff6a3d', '#e84a5f', '#b05bd6', '#ffb13b'],
  shell: ['#fff1dc', '#ffd9e8', '#f5e3c3', '#e8f1ff'],
};

const CAPACITY = 1400;
// Candidate spacing for the scatter (a jittered grid), and the base chance a candidate holds an
// item on the open seabed, on a reef slope, and in a dense cluster.
const CANDIDATE_STEP = 2.7;
const DENSITY_OPEN = 0.05;
const DENSITY_REEF = 0.95;
const DENSITY_CLUSTER = 0.32;
// Nothing grows shallower than this (the beach and the surf zone).
const MIN_DEPTH = 1.4;
// Kelp stops this far below the surface.
const KELP_TOP_CLEARANCE = 1.6;
const TILE_RADIUS = 1;
const TILE_CACHE_LIMIT = 30;
// Kelp and fans shrink away between these distances from the camera (see REEF_SWAY).
const NEAR_FADE_START = 1.2;
const NEAR_FADE_END = 3.4;
// Rebuild the visible lists after this much travel (items enter at the fogged edge).
const REFRESH_DISTANCE = 5;

interface ReefTile {
  /** Per species: matrices (16 floats), colors (3), positions (x, z) and LOD rank per item. */
  matrices: Float32Array[];
  colors: Float32Array[];
  positions: Float32Array[];
  ranks: Float32Array[];
}

interface TileBuild {
  tileX: number;
  tileZ: number;
  rows: number;
  nextRow: number;
  rng: () => number;
  items: { m: number[]; c: number[]; p: number[]; r: number[] }[];
}

// ---- Geometry (unit-sized; instance scale sets the real size) --------------------------------

const gray = (lo: number, hi: number, yMax: number) => (_x: number, y: number) => {
  const t = THREE.MathUtils.clamp(y / yMax, 0, 1);
  const v = lo + (hi - lo) * t;
  return new THREE.Color(v, v, v);
};

function buildBranchCoral() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry) => parts.push(bake(g, gray(0.55, 1, 1.1), { aSway: 0, aGlow: (_x, y) => (y > 0.85 ? 1 : 0) }));
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 0.45, 5);
  trunk.translate(0, 0.22, 0);
  add(trunk);
  const branches = 4;
  for (let b = 0; b < branches; b += 1) {
    const yaw = (b / branches) * Math.PI * 2 + b * 0.4;
    const tilt = 0.45 + (b % 3) * 0.15;
    const len = 0.55 + (b % 2) * 0.2;
    const arm = new THREE.CylinderGeometry(0.05, 0.09, len, 4);
    arm.translate(0, len / 2, 0);
    arm.rotateZ(tilt);
    arm.rotateY(yaw);
    arm.translate(0, 0.42, 0);
    add(arm);
    // Tip direction, for the fork.
    const tipX = -Math.sin(tilt) * len * Math.cos(yaw);
    const tipZ = Math.sin(tilt) * len * Math.sin(yaw);
    const tipY = 0.42 + Math.cos(tilt) * len;
    for (let f = -1; f <= 1; f += 2) {
      const twig = new THREE.CylinderGeometry(0.03, 0.05, 0.32, 3);
      twig.translate(0, 0.16, 0);
      twig.rotateZ(tilt * 0.3 + f * 0.35);
      twig.rotateY(yaw + f * 0.5);
      twig.translate(tipX, tipY - 0.02, tipZ);
      add(twig);
    }
  }
  return mergeBaked(parts);
}

function buildBrainCoral() {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.12, 5);
  g.scale(1, 0.62, 1);
  g.translate(0, 0.35, 0);
  // Grooves: alternating pale and dark bands.
  return mergeBaked([bake(g, (x, y, z) => (Math.sin(x * 7 + z * 5 + y * 3) > 0 ? '#ffffff' : '#b8b0a8'), { aSway: 0, aGlow: 0 })]);
}

function buildFanCoral() {
  const fan = new THREE.CircleGeometry(1, 9, 0, Math.PI);
  const pos = fan.getAttribute('position');
  // Bend the fan into a gentle curve so it catches light on both sides.
  for (let i = 0; i < pos.count; i += 1) pos.setZ(i, Math.sin(pos.getX(i) * 1.4) * 0.12);
  fan.translate(0, 0.18, 0);
  const stem = new THREE.CylinderGeometry(0.04, 0.07, 0.25, 4);
  stem.translate(0, 0.1, 0);
  return mergeBaked([
    bake(fan, (x, y) => (Math.hypot(x, y - 0.18) > 0.82 ? '#ffffff' : Math.sin(x * 16) * Math.sin(y * 16) > 0.2 ? '#d6d0d0' : '#f2eeee'), {
      aSway: (_x, y) => y * 0.1,
      aGlow: (x, y) => (Math.hypot(x, y - 0.18) > 0.82 ? 1 : 0),
    }),
    bake(stem, '#8a7f7a', { aSway: 0, aGlow: 0 }),
  ]);
}

function buildKelp() {
  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 2; b += 1) {
    const blade = ribbon(0.6, 1, 7, 0.55);
    const pos = blade.getAttribute('position');
    // A slow twist up the stalk.
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const a = y * 1.6 + b * (Math.PI / 2);
      const x = pos.getX(i);
      pos.setXYZ(i, Math.cos(a) * x, y, Math.sin(a) * x);
    }
    parts.push(bake(blade, gray(0.55, 1, 1), { aSway: (_x, y) => 0.85 * y * y, aGlow: 0 }));
  }
  return mergeBaked(parts);
}

function buildSeaweed() {
  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 6; b += 1) {
    const h = 0.6 + (b % 3) * 0.2;
    const blade = new THREE.ConeGeometry(0.06, h, 3);
    blade.translate(0, h / 2, 0);
    blade.rotateZ(((b % 3) - 1) * 0.3);
    blade.rotateY((b / 6) * Math.PI * 2);
    blade.translate(Math.cos(b * 2.1) * 0.15, 0, Math.sin(b * 2.1) * 0.15);
    parts.push(bake(blade, gray(0.6, 1, 1), { aSway: (_x, y) => 0.3 * y * y, aGlow: 0 }));
  }
  return mergeBaked(parts);
}

function buildAnemone() {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(0.26, 0.3, 0.26, 7);
  base.translate(0, 0.13, 0);
  parts.push(bake(base, '#a89a94', { aSway: 0, aGlow: 0 }));
  const count = 10;
  for (let i = 0; i < count; i += 1) {
    const inner = i % 2 === 0;
    const a = (i / count) * Math.PI * 2;
    const r = inner ? 0.12 : 0.22;
    const t = new THREE.ConeGeometry(0.04, 0.38, 3);
    t.translate(0, 0.19, 0);
    t.rotateX(Math.sin(a) * (inner ? 0.25 : 0.6));
    t.rotateZ(-Math.cos(a) * (inner ? 0.25 : 0.6));
    t.translate(Math.cos(a) * r, 0.24, Math.sin(a) * r);
    parts.push(bake(t, (_x, y) => (y > 0.5 ? '#ffffff' : '#e0d6de'), { aSway: (_x, y) => Math.max(0, y - 0.25) * 0.35, aGlow: (_x, y) => (y > 0.48 ? 1 : 0.2) }));
  }
  return mergeBaked(parts);
}

function buildRock() {
  const g = jitter(new THREE.IcosahedronGeometry(1, 0), 0.3, 11);
  g.scale(1, 0.7, 1);
  g.translate(0, 0.25, 0);
  return mergeBaked([bake(g, (_x, y) => (y > 0.45 ? '#ffffff' : '#c9c4bf'), { aSway: 0, aGlow: 0 })]);
}

function buildStarfish() {
  const positions: number[] = [];
  const arms = 5;
  const top = [0, 0.12, 0];
  for (let i = 0; i < arms * 2; i += 1) {
    const a0 = (i / (arms * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (arms * 2)) * Math.PI * 2;
    const r0 = i % 2 === 0 ? 1 : 0.38;
    const r1 = i % 2 === 0 ? 0.38 : 1;
    const p0 = [Math.cos(a0) * r0, 0.02, Math.sin(a0) * r0];
    const p1 = [Math.cos(a1) * r1, 0.02, Math.sin(a1) * r1];
    positions.push(...top, ...p1, ...p0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return mergeBaked([bake(g, (x, y, z) => (Math.hypot(x, z) < 0.3 && y > 0.05 ? '#ffe7d6' : '#ffffff'), { aSway: 0, aGlow: 0 })]);
}

function buildShell() {
  const g = new THREE.ConeGeometry(0.45, 1, 6);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.7, 1);
  g.translate(0, 0.2, 0);
  return mergeBaked([bake(g, (_x, _y, z) => (Math.sin(z * 14) > 0 ? '#ffffff' : '#d9c8b8'), { aSway: 0, aGlow: 0 })]);
}

const BUILDERS: Record<Species, () => THREE.BufferGeometry> = {
  branch: buildBranchCoral,
  brain: buildBrainCoral,
  fan: buildFanCoral,
  kelp: buildKelp,
  seaweed: buildSeaweed,
  anemone: buildAnemone,
  rock: buildRock,
  starfish: buildStarfish,
  shell: buildShell,
};

const REEF_SWAY = /* glsl */ `
  float swayA = sin(uTime * 1.15 + oceanOrigin.x * 0.23 + oceanOrigin.z * 0.19 + position.y * 1.3);
  float swayB = cos(uTime * 0.8 + oceanOrigin.z * 0.31 + position.y * 0.9);
  transformed.x += swayA * aSway;
  transformed.z += swayB * aSway * 0.6;
#ifdef USE_INSTANCING
  // Tall, wide plants (kelp, fans) thin to nothing as the chase camera reaches their stalk, so
  // flying through a kelp forest never puts a blade across the whole screen.
  if (uNearFade > 0.0) {
    float stalk = length(instanceMatrix[1].xyz);
    vec3 nearest = vec3(oceanOrigin.x, clamp(cameraPosition.y, oceanOrigin.y, oceanOrigin.y + stalk), oceanOrigin.z);
    transformed.xz *= mix(1.0, smoothstep(${NEAR_FADE_START.toFixed(1)}, ${NEAR_FADE_END.toFixed(1)}, distance(cameraPosition, nearest)), uNearFade);
  }
#endif`;

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchColor = new THREE.Color();

export class Reef {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private tiles = new Map<string, ReefTile>();
  private builds: TileBuild[] = [];
  private lastRefresh = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private prefetchedTile = { x: Number.NaN, z: Number.NaN };
  private dirty = true;
  private density = 1;
  private radius = 62;
  private sample: GroundSample = { height: 0, rock: 0, reef: 0, shoreDistance: 0 };

  constructor(
    parent: THREE.Object3D,
    private field: OceanField,
    uniforms: OceanUniforms,
  ) {
    for (const species of SPECIES) {
      const material = patchOceanMaterial(
        new THREE.MeshLambertMaterial({
          vertexColors: true,
          flatShading: true,
          side: species === 'kelp' || species === 'fan' ? THREE.DoubleSide : THREE.FrontSide,
        }),
        uniforms,
        {
          key: 'reef',
          caustics: true,
          glow: true,
          vertex: REEF_SWAY,
          vertexHeader: 'attribute float aSway;\nuniform float uNearFade;',
          uniforms: { uNearFade: { value: species === 'kelp' || species === 'fan' ? 1 : 0 } },
        },
      );
      const mesh = new THREE.InstancedMesh(BUILDERS[species](), material, CAPACITY);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    parent.add(this.group);
  }

  setQuality(density: number, radius: number) {
    this.density = density;
    this.radius = radius;
    this.dirty = true;
  }

  /** Starts generating (in the background) the reef tiles around `position` that aren't built yet. */
  prefetch(position: THREE.Vector3) {
    const tx = Math.round(position.x / TILE_SIZE);
    const tz = Math.round(position.z / TILE_SIZE);
    if (tx === this.prefetchedTile.x && tz === this.prefetchedTile.z) return;
    this.prefetchedTile.x = tx;
    this.prefetchedTile.z = tz;
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx += 1) {
      for (let dz = -TILE_RADIUS; dz <= TILE_RADIUS; dz += 1) {
        const x = tx + dx;
        const z = tz + dz;
        const key = `${x},${z}`;
        if (this.tiles.has(key) || this.builds.some((b) => b.tileX === x && b.tileZ === z)) continue;
        this.builds.push({
          tileX: x,
          tileZ: z,
          rows: Math.ceil(TILE_SIZE / CANDIDATE_STEP),
          nextRow: 0,
          rng: mulberry32(cellSeed(x, z, 5)),
          items: SPECIES.map(() => ({ m: [], c: [], p: [], r: [] })),
        });
      }
    }
    // Nearest first (the bird's own tile is dx = dz = 0).
    this.builds.sort((a, b) => Math.max(Math.abs(a.tileX - tx), Math.abs(a.tileZ - tz)) - Math.max(Math.abs(b.tileX - tx), Math.abs(b.tileZ - tz)));
  }

  /** Runs queued generation work until `deadline` (performance.now() ms). Returns true if work remains. */
  work(deadline: number) {
    while (this.builds.length > 0) {
      const build = this.builds[0];
      const rowsPerJob = Math.ceil(build.rows / 2);
      this.generateRows(build, build.nextRow, Math.min(build.rows, build.nextRow + rowsPerJob));
      build.nextRow += rowsPerJob;
      if (build.nextRow >= build.rows) {
        this.builds.shift();
        if (this.tiles.size >= TILE_CACHE_LIMIT) this.evictFarthest(build.tileX, build.tileZ);
        this.tiles.set(`${build.tileX},${build.tileZ}`, {
          matrices: build.items.map((i) => new Float32Array(i.m)),
          colors: build.items.map((i) => new Float32Array(i.c)),
          positions: build.items.map((i) => new Float32Array(i.p)),
          ranks: build.items.map((i) => new Float32Array(i.r)),
        });
        this.dirty = true;
      }
      if (performance.now() >= deadline) break;
    }
    return this.builds.length > 0;
  }

  private evictFarthest(tx: number, tz: number) {
    let worst: string | null = null;
    let worstDist = -1;
    for (const key of this.tiles.keys()) {
      const [x, z] = key.split(',').map(Number);
      const d = Math.max(Math.abs(x - tx), Math.abs(z - tz));
      if (d > worstDist) {
        worstDist = d;
        worst = key;
      }
    }
    if (worst) this.tiles.delete(worst);
  }

  private generateRows(build: TileBuild, rowStart: number, rowEnd: number) {
    const { rng, items } = build;
    const originX = build.tileX * TILE_SIZE - TILE_SIZE / 2;
    const originZ = build.tileZ * TILE_SIZE - TILE_SIZE / 2;
    const cols = Math.ceil(TILE_SIZE / CANDIDATE_STEP);
    const s = this.sample;
    for (let row = rowStart; row < rowEnd; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        // Draw every random number up front so a candidate's outcome never shifts the stream.
        const jx = rng();
        const jz = rng();
        const roll = rng();
        const pick = rng();
        const yaw = rng() * Math.PI * 2;
        const size = rng();
        const tint = rng();
        const rank = rng();
        const x = originX + (col + jx) * CANDIDATE_STEP;
        const z = originZ + (row + jz) * CANDIDATE_STEP;
        this.field.sample(x, z, s);
        const depth = -s.height;
        if (depth < MIN_DEPTH) continue;
        const cluster = smoothstep(0.58, 0.85, this.field.noise01(x * 0.045, z * 0.045));
        const chance = DENSITY_OPEN + DENSITY_REEF * s.reef * (0.55 + 0.45 * cluster) + DENSITY_CLUSTER * cluster;
        if (roll > chance) continue;
        const species = this.chooseSpecies(pick, s, cluster);
        const index = SPECIES.indexOf(species);
        let sx = 1;
        let sy = 1;
        let sz = 1;
        let sink = 0.05;
        switch (species) {
          case 'branch':
            sx = sy = sz = 1.1 + size * 1.3;
            break;
          case 'brain':
            sx = sz = 0.6 + size * 1.1;
            sy = sx * (0.7 + tint * 0.4);
            sink = 0.12 * sy;
            break;
          case 'fan':
            sx = sy = sz = 0.9 + size * 1.2;
            break;
          case 'kelp': {
            const h = Math.min(4 + size * 7, depth - KELP_TOP_CLEARANCE);
            if (h < 2) continue;
            sx = sz = 1 + size * 0.6;
            sy = h;
            break;
          }
          case 'seaweed':
            sx = sz = 0.9 + size * 0.9;
            sy = sx * (0.8 + tint * 0.8);
            break;
          case 'anemone':
            sx = sy = sz = 0.8 + size * 0.9;
            break;
          case 'rock':
            sx = 0.7 + size * (1.4 + s.rock * 1.8);
            sz = sx * (0.7 + tint * 0.6);
            sy = sx * (0.5 + jx * 0.6);
            sink = 0.3 * sy;
            break;
          case 'starfish':
            sx = sy = sz = 0.28 + size * 0.2;
            break;
          case 'shell':
            sx = sy = sz = 0.22 + size * 0.2;
            break;
        }
        scratchPos.set(x, s.height - sink, z);
        scratchEuler.set(species === 'shell' ? (tint - 0.5) * 0.6 : 0, yaw, species === 'rock' ? (jz - 0.5) * 0.5 : 0);
        scratchQuat.setFromEuler(scratchEuler);
        scratchScale.set(sx, sy, sz);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        const palette = PALETTES[species];
        scratchColor.set(palette[Math.floor(tint * palette.length) % palette.length]);
        // A little per-item variation so a cluster isn't one flat colour.
        scratchColor.offsetHSL((jx - 0.5) * 0.04, (jz - 0.5) * 0.1, (size - 0.5) * 0.08);
        const bucket = items[index];
        for (let k = 0; k < 16; k += 1) bucket.m.push(scratchMatrix.elements[k]);
        bucket.c.push(scratchColor.r, scratchColor.g, scratchColor.b);
        bucket.p.push(x, z);
        bucket.r.push(rank);
      }
    }
  }

  /** Context-weighted species pick: corals and anemones on reef slopes, kelp groves and sand life offshore. */
  private chooseSpecies(pick: number, s: GroundSample, cluster: number): Species {
    const reef = s.reef;
    const open = 1 - reef;
    const weights: [Species, number][] = [
      ['branch', 0.24 * reef + 0.04 * open],
      ['brain', 0.16 * reef + 0.05 * open],
      ['fan', 0.12 * reef + 0.02 * open],
      ['anemone', 0.12 * reef + 0.03 * open],
      ['kelp', 0.05 * reef + 0.34 * open * cluster],
      ['seaweed', 0.1 * reef + 0.2 * open],
      ['rock', 0.1 * reef + (0.08 + 0.4 * s.rock) * open],
      ['starfish', 0.05 * reef + 0.07 * open],
      ['shell', 0.05 * reef + 0.12 * open],
    ];
    let total = 0;
    for (const [, w] of weights) total += w;
    let t = pick * total;
    for (const [species, w] of weights) {
      t -= w;
      if (t <= 0) return species;
    }
    return 'shell';
  }

  /** Copies the items near the bird into the instance buffers (when it has moved or tiles changed). */
  refresh(position: THREE.Vector3) {
    const dx = position.x - this.lastRefresh.x;
    const dz = position.z - this.lastRefresh.z;
    if (!this.dirty && dx * dx + dz * dz < REFRESH_DISTANCE * REFRESH_DISTANCE) return;
    this.dirty = false;
    this.lastRefresh.set(position.x, 0, position.z);
    const tx = Math.round(position.x / TILE_SIZE);
    const tz = Math.round(position.z / TILE_SIZE);
    const r2 = this.radius * this.radius;
    const counts = new Array<number>(SPECIES.length).fill(0);
    for (let ox = -TILE_RADIUS; ox <= TILE_RADIUS; ox += 1) {
      for (let oz = -TILE_RADIUS; oz <= TILE_RADIUS; oz += 1) {
        const tile = this.tiles.get(`${tx + ox},${tz + oz}`);
        if (!tile) continue;
        for (let sp = 0; sp < SPECIES.length; sp += 1) {
          const mesh = this.meshes[sp];
          const matrices = tile.matrices[sp];
          const colors = tile.colors[sp];
          const positions = tile.positions[sp];
          const ranks = tile.ranks[sp];
          const target = mesh.instanceMatrix.array as Float32Array;
          const targetColors = mesh.instanceColor!.array as Float32Array;
          let n = counts[sp];
          for (let i = 0; i < ranks.length && n < CAPACITY; i += 1) {
            if (ranks[i] >= this.density) continue;
            const ix = positions[i * 2] - position.x;
            const iz = positions[i * 2 + 1] - position.z;
            if (ix * ix + iz * iz > r2) continue;
            target.set(matrices.subarray(i * 16, i * 16 + 16), n * 16);
            targetColors[n * 3] = colors[i * 3];
            targetColors[n * 3 + 1] = colors[i * 3 + 1];
            targetColors[n * 3 + 2] = colors[i * 3 + 2];
            n += 1;
          }
          counts[sp] = n;
        }
      }
    }
    for (let sp = 0; sp < SPECIES.length; sp += 1) {
      const mesh = this.meshes[sp];
      mesh.count = counts[sp];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Number of reef items currently drawn (for the perf harness). */
  getDrawnCount() {
    return this.meshes.reduce((sum, m) => sum + m.count, 0);
  }

  dispose() {
    this.group.removeFromParent();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.tiles.clear();
    this.builds = [];
  }
}
