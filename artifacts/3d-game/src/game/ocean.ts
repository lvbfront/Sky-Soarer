import * as THREE from 'three';
import { HorizonIslands, IslandDecor } from './oceanDecor';
import { OceanField, TILE_SIZE, hash2D, type GroundSample } from './oceanField';
import { createOceanUniforms, patchOceanMaterial, type OceanUniforms } from './oceanShaders';
import { QUALITY_PROFILES, type QualityProfile } from './quality';
import { GroundDepthTexture, TILE_TEXEL_ROWS, WaterSurface, type SurfaceLook } from './waterSurface';

export { type SurfaceLook } from './waterSurface';

const TILE_SEGMENTS = 24;
const VIEW_RADIUS = 3;
// Underwater visibility is ~60 units, so only the 3x3 tiles around the bird are drawn down there.
const UNDERWATER_VIEW_RADIUS = 1;
// Above water only triangles reaching above this height are drawn (wave troughs go to ~-0.55).
const LAND_DRAW_DEPTH = -0.9;

// Tile streaming is incremental: crossing a tile boundary queues the new row of tiles, and each
// frame works through the queue (nearest first) for at most this long. A tile is a ground mesh
// job plus a few ground-height-texture row jobs, ~0.5-1 ms each, so no frame ever builds a whole
// row of tiles at once (the old stutter: 7 tiles in one frame).
const BUILD_BUDGET_MS = 1.5;
const TEXTURE_ROWS_PER_JOB = 10;

// Ground colours: island top, beach, wet sand, then the seabed (sand, rock, reef slope).
const COLOR_FOLIAGE = new THREE.Color('#79b85c');
const COLOR_FOLIAGE_DARK = new THREE.Color('#5a9a48');
const COLOR_SAND_DRY = new THREE.Color('#f3e2ad');
const COLOR_SAND_WET = new THREE.Color('#d2b982');
const COLOR_SEABED = new THREE.Color('#e2cf9f');
const COLOR_SEABED_DARK = new THREE.Color('#bba77b');
const COLOR_ROCK = new THREE.Color('#9a8f82');
const COLOR_ROCK_DARK = new THREE.Color('#635d57');
const COLOR_CORALLINE = new THREE.Color('#d98e84');
const COLOR_ALGAE = new THREE.Color('#8fb86a');

interface TileRecord {
  mesh: THREE.Mesh;
  tileX: number;
  tileZ: number;
  /**
   * Index count of the tile's triangles that can show above the water (land, beach, shallows).
   * They're sorted first in the index buffer, so above water only this range is drawn and the
   * seabed hidden under the opaque sea costs nothing.
   */
  landIndexCount: number;
  /** False until its mesh job has run (a pooled mesh still holds its previous tile's shape). */
  built: boolean;
}

type BuildJob = { kind: 'mesh'; key: string; tileX: number; tileZ: number } | { kind: 'texture'; key: string; tileX: number; tileZ: number; rowStart: number; rowEnd: number };

/**
 * Endless tropical ocean: streamed ground tiles (seabed dunes and rock, reef slopes, sandy
 * beaches, green island tops) under one shader-animated water surface, instanced island dressing
 * and a hazy archipelago on the horizon. Shares the `update` / `heightAtWorld` contract with
 * `TerrainManager`, so GameEngine and the landing scene can swap maps freely.
 */
export class OceanManager {
  readonly field = new OceanField();
  /** Shared by every ocean shader (water, caustics, sway): write `uTime` etc. once per frame. */
  readonly uniforms: OceanUniforms = createOceanUniforms();

  private parent: THREE.Object3D;
  private tiles = new Map<string, TileRecord>();
  private pool: THREE.Mesh[] = [];
  private material: THREE.MeshLambertMaterial;
  private currentTile = { x: Number.NaN, z: Number.NaN };
  private queue: BuildJob[] = [];
  private initialised = false;
  private underwaterView = false;

