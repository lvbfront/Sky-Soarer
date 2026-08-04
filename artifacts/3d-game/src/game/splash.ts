import * as THREE from 'three';

const MAX_PARTICLES = 140;
const SPAWN_ALTITUDE_THRESHOLD = 1.6; // trigger skimming spray when this close to the water
const PARTICLES_PER_SECOND = 90;
const PARTICLE_LIFETIME = 0.6;
const GRAVITY = -9;

/** Builds a small soft circular sprite texture at runtime (no image asset needed). */
function createSoftDotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Lightweight white-water splash/skim trail: a pooled point-sprite particle system that
 * spawns foam particles at the bird's position whenever it skims low over open water on
 * the ocean map, giving the impression of feet/wingtips dragging across the surface.
 */
export class SplashEffect {
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private lifetimes: Float32Array;
  private alive: boolean[] = [];
  private cursor = 0;
  private spawnAccumulator = 0;

  constructor(private scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES).fill(PARTICLE_LIFETIME + 1);
    this.lifetimes = new Float32Array(MAX_PARTICLES).fill(PARTICLE_LIFETIME);
    this.alive = new Array(MAX_PARTICLES).fill(false);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('opacity', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1));

    const material = new THREE.PointsMaterial({
      size: 0.55,
      map: createSoftDotTexture(),
      color: '#ffffff',
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  private spawnOne(origin: THREE.Vector3, forward: THREE.Vector3) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    const spread = 0.9;
    const backward = forward.clone().multiplyScalar(-1);
    const sideways = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar((Math.random() - 0.5) * spread);

    this.positions[i * 3] = origin.x + sideways.x;
    this.positions[i * 3 + 1] = origin.y + Math.random() * 0.15;
    this.positions[i * 3 + 2] = origin.z + sideways.z;

    const kick = 2 + Math.random() * 2.5;
    this.velocities[i * 3] = backward.x * kick + sideways.x * 0.6;
    this.velocities[i * 3 + 1] = 2.2 + Math.random() * 1.8;
    this.velocities[i * 3 + 2] = backward.z * kick + sideways.z * 0.6;

    this.ages[i] = 0;
    this.lifetimes[i] = PARTICLE_LIFETIME * (0.7 + Math.random() * 0.6);
    this.alive[i] = true;
  }

  /**
   * `waterSurfaceY` is the local water height under the bird; particles only spawn when
   * the bird is over open water (not an island) and close enough to the surface to skim it.
   */
  update(dt: number, birdPosition: THREE.Vector3, forward: THREE.Vector3, waterSurfaceY: number, isOverWater: boolean) {
    const altitude = birdPosition.y - waterSurfaceY;
    const skimming = isOverWater && altitude >= -1 && altitude < SPAWN_ALTITUDE_THRESHOLD;

    if (skimming) {
      this.spawnAccumulator += dt * PARTICLES_PER_SECOND;
      const surfacePoint = new THREE.Vector3(birdPosition.x, waterSurfaceY, birdPosition.z);
      while (this.spawnAccumulator >= 1) {
        this.spawnOne(surfacePoint, forward);
        this.spawnAccumulator -= 1;
      }
    }

    const opacityAttr = this.geometry.getAttribute('opacity') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (!this.alive[i]) {
        opacityAttr.setX(i, 0);
        continue;
      }
      this.ages[i] += dt;
      if (this.ages[i] >= this.lifetimes[i]) {
        this.alive[i] = false;
        opacityAttr.setX(i, 0);
        continue;
      }

      this.velocities[i * 3 + 1] += GRAVITY * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      if (this.positions[i * 3 + 1] < waterSurfaceY) {
        this.positions[i * 3 + 1] = waterSurfaceY;
        this.velocities[i * 3 + 1] = 0;
      }

      const lifeRatio = 1 - this.ages[i] / this.lifetimes[i];
      opacityAttr.setX(i, lifeRatio);
    }

    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    opacityAttr.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 0.9;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    (this.points.material as THREE.PointsMaterial).map?.dispose();
    (this.points.material as THREE.PointsMaterial).dispose();
  }
}
