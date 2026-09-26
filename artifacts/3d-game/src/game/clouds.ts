import * as THREE from 'three';

const SPAWN_INTERVAL = 3.2;
const SPAWN_DISTANCE_MIN = 90;
const SPAWN_DISTANCE_MAX = 160;
const LATERAL_OFFSET = 45;
const VERTICAL_OFFSET_MIN = -10;
const VERTICAL_OFFSET_MAX = 24;
const MAX_ACTIVE = 10;
const DESPAWN_BEHIND_DISTANCE = 60;
// Also recycle any cloud this far from the bird in any direction (clouds spawn at most ~175 units
// away). Catches clouds left behind by a turn or U-turn, which the axial check above misses and
// which would otherwise fill MAX_ACTIVE and stop new clouds from spawning.
const DESPAWN_MAX_DISTANCE = 240;

interface ActiveCloud {
  group: THREE.Group;
  position: THREE.Vector3;
  forwardAtSpawn: THREE.Vector3;
  drift: THREE.Vector3;
}

/**
 * Volumetric-looking cloud clusters that stream in ahead of the bird within the actual
 * flight corridor (unlike the purely decorative, far-off clusters in GameEngine's sky
 * dome) — soft, low-opacity, and placed at reachable altitudes so the bird can fly
 * straight through them.
 */
export class CloudManager {
  private scene: THREE.Scene;
  private active: ActiveCloud[] = [];
  private pool: THREE.Group[] = [];
  private spawnTimer = 0;
  private material: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.5,
      flatShading: true,
      depthWrite: false,
      fog: true,
    });
  }

  private buildCloud(): THREE.Group {
    const group = new THREE.Group();
    const puffCount = 5 + Math.floor(Math.random() * 4);
    for (let p = 0; p < puffCount; p += 1) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6 + Math.random() * 2.4, 0), this.material);
      puff.position.set((Math.random() - 0.5) * 11, (Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 11);
      group.add(puff);
    }
    return group;
  }

  private spawn(birdPosition: THREE.Vector3, forward: THREE.Vector3) {
    const distance = SPAWN_DISTANCE_MIN + Math.random() * (SPAWN_DISTANCE_MAX - SPAWN_DISTANCE_MIN);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const lateral = (Math.random() - 0.5) * 2 * LATERAL_OFFSET;
    const vertical = VERTICAL_OFFSET_MIN + Math.random() * (VERTICAL_OFFSET_MAX - VERTICAL_OFFSET_MIN);

    const position = birdPosition
      .clone()
      .addScaledVector(forward, distance)
      .addScaledVector(right, lateral)
      .add(new THREE.Vector3(0, vertical, 0));

    let group = this.pool.pop();
    if (group) {
      group.visible = true;
    } else {
      group = this.buildCloud();
      this.scene.add(group);
    }
    group.position.copy(position);

    this.active.push({
      group,
      position,
      forwardAtSpawn: forward.clone(),
      drift: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4),
    });
  }

  update(dt: number, birdPosition: THREE.Vector3, forward: THREE.Vector3) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.active.length < MAX_ACTIVE) {
      this.spawn(birdPosition, forward);
      this.spawnTimer = SPAWN_INTERVAL;
    }

    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const cloud = this.active[i];
      cloud.position.addScaledVector(cloud.drift, dt);
      cloud.group.position.copy(cloud.position);

      const delta = birdPosition.clone().sub(cloud.position);
      const axialDist = delta.dot(cloud.forwardAtSpawn);
      if (axialDist > DESPAWN_BEHIND_DISTANCE || delta.lengthSq() > DESPAWN_MAX_DISTANCE * DESPAWN_MAX_DISTANCE) {
        this.active.splice(i, 1);
        cloud.group.visible = false;
        this.pool.push(cloud.group);
      }
    }
  }

  dispose() {
    for (const cloud of this.active) this.scene.remove(cloud.group);
    for (const group of this.pool) this.scene.remove(group);
    this.active = [];
    this.pool = [];
  }
}
