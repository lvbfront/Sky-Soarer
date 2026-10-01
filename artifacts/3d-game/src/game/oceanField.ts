import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';

// The Tropical Ocean's shape as pure functions: islands on a hashed lattice, the ground under the
// water (seabed dunes, rock patches, reef slopes that carry every island down to the seabed), and
// the surface waves. No three.js or DOM here, so the tile builder, the reef scatter, the physics
// floor, the water shader's CPU mirror and the unit tests all read the same numbers.

export const TILE_SIZE = 120;
export const WATER_LEVEL = 0;

// Islands sit on a coarse lattice: each cell may or may not hold one, decided deterministically
// from a hash of the cell coordinates, so they're stable across tiles and sessions.
export const ISLAND_CELL = 55;
const ISLAND_CHANCE = 0.4;
const ISLAND_MIN_RADIUS = 11;
const ISLAND_MAX_RADIUS = 22;
const ISLAND_MIN_HEIGHT = 7;
const ISLAND_MAX_HEIGHT = 15;
// Horizontal width of the reef slope that carries an island from its shoreline down to the
// seabed. Wide enough that the shallows read turquoise from the air, narrow enough that
// neighbouring islands keep deep blue channels between them.
export const ISLAND_SKIRT = 30;

// The seabed: a mean depth close to the old fixed floor (-15), gentle two-octave dunes, fine sand
// ripples, and lumpy rock patches where a low-frequency noise crosses a threshold.
export const SEABED_BASE_Y = -15;
const DUNE_FREQ = 0.016;
const DUNE_AMPLITUDE = 1.5;
const DUNE_DETAIL_FREQ = 0.06;
const DUNE_DETAIL_AMPLITUDE = 0.45;
const ROCK_FREQ = 0.028;
const ROCK_THRESHOLD_LOW = 0.62;
const ROCK_THRESHOLD_HIGH = 0.85;
const ROCK_BUMP = 1.6;
// Rough rocky lumps on the upper reef slope, strongest mid-slope and zero at both ends so the
// shoreline and the seabed junction stay continuous.
const SLOPE_ROUGHNESS = 1.4;

// Island cells are cached (the lattice is queried for every vertex, reef candidate and texel).
// Bounded so a long flight can't grow it forever (CLAUDE.md §9 #13).
const ISLAND_CACHE_LIMIT = 4096;

export interface Island {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Deterministic 0..1 value for decorations (palm count, rock angles, …). */
  seed: number;
}

