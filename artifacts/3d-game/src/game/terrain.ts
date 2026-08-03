import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const TILE_SIZE = 120;
const TILE_SEGMENTS = 20;
const VIEW_RADIUS = 3;
const NOISE_FREQ = 0.0055;
const HEIGHT_SCALE = 16;

function tileKey(x: number, z: number) {
  return `${x},${z}`;
}

/**
 * Generates an endless low-poly landscape from simplex noise, arranged as a grid of
 * square tiles around the bird. Tiles that fall out of range are pooled and reused
 * (repositioned + re-displaced) instead of being destroyed, so terrain streams in
 * smoothly with no allocation churn.
 */
export class TerrainManager {
  private scene: THREE.Scene;
  private noise2D = createNoise2D();
  private tiles = new Map<string, THREE.Mesh>();
  private pool: THREE.Mesh[] = [];
  private material: THREE.MeshStandardMaterial;
  private currentTile = { x: Number.NaN, z: Number.NaN };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
      fog: true,
    });
  }

  private heightAt(worldX: number, worldZ: number) {
    const base = this.noise2D(worldX * NOISE_FREQ, worldZ * NOISE_FREQ);
    const detail = this.noise2D(worldX * NOISE_FREQ * 4.5, worldZ * NOISE_FREQ * 4.5) * 0.22;
    return (base + detail) * HEIGHT_SCALE;
  }

  private buildGeometry(tileX: number, tileZ: number) {
    const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, TILE_SEGMENTS, TILE_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const colors: number[] = [];
    const colorLow = new THREE.Color('#bfe0ae');
    const colorMid = new THREE.Color('#e3dd9f');
    const colorHigh = new THREE.Color('#f3e6cf');

    const originX = tileX * TILE_SIZE;
    const originZ = tileZ * TILE_SIZE;

    for (let i = 0; i < position.count; i += 1) {
      const localX = position.getX(i);
      const localZ = position.getZ(i);
      const worldX = originX + localX;
      const worldZ = originZ + localZ;
      const height = this.heightAt(worldX, worldZ);
      position.setY(i, height);

      const t = THREE.MathUtils.clamp((height + HEIGHT_SCALE) / (HEIGHT_SCALE * 2), 0, 1);
      const color =
        t < 0.5
          ? colorLow.clone().lerp(colorMid, t / 0.5)
          : colorMid.clone().lerp(colorHigh, (t - 0.5) / 0.5);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private activate(tileX: number, tileZ: number) {
    const key = tileKey(tileX, tileZ);
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

  /** Call every frame with the bird's world position to stream tiles in/out. */
  update(position: THREE.Vector3) {
    const tileX = Math.round(position.x / TILE_SIZE);
    const tileZ = Math.round(position.z / TILE_SIZE);
    if (tileX === this.currentTile.x && tileZ === this.currentTile.z) return;
    this.currentTile = { x: tileX, z: tileZ };

    const wanted = new Set<string>();
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx += 1) {
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz += 1) {
        const key = tileKey(tileX + dx, tileZ + dz);
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
