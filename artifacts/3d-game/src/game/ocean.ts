import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const TILE_SIZE = 120;
const TILE_SEGMENTS = 24;
const VIEW_RADIUS = 3;

const WATER_LEVEL = 0;
const RIPPLE_AMPLITUDE = 0.18;
const RIPPLE_FREQ = 0.02;

// Islands are placed on a coarse lattice: each cell may or may not spawn an island,
// decided deterministically from a hash of the cell coordinates (so it's stable across tiles).
const ISLAND_CELL = 55;
const ISLAND_CHANCE = 0.4;
const ISLAND_MIN_RADIUS = 11;
const ISLAND_MAX_RADIUS = 22;
const ISLAND_MIN_HEIGHT = 7;
const ISLAND_MAX_HEIGHT = 15;

interface Island {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** Cheap deterministic hash -> [0, 1) used to seed each island lattice cell. */
function hash2D(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function islandAt(cellX: number, cellZ: number): Island | null {
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
  };
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Endless ocean map: a mostly-flat gently-rippling water surface (blue/teal) dotted with
 * procedurally scattered low-poly tropical islands (sand -> green domes). Shares the same
 * tile-pooling streaming approach as `TerrainManager` and exposes the same
 * `update`/`heightAtWorld` contract so `GameEngine` can swap between maps freely.
 */
export class OceanManager {
  private scene: THREE.Scene;
  private noise2D = createNoise2D();
  private tiles = new Map<string, THREE.Mesh>();
  private pool: THREE.Mesh[] = [];
  private material: THREE.MeshStandardMaterial;
  private currentTile = { x: Number.NaN, z: Number.NaN };
  private islandCache = new Map<string, Island[]>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.05,
      fog: true,
    });
  }

  /** Islands near a given world point, gathered from the 3x3 lattice cells around it. */
  private islandsNear(worldX: number, worldZ: number): Island[] {
    const cellX = Math.round(worldX / ISLAND_CELL);
    const cellZ = Math.round(worldZ / ISLAND_CELL);
    const key = `${cellX},${cellZ}`;
    const cached = this.islandCache.get(key);
    if (cached) return cached;

    const islands: Island[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const island = islandAt(cellX + dx, cellZ + dz);
        if (island) islands.push(island);
      }
    }
    this.islandCache.set(key, islands);
    return islands;
  }

  private heightAt(worldX: number, worldZ: number) {
    const ripple = this.noise2D(worldX * RIPPLE_FREQ, worldZ * RIPPLE_FREQ) * RIPPLE_AMPLITUDE;
    let islandHeight = 0;
    for (const island of this.islandsNear(worldX, worldZ)) {
      const dist = Math.hypot(worldX - island.x, worldZ - island.z);
      const bump = smoothstep(island.radius, island.radius * 0.15, dist) * island.height;
      if (bump > islandHeight) islandHeight = bump;
    }
    return WATER_LEVEL + ripple + islandHeight;
  }

  /** True when the given world point sits over open water (no island under it). */
  isOverWater(worldX: number, worldZ: number) {
    for (const island of this.islandsNear(worldX, worldZ)) {
      const dist = Math.hypot(worldX - island.x, worldZ - island.z);
      if (dist < island.radius) return false;
    }
    return true;
  }

  private buildGeometry(tileX: number, tileZ: number) {
    const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, TILE_SEGMENTS, TILE_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const colors: number[] = [];
    const colorDeepWater = new THREE.Color('#1f6f9c');
    const colorShallowWater = new THREE.Color('#5fc7d6');
    const colorSand = new THREE.Color('#eddca0');
    const colorFoliage = new THREE.Color('#7fbf6a');

    const originX = tileX * TILE_SIZE;
    const originZ = tileZ * TILE_SIZE;

    for (let i = 0; i < position.count; i += 1) {
      const localX = position.getX(i);
      const localZ = position.getZ(i);
      const worldX = originX + localX;
      const worldZ = originZ + localZ;
      const height = this.heightAt(worldX, worldZ);
      position.setY(i, height);

      let color: THREE.Color;
      if (height <= 0.4) {
        // Water: darker further from zero (deeper-looking away from any nearby shore).
        const t = THREE.MathUtils.clamp((height + 1.2) / 1.2, 0, 1);
        color = colorDeepWater.clone().lerp(colorShallowWater, t);
      } else if (height <= 1.6) {
        const t = THREE.MathUtils.clamp((height - 0.4) / 1.2, 0, 1);
        color = colorShallowWater.clone().lerp(colorSand, t);
      } else {
        const t = THREE.MathUtils.clamp((height - 1.6) / 6, 0, 1);
        color = colorSand.clone().lerp(colorFoliage, t);
      }
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private activate(tileX: number, tileZ: number) {
    const key = `${tileX},${tileZ}`;
    if (this.tiles.has(key)) return;

    const geometry = this.buildGeometry(tileX, tileZ);
    let mesh = this.pool.pop();
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.visible = true;
    } else {
      mesh = new THREE.Mesh(geometry, this.material);
      this.scene.add(mesh);
    }
    mesh.position.set(tileX * TILE_SIZE, 0, tileZ * TILE_SIZE);
    this.tiles.set(key, mesh);
  }

  private deactivate(key: string) {
    const mesh = this.tiles.get(key);
    if (!mesh) return;
    mesh.visible = false;
    this.tiles.delete(key);
    this.pool.push(mesh);
  }

  update(position: THREE.Vector3) {
    const tileX = Math.round(position.x / TILE_SIZE);
    const tileZ = Math.round(position.z / TILE_SIZE);
    if (tileX === this.currentTile.x && tileZ === this.currentTile.z) return;
    this.currentTile = { x: tileX, z: tileZ };

    const wanted = new Set<string>();
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx += 1) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz += 1) {
        const key = `${tileX + dx},${tileZ + dz}`;
        wanted.add(key);
        this.activate(tileX + dx, tileZ + dz);
      }
    }
    for (const key of Array.from(this.tiles.keys())) {
      if (!wanted.has(key)) this.deactivate(key);
    }
  }

  heightAtWorld(x: number, z: number) {
    return this.heightAt(x, z);
  }
}