/** Cheap deterministic hash -> [0, 1) used to seed each island lattice cell. */
export function hash2D(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function islandAt(cellX: number, cellZ: number): Island | null {
  const h = hash2D(cellX, cellZ);
  if (h > ISLAND_CHANCE) return null;
  const hx = hash2D(cellX + 91.3, cellZ - 17.9);
  const hz = hash2D(cellX - 51.1, cellZ + 63.4);
  const hr = hash2D(cellX + 12.7, cellZ + 44.2);
  const hh = hash2D(cellX - 8.4, cellZ - 22.6);
  return {
    x: cellX * ISLAND_CELL + (hx - 0.5) * ISLAND_CELL * 0.7,
    z: cellZ * ISLAND_CELL + (hz - 0.5) * ISLAND_CELL * 0.7,
    radius: ISLAND_MIN_RADIUS + hr * (ISLAND_MAX_RADIUS - ISLAND_MIN_RADIUS),
    height: ISLAND_MIN_HEIGHT + hh * (ISLAND_MAX_HEIGHT - ISLAND_MIN_HEIGHT),
    seed: hash2D(cellX + 3.3, cellZ + 7.7),
  };
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Small seeded PRNG (mulberry32), so a tile's reef or an island's palms are the same every visit. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer seed for a tile (or any integer pair). */
export function cellSeed(x: number, z: number, salt = 0) {
  return (Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) >>> 0;
}

// ---- Waves ----------------------------------------------------------------------------------

/**
 * Directional sine waves summed into the water surface. The vertex shader builds its GLSL from
 * this same table (see `wavesGlsl`), so the CPU `waveHeight` below (skim spray, the surface the
 * chase camera stays on the right side of) matches what's drawn.
 */
export const WAVES: readonly { dirX: number; dirZ: number; k: number; amp: number; speed: number }[] = [
  { dirX: 0.8, dirZ: 0.6, k: 0.075, amp: 0.2, speed: 1.1 },
  { dirX: -0.38, dirZ: 0.925, k: 0.13, amp: 0.11, speed: 1.6 },
  { dirX: 0.96, dirZ: -0.28, k: 0.22, amp: 0.055, speed: 2.2 },
  { dirX: -0.71, dirZ: -0.71, k: 0.041, amp: 0.13, speed: 0.8 },
];

/** Largest possible sum of the wave amplitudes. */
export const WAVE_MAX_HEIGHT = WAVES.reduce((sum, w) => sum + w.amp, 0);

// Waves flatten over the last few units of depth, so the water lies still against the beach
// instead of bobbing through the sand.
export const WAVE_SHORE_DAMP_DEPTH = 2.5;

export function waveDamping(waterDepth: number) {
  return smoothstep(0, WAVE_SHORE_DAMP_DEPTH, waterDepth);
}

/** Undamped surface offset above WATER_LEVEL at (x, z) and time t. */
export function waveHeight(x: number, z: number, t: number) {
  let h = 0;
  for (const w of WAVES) h += w.amp * Math.sin(w.k * (w.dirX * x + w.dirZ * z) + w.speed * t);
  return h;
}

/** GLSL for the same waves: `float oceanWaves(vec2 p, float t, out vec2 grad)`. */
export function wavesGlsl() {
  const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  const terms = WAVES.map((w) => {
    const phase = `${f(w.k)} * dot(vec2(${f(w.dirX)}, ${f(w.dirZ)}), p) + ${f(w.speed)} * t`;
    return `  a = ${phase};\n  h += ${f(w.amp)} * sin(a);\n  grad += ${f(w.amp * w.k)} * cos(a) * vec2(${f(w.dirX)}, ${f(w.dirZ)});`;
  }).join('\n');
  return `float oceanWaves(vec2 p, float t, out vec2 grad) {\n  float h = 0.0; float a;\n  grad = vec2(0.0);\n${terms}\n  return h;\n}`;
}

// ---- Ground ---------------------------------------------------------------------------------

export interface GroundSample {
  /** Solid ground height: seabed, reef slope, beach or island top. */
  height: number;
  /** 0..1: how rocky the seabed is here (rock patches and reef slopes). */
  rock: number;
  /** 0..1: 1 on an island's reef slope and shallows, fading to 0 out on the open seabed. */
  reef: number;
  /** Distance past the nearest island's shoreline (negative on land). */
  shoreDistance: number;
}

/**
 * The ocean's height field. One instance per OceanManager: the dune noise is seeded, so pass a
 * seeded `random` for reproducible tests; the game uses Math.random, like the mountain map.
 */
export class OceanField {
  private noise: NoiseFunction2D;
  private islandCache = new Map<number, Island[]>();

  constructor(random: () => number = Math.random) {
    this.noise = createNoise2D(random);
  }

  /** Islands whose influence (shore + reef slope) could reach this point: the 3x3 cells around it. */
  islandsNear(worldX: number, worldZ: number): Island[] {
    const cellX = Math.round(worldX / ISLAND_CELL);
    const cellZ = Math.round(worldZ / ISLAND_CELL);
    // Cell coordinates stay far below 2^15 for any reachable flight, so they pack into one number.
    const key = (cellX + 32768) * 65536 + (cellZ + 32768);
    const cached = this.islandCache.get(key);
    if (cached) return cached;

    const islands: Island[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const island = islandAt(cellX + dx, cellZ + dz);
        if (island) islands.push(island);
      }
    }
    if (this.islandCache.size >= ISLAND_CACHE_LIMIT) this.islandCache.clear();
    this.islandCache.set(key, islands);
    return islands;
  }

  /** Smooth 0..1 noise (for clustering the reef), from the same seeded generator. */
  noise01(x: number, z: number) {
    return this.noise(x, z) * 0.5 + 0.5;
  }

  /** Open seabed height (no islands) and its rockiness. */
  private seabed(x: number, z: number, out: GroundSample) {
    const n = this.noise;
    const dunes = n(x * DUNE_FREQ, z * DUNE_FREQ) * DUNE_AMPLITUDE + n(x * DUNE_DETAIL_FREQ + 31.7, z * DUNE_DETAIL_FREQ - 12.3) * DUNE_DETAIL_AMPLITUDE;
    const rockNoise = n(x * ROCK_FREQ - 71.1, z * ROCK_FREQ + 43.9) * 0.5 + 0.5;
    const rock = smoothstep(ROCK_THRESHOLD_LOW, ROCK_THRESHOLD_HIGH, rockNoise);
    const lumps = rock * ROCK_BUMP * (0.55 + 0.45 * n(x * 0.21, z * 0.21));
    out.height = SEABED_BASE_Y + dunes + lumps;
    out.rock = rock;
  }

  /** Full ground sample at (x, z). Writes into `out` (no allocation) and returns it. */
  sample(x: number, z: number, out: GroundSample): GroundSample {
    this.seabed(x, z, out);
    const seabed = out.height;
    let height = seabed;
    let shoreDistance = Infinity;
    for (const island of this.islandsNear(x, z)) {
      const dist = Math.hypot(x - island.x, z - island.z);
      const past = dist - island.radius;
      if (past < shoreDistance) shoreDistance = past;
      let h: number;
      if (past <= 0) {
        // The island itself: the old smoothstep dome, flat at the shoreline so there's a beach.
        h = smoothstep(island.radius, island.radius * 0.15, dist) * island.height;
      } else if (past < ISLAND_SKIRT) {
        // Reef slope: a shallow shelf, then a drop to the seabed, with rocky lumps mid-slope.
        const t = past / ISLAND_SKIRT;
        const ease = t * t * t * (t * (t * 6 - 15) + 10);
        const rough = this.noise(x * 0.17 + island.seed * 50, z * 0.17) * SLOPE_ROUGHNESS * 4 * t * (1 - t);
        h = seabed * ease + rough * (1 - ease * 0.5);
        if (h > 0) h = 0;
      } else {
        continue;
      }
      if (h > height) height = h;
    }
    out.height = height;
    out.shoreDistance = shoreDistance;
    out.reef = shoreDistance === Infinity ? 0 : 1 - smoothstep(ISLAND_SKIRT * 0.3, ISLAND_SKIRT * 1.8, shoreDistance);
    if (shoreDistance < ISLAND_SKIRT) out.rock = Math.max(out.rock, smoothstep(ISLAND_SKIRT * 0.15, ISLAND_SKIRT * 0.6, shoreDistance) * 0.8);
    return out;
  }

  private scratch: GroundSample = { height: 0, rock: 0, reef: 0, shoreDistance: 0 };

  /** Solid ground height (seabed, reef slope, beach, island top). */
  groundHeight(x: number, z: number) {
    return this.sample(x, z, this.scratch).height;
  }

  /** True when (x, z) is over open water (no island under it). Same footprint as before the overhaul. */
  isOverWater(x: number, z: number) {
    for (const island of this.islandsNear(x, z)) {
      if (Math.hypot(x - island.x, z - island.z) < island.radius) return false;
    }
    return true;
  }

  /** The height of whatever is on top: land, or the calm water level. */
  surfaceHeight(x: number, z: number) {
    return Math.max(this.groundHeight(x, z), WATER_LEVEL);
  }

  /** Water surface height at time t, including the waves (damped near the shore). */
  waterHeight(x: number, z: number, t: number) {
    const depth = WATER_LEVEL - this.groundHeight(x, z);
    return WATER_LEVEL + waveHeight(x, z, t) * waveDamping(depth);
  }
}
