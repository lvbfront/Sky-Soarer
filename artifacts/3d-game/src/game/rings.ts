import * as THREE from 'three';

const SPAWN_INTERVAL = 2.1; // seconds between ring spawns
const SPAWN_DISTANCE_MIN = 70;
const SPAWN_DISTANCE_MAX = 130;
const LATERAL_OFFSET = 22;
const VERTICAL_OFFSET_MIN = -6;
const VERTICAL_OFFSET_MAX = 14;
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
  private spawnTimer = SPAWN_INTERVAL * 0.5;
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
    const distance = SPAWN_DISTANCE_MIN + Math.random() * (SPAWN_DISTANCE_MAX - SPAWN_DISTANCE_MIN);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const lateral = (Math.random() - 0.5) * 2 * LATERAL_OFFSET;
    const vertical = VERTICAL_OFFSET_MIN + Math.random() * (VERTICAL_OFFSET_MAX - VERTICAL_OFFSET_MIN);

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
  }

  private recycle(ring: ActiveRing) {
    ring.mesh.visible = false;
    this.pool.push(ring.mesh);
  }

  /**
   * Advance ring animation/spawning and check for a collection this frame.
   * Returns true exactly once, the frame the bird threads a ring.
   */
  update(
    dt: number,
    birdPosition: THREE.Vector3,
    forward: THREE.Vector3,
    heightAtWorld: (x: number, z: number) => number,
  ): boolean {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < MAX_ACTIVE_RINGS) {
      this.spawnRing(birdPosition, forward, heightAtWorld);
      this.spawnTimer = SPAWN_INTERVAL;
    }

    let collectedThisFrame = false;

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
          collectedThisFrame = true;
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

    return collectedThisFrame;
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