  private depthTexture = new GroundDepthTexture();
  private water: WaterSurface;
  private decor: IslandDecor;
  private horizon: HorizonIslands;
  private profile: QualityProfile;
  private sample: GroundSample = { height: 0, rock: 0, reef: 0, shoreDistance: 0 };
  private tmpColor = new THREE.Color();
  private heightAt = (x: number, z: number) => this.field.groundHeight(x, z);

  constructor(parent: THREE.Object3D, profile: QualityProfile = QUALITY_PROFILES.high) {
    this.parent = parent;
    this.profile = profile;
    this.material = patchOceanMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      this.uniforms,
      { key: 'ground', caustics: true },
    );
    this.water = new WaterSurface(parent, this.depthTexture.texture, this.uniforms.uTime, profile.waterSegments);
    this.decor = new IslandDecor(parent, this.field, this.uniforms, profile.decorRadius);
    this.horizon = new HorizonIslands(parent);
  }

  private buildGeometry(geometry: THREE.BufferGeometry, tileX: number, tileZ: number) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    let colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colorAttr) {
      colorAttr = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
      geometry.setAttribute('color', colorAttr);
    }
    const originX = tileX * TILE_SIZE;
    const originZ = tileZ * TILE_SIZE;
    const s = this.sample;
    const c = this.tmpColor;
    // PlaneGeometry's X/Z layout is fixed, so the local grid can be recomputed from the index.
    const n = TILE_SEGMENTS + 1;
    for (let i = 0; i < position.count; i += 1) {
      const localX = ((i % n) / TILE_SEGMENTS - 0.5) * TILE_SIZE;
      const localZ = (Math.floor(i / n) / TILE_SEGMENTS - 0.5) * TILE_SIZE;
      const wx = originX + localX;
      const wz = originZ + localZ;
      this.field.sample(wx, wz, s);
      const h = s.height;
      position.setXYZ(i, localX, h, localZ);

      const grain = hash2D(wx * 0.37, wz * 0.37);
      if (h > 2.4) {
        c.copy(COLOR_FOLIAGE).lerp(COLOR_FOLIAGE_DARK, THREE.MathUtils.clamp((h - 2.4) / 9, 0, 1) * 0.7 + grain * 0.3);
      } else if (h > 1.4) {
        c.copy(COLOR_SAND_DRY).lerp(COLOR_FOLIAGE, (h - 1.4) / 1.0);
      } else if (h > 0.35) {
        c.copy(COLOR_SAND_DRY).lerp(COLOR_SAND_WET, grain * 0.25);
      } else if (h > -0.8) {
        c.copy(COLOR_SAND_WET).lerp(COLOR_SAND_DRY, (h + 0.8) / 1.15 * 0.4);
      } else {
        // Seabed: pale sand, a touch darker in the dune troughs, rock where it's rocky, and
        // coralline pinks and algae greens on the reef slopes around islands.
        c.copy(COLOR_SEABED).lerp(COLOR_SEABED_DARK, grain * 0.45);
        if (s.rock > 0) {
          this.tmpRock.copy(COLOR_ROCK).lerp(COLOR_ROCK_DARK, grain * 0.7);
          // Reef slopes: patches of pink coralline algae and green turf over the rock.
          if (s.reef > 0.3) this.tmpRock.lerp(grain > 0.55 ? COLOR_CORALLINE : COLOR_ALGAE, 0.7 * s.reef);
          c.lerp(this.tmpRock, Math.min(0.85, s.rock * 1.1));
        }
      }
      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    position.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return this.sortLandFirst(geometry, position);
  }

  /** Rewrites the tile's index buffer with land/shore triangles first; returns their index count. */
  private sortLandFirst(geometry: THREE.BufferGeometry, position: THREE.BufferAttribute) {
    const index = geometry.getIndex()!;
    const out = index.array as Uint16Array | Uint32Array;
    const n = TILE_SEGMENTS + 1;
    let front = 0;
    let back = out.length;
    const place = (a: number, b: number, c: number) => {
      const top = Math.max(position.getY(a), position.getY(b), position.getY(c));
      if (top > LAND_DRAW_DEPTH) {
        out[front++] = a;
        out[front++] = b;
        out[front++] = c;
      } else {
        out[--back] = c;
        out[--back] = b;
        out[--back] = a;
      }
    };
    // PlaneGeometry's own quad layout and winding.
    for (let iy = 0; iy < TILE_SEGMENTS; iy += 1) {
      for (let ix = 0; ix < TILE_SEGMENTS; ix += 1) {
        const a = ix + n * iy;
        const b = ix + n * (iy + 1);
        const c = ix + 1 + n * (iy + 1);
        const d = ix + 1 + n * iy;
        place(a, b, d);
        place(b, c, d);
      }
    }
    index.needsUpdate = true;
    return front;
  }

  private tmpRock = new THREE.Color();

  private isNear(tile: TileRecord) {
    return Math.abs(tile.tileX - this.currentTile.x) <= UNDERWATER_VIEW_RADIUS && Math.abs(tile.tileZ - this.currentTile.z) <= UNDERWATER_VIEW_RADIUS;
  }

  /** Underwater only the nearby ground is drawn; above water only each tile's land (the rest is under the opaque sea). */
  private applyTileVisibility(tile: TileRecord) {
    if (!tile.built) return;
    // Underwater nothing sun-shadowed is worth the shadow-map lookups (a uniform: no recompile).
    tile.mesh.receiveShadow = !this.underwaterView;
    if (this.underwaterView) {
      tile.mesh.visible = this.isNear(tile);
      tile.mesh.geometry.setDrawRange(0, Infinity);
    } else {
      tile.mesh.visible = tile.landIndexCount > 0;
      tile.mesh.geometry.setDrawRange(0, tile.landIndexCount);
    }
  }

  private runJob(job: BuildJob) {
    const tile = this.tiles.get(job.key);
    if (!tile) return; // streamed out before it was built
    if (job.kind === 'mesh') {
      tile.landIndexCount = this.buildGeometry(tile.mesh.geometry, job.tileX, job.tileZ);
      tile.mesh.position.set(job.tileX * TILE_SIZE, 0, job.tileZ * TILE_SIZE);
      tile.built = true;
      this.applyTileVisibility(tile);
    } else {
      this.depthTexture.writeTileRows(job.tileX, job.tileZ, job.rowStart, job.rowEnd, this.heightAt);
    }
  }

  private activate(tileX: number, tileZ: number) {
    const key = `${tileX},${tileZ}`;
    if (this.tiles.has(key)) return;
    let mesh = this.pool.pop();
    if (!mesh) {
      const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, TILE_SEGMENTS, TILE_SEGMENTS);
      geometry.rotateX(-Math.PI / 2);
      geometry.deleteAttribute('uv');
      mesh = new THREE.Mesh(geometry, this.material);
      mesh.receiveShadow = true;
      this.parent.add(mesh);
    }
    // Hidden until its mesh job has run (the pooled geometry still holds another tile's shape).
    mesh.visible = false;
    this.tiles.set(key, { mesh, tileX, tileZ, landIndexCount: 0, built: false });
    this.queue.push({ kind: 'mesh', key, tileX, tileZ });
    for (let r = 0; r < TILE_TEXEL_ROWS; r += TEXTURE_ROWS_PER_JOB) {
      this.queue.push({ kind: 'texture', key, tileX, tileZ, rowStart: r, rowEnd: Math.min(TILE_TEXEL_ROWS, r + TEXTURE_ROWS_PER_JOB) });
    }
  }

  private deactivate(key: string) {
    const record = this.tiles.get(key);
    if (!record) return;
    record.mesh.visible = false;
    this.tiles.delete(key);
    this.pool.push(record.mesh);
  }

  /** Streams tiles around `position`, runs queued build work within the frame budget, and moves the sea with it. */
  update(position: THREE.Vector3) {
    const tileX = Math.round(position.x / TILE_SIZE);
    const tileZ = Math.round(position.z / TILE_SIZE);
    if (tileX !== this.currentTile.x || tileZ !== this.currentTile.z) {
      this.currentTile = { x: tileX, z: tileZ };
      const wanted = new Set<string>();
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx += 1) {
        for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz += 1) {
          wanted.add(`${tileX + dx},${tileZ + dz}`);
          this.activate(tileX + dx, tileZ + dz);
        }
      }
      for (const key of Array.from(this.tiles.keys())) {
        if (!wanted.has(key)) this.deactivate(key);
      }
      // Nearest tiles first (mesh before texture within a tile, which the stable sort keeps).
      this.queue.sort((a, b) => {
        const da = Math.max(Math.abs(a.tileX - tileX), Math.abs(a.tileZ - tileZ));
        const db = Math.max(Math.abs(b.tileX - tileX), Math.abs(b.tileZ - tileZ));
        return da - db;
      });
      for (const tile of this.tiles.values()) this.applyTileVisibility(tile);
    }

    if (this.queue.length > 0) {
      // The very first update builds everything at once (under the takeoff veil / landing intro).
      const deadline = this.initialised ? performance.now() + BUILD_BUDGET_MS : Infinity;
      let job = 0;
      while (job < this.queue.length) {
        this.runJob(this.queue[job]);
        job += 1;
        if (performance.now() >= deadline) break;
      }
      this.queue.splice(0, job);
    }
    this.initialised = true;

    this.water.follow(position);
    this.horizon.follow(position);
    if (!this.underwaterView) this.decor.update(position);
  }

  /** True while streamed tiles are still being built (other background work waits for it). */
  hasPendingWork() {
    return this.queue.length > 0;
  }

  /** Advances the water/caustics/sway clock. Waves themselves are animated in the vertex shader. */
  animateWater(dt: number) {
    this.uniforms.uTime.value += dt;
  }

  /** Time of the shared ocean clock (the waves' phase). */
  getTime() {
    return this.uniforms.uTime.value;
  }

  /** Switches between the above-water view and the view from below the surface. */
  setUnderwaterView(underwater: boolean) {
    if (underwater === this.underwaterView) return;
    this.underwaterView = underwater;
    this.decor.setVisible(!underwater);
    this.horizon.mesh.visible = !underwater;
    for (const tile of this.tiles.values()) this.applyTileVisibility(tile);
  }

  setQuality(profile: QualityProfile) {
    this.profile = profile;
    this.water.setSegments(profile.waterSegments);
    this.decor.setRadius(profile.decorRadius);
  }

  getQuality() {
    return this.profile;
  }

  /** Water colours, glint and the horizon tint for the current sky. */
  setSurfaceLook(look: SurfaceLook, horizonTint: THREE.Color, horizonStrength: number) {
    this.water.applyLook(look);
    this.horizon.setTint(horizonTint, horizonStrength);
  }

  /** Direction toward the sun/moon (world space), for the water's glint. */
  setSunDirection(direction: THREE.Vector3) {
    this.water.uniforms.uSunDir.value.copy(direction).normalize();
  }

  /** Solid ground: seabed, reef slope, beach or island top. */
  groundHeightAt(x: number, z: number) {
    return this.field.groundHeight(x, z);
  }

  /** Land height, or the calm water level over the sea (the same contract as TerrainManager). */
  heightAtWorld(x: number, z: number) {
    return this.field.surfaceHeight(x, z);
  }

  /** The animated water surface height (matches the shader's waves). */
  waterHeightAt(x: number, z: number) {
    return this.field.waterHeight(x, z, this.uniforms.uTime.value);
  }

  /** True when the given world point sits over open water (no island under it). */
  isOverWater(x: number, z: number) {
    return this.field.isOverWater(x, z);
  }

  dispose() {
    for (const tile of this.tiles.values()) this.pool.push(tile.mesh);
    this.tiles.clear();
    for (const mesh of this.pool) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.pool = [];
    this.queue = [];
    this.material.dispose();
    this.water.dispose();
    this.decor.dispose();
    this.horizon.dispose();
    this.depthTexture.dispose();
  }
}
