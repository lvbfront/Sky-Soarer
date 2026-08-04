import * as THREE from 'three';

const SPAWN_INTERVAL = 2.1; // seconds between ring spawns after the first
const FIRST_RING_DISTANCE = 42; // close enough to be immediately visible at flight start
const CHAIN_DISTANCE_MIN = 55;
const CHAIN_DISTANCE_MAX = 80;

// Subsequent rings trace a gentle sine-wave curve ahead of the bird instead of jumping to
// fully random offsets, so the chain reads as a deliberate, flyable path rather than noise.
const CURVE_STEP = 0.85; // radians of curve phase advanced per ring
const CURVE_LATERAL_AMPLITUDE = 16;
const CURVE_VERTICAL_AMPLITUDE = 6;
const CURVE_VERTICAL_PHASE_SCALE = 0.6;
const MIN_ALTITUDE_ABOVE_GROUND = 8;

const RING_RADIUS = 3.4;
const RING_TUBE = 0.32;
const MAX_ACTIVE_RINGS = 6;
const DESPAWN_BEHIND_DISTANCE = 40; // recycle once this far behind the bird along its forward axis

// How precisely the bird has to thread the ring to count as "collected".
const AXIAL_HIT_THRESHOLD = 2.2;

interface ActiveRing {
  mesh: THREE.Group;
  position: THREE.Vector3;
  normal: THREE.Vector3;
  collected: boolean;
  spinPhase: number;
}

/**
 * Spawns glowing low-poly rings ahead of the bird's flight path, detects when the bird
 * flies through one, and recycles rings once they're collected or left behind. Used only
 * when "Ring Challenge" mode is enabled from the start menu.
 */
export class RingManager {
  private scene: THREE.Scene;
  private active: ActiveRing[] = [];
  private pool: THREE.Group[] = [];
  // Zero so the very first ring spawns on the first update() call, directly ahead of the
  // bird's starting position — visible the instant flight begins.
  private spawnTimer = 0;
  private ringsSpawned = 0;
  private curvePhase = 0;
  private ringMaterial: THREE.MeshStandardMaterial;
  private glowMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: '#ffe066',
      emissive: '#ffb703',
      emissiveIntensity: 0.9,
      flatShading: true,
      roughness: 0.4,
    });
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: '#fff3bf',
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
  }

  private buildRingMesh(): THREE.Group {
    const group = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 16), this.ringMaterial);
    group.add(torus);
    // A soft translucent disc through the hoop makes the "threading" plane readable at a glance.
    const glow = new THREE.Mesh(new THREE.CircleGeometry(RING_RADIUS * 0.92, 20), this.glowMaterial);
    group.add(glow);
    return group;
  }

  private spawnRing(birdPosition: THREE.Vector3, forward: THREE.Vector3, heightAtWorld: (x: number, z: number) => number) {
    const isFirst = this.ringsSpawned === 0;
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let distance: number;
    let lateral: number;
    let vertical: number;

    if (isFirst) {
      // Spawn directly on the player's starting trajectory — no lateral/vertical offset —
      // so the first ring is immediately visible dead ahead as soon as flight begins.
      distance = FIRST_RING_DISTANCE;
      lateral = 0;
      vertical = 0;
    } else {
      distance = CHAIN_DISTANCE_MIN + Math.random() * (CHAIN_DISTANCE_MAX - CHAIN_DISTANCE_MIN);
      this.curvePhase += CURVE_STEP;
      lateral = Math.sin(this.curvePhase) * CURVE_LATERAL_AMPLITUDE;
      vertical = Math.sin(this.curvePhase * CURVE_VERTICAL_PHASE_SCALE + 1.2) * CURVE_VERTICAL_AMPLITUDE;
    }

    const position = birdPosition
      .clone()
      .addScaledVector(forward, distance)
      .addScaledVector(right, lateral)
      .add(new THREE.Vector3(0, vertical, 0));

    const ground = heightAtWorld(position.x, position.z);
    const minY = ground + MIN_ALTITUDE_ABOVE_GROUND;
    if (position.y < minY) position.y = minY;

    let mesh = this.pool.pop();
    if (mesh) {
      mesh.visible = true;
    } else {
      mesh = this.buildRingMesh();
      this.scene.add(mesh);
    }
    mesh.position.copy(position);
    mesh.lookAt(position.clone().add(forward));

    this.active.push({
      mesh,
      position,
      normal: forward.clone(),
      collected: false,
      spinPhase: Math.random() * Math.PI * 2,
    });

    this.ringsSpawned += 1;
  }

  private recycle(ring: ActiveRing) {
    ring.mesh.visible = false;
    this.pool.push(ring.mesh);
  }

  /**
   * Advance ring animation/spawning and check for a collection this frame.
   * Returns the collected ring's world position exactly once, the frame the bird threads
   * a ring — the caller can use it to trigger a burst effect at that spot — or `null`.
   */
  update(
    dt: number,
    birdPosition: THREE.Vector3,
    forward: THREE.Vector3,
    heightAtWorld: (x: number, z: number) => number,
  ): THREE.Vector3 | null {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < MAX_ACTIVE_RINGS) {
      this.spawnRing(birdPosition, forward, heightAtWorld);
      this.spawnTimer = SPAWN_INTERVAL;
    }

    let collectedPosition: THREE.Vector3 | null = null;

    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const ring = this.active[i];
      ring.spinPhase += dt * 0.6;
      ring.mesh.rotation.z = ring.spinPhase * 0.15;
      const pulse = 1 + Math.sin(ring.spinPhase * 2.2) * 0.04;
      ring.mesh.scale.setScalar(pulse);

      if (!ring.collected) {
        const delta = birdPosition.clone().sub(ring.position);
        const axialDist = delta.dot(ring.normal);
        const radialDist = delta.clone().addScaledVector(ring.normal, -axialDist).length();
        if (Math.abs(axialDist) < AXIAL_HIT_THRESHOLD && radialDist < RING_RADIUS) {
          ring.collected = true;
          collectedPosition = ring.position.clone();
          this.active.splice(i, 1);
          this.recycle(ring);
          continue;
        }

        // Recycle rings the bird has flown well past without collecting.
        if (axialDist < -DESPAWN_BEHIND_DISTANCE) {
          this.active.splice(i, 1);
          this.recycle(ring);
        }
      }
    }

    return collectedPosition;
  }

  /** World position of the nearest active (uncollected) ring, for the directional guide arrow — or null if none are active. */
  getNextRingPosition(birdPosition: THREE.Vector3): THREE.Vector3 | null {
    if (this.active.length === 0) return null;
    let closest = this.active[0];
    let closestDistSq = birdPosition.distanceToSquared(closest.position);
    for (let i = 1; i < this.active.length; i += 1) {
      const distSq = birdPosition.distanceToSquared(this.active[i].position);
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closest = this.active[i];
      }
    }
    return closest.position.clone();
  }

  dispose() {
    for (const ring of this.active) {
      this.scene.remove(ring.mesh);
    }
    for (const mesh of this.pool) {
      this.scene.remove(mesh);
    }
    this.active = [];
    this.pool = [];
  }
}
