import * as THREE from 'three';

// Reef band: coral/flora/anemones/fish/shark all live in this depth range below the water
// surface (y = 0 at water level). The seabed sits close to the surface (see
// GameEngine's SEABED_FLOOR_Y) so this reads as a shallow, richly populated reef rather than
// a deep empty ocean.
const REEF_DEPTH_MIN = -13;
const REEF_DEPTH_MAX = -4;

const REEF_SPAWN_INTERVAL = 0.55;
const REEF_SPAWN_DISTANCE_MIN = 28;
const REEF_SPAWN_DISTANCE_MAX = 65;
const REEF_LATERAL_OFFSET = 32;
const REEF_MAX_ACTIVE = 32;
const REEF_DESPAWN_BEHIND_DISTANCE = 42;

const FISH_PER_SCHOOL = 6;
const BUBBLE_POOL_SIZE = 200;
const BUBBLE_SPAWN_PER_SECOND = 18;
const BUBBLE_RISE_SPEED_MIN = 1.4;
const BUBBLE_RISE_SPEED_MAX = 2.6;
const BUBBLE_LIFETIME = 3.2;
const BUBBLE_HIDDEN_Y = -5000;

const CAUSTIC_RAY_COUNT = 7;

type ReefKind = 'coral' | 'flora' | 'anemone';

interface ActiveReefItem {
  group: THREE.Group;
  position: THREE.Vector3;
  forwardAtSpawn: THREE.Vector3;
  swayPhase: number;
  kind: ReefKind;
}

interface FishSchool {
  center: THREE.Vector3;
  driftOffset: THREE.Vector3;
  hueBase: number;
}

interface Fish {
  group: THREE.Group;
  schoolIndex: number;
  phase: number;
  radius: number;
  speed: number;
  heightOffset: number;
}

interface CausticRay {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  phase: number;
  baseOpacity: number;
}

/**
 * Everything decorative that appears once the bird dives below the water's surface: bright
 * low-poly coral, swaying sea anemones and glowing flora, several colorful schools of fish, a
 * patrolling shark, pulsing caustic light-ray planes, and a rising bubble stream. Lazily built
 * on first `setActive(true)` so mountain-map and airborne-only ocean sessions never pay any
 * cost for it.
 */
export class UnderwaterEnvironment {
  private scene: THREE.Scene;
  private built = false;
  private active = false;

  private reefGroup: THREE.Group | null = null;
  private activeReef: ActiveReefItem[] = [];
  private reefPool: ActiveReefItem[] = [];
  private reefSpawnTimer = 0;
  private coralMaterials: THREE.MeshStandardMaterial[] = [];
  private floraMaterials: THREE.MeshStandardMaterial[] = [];
  private anemoneMaterials: THREE.MeshStandardMaterial[] = [];

  private fishGroup: THREE.Group | null = null;
  private fish: Fish[] = [];
  private schools: FishSchool[] = [];

  private sharkGroup: THREE.Group | null = null;
  private sharkPhase = 0;
  private sharkPosition = new THREE.Vector3();
  private sharkPrevPosition = new THREE.Vector3();

  private causticGroup: THREE.Group | null = null;
  private causticRays: CausticRay[] = [];

  private bubblePoints: THREE.Points | null = null;
  private bubbleGeometry: THREE.BufferGeometry | null = null;
  private bubblePositions: Float32Array | null = null;
  private bubbleVelocities: Float32Array | null = null;
  private bubbleAges: Float32Array | null = null;
  private bubbleCursor = 0;
  private bubbleSpawnAccumulator = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private buildCoral(): THREE.Group {
    const group = new THREE.Group();
    const bodyCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bodyCount; i += 1) {
      const material = this.coralMaterials[Math.floor(Math.random() * this.coralMaterials.length)];
      const shape = Math.random();
      let mesh: THREE.Mesh;
      if (shape < 0.4) {
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.7 + Math.random() * 0.6, 1.8 + Math.random() * 1.4, 6), material);
      } else if (shape < 0.75) {
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + Math.random() * 0.6, 0), material);
      } else {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 2.2 + Math.random() * 1.4, 5), material);
      }
      mesh.position.set((Math.random() - 0.5) * 2.2, mesh.geometry.boundingSphere?.radius ?? 0.8, (Math.random() - 0.5) * 2.2);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      group.add(mesh);
    }
    return group;
  }

  private buildFlora(): THREE.Group {
    const group = new THREE.Group();
    const bladeCount = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < bladeCount; i += 1) {
      const material = this.floraMaterials[Math.floor(Math.random() * this.floraMaterials.length)];
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 1.6 + Math.random() * 1.2, 4), material);
      blade.position.set((Math.random() - 0.5) * 1.8, 0.8, (Math.random() - 0.5) * 1.8);
      blade.userData.phaseOffset = Math.random() * Math.PI * 2;
      group.add(blade);
    }
    return group;
  }

  /** Squat radial dome of thin tentacles — sways gently, glows brightly (anemones). */
  private buildAnemone(): THREE.Group {
    const group = new THREE.Group();
    const material = this.anemoneMaterials[Math.floor(Math.random() * this.anemoneMaterials.length)];
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), material);
    base.scale.y = 0.5;
    group.add(base);
    const tentacleCount = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < tentacleCount; i += 1) {
      const angle = (i / tentacleCount) * Math.PI * 2 + Math.random() * 0.2;
      const radius = 0.22;
      const tentacle = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.5 + Math.random() * 0.35, 4), material);
      tentacle.position.set(Math.cos(angle) * radius, 0.2, Math.sin(angle) * radius);
      tentacle.rotation.x = Math.cos(angle) * 0.5;
      tentacle.rotation.z = -Math.sin(angle) * 0.5;
      tentacle.userData.phaseOffset = Math.random() * Math.PI * 2;
      group.add(tentacle);
    }
    return group;
  }

  private buildFishMesh(hueBase: number): THREE.Group {
    const group = new THREE.Group();
    const hue = (hueBase + (Math.random() - 0.5) * 0.06 + 1) % 1;
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.75, 0.6),
      emissive: new THREE.Color().setHSL(hue, 0.75, 0.28),
      emissiveIntensity: 0.18,
      flatShading: true,
      roughness: 0.55,
    });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 6), material);
    body.rotation.z = Math.PI / 2;
    group.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 4), material);
    tail.rotation.z = -Math.PI / 2;
    tail.position.set(-0.4, 0, 0);
    group.add(tail);
    return group;
  }

  private buildShark(): THREE.Group {
    const material = new THREE.MeshStandardMaterial({ color: '#5b6570', flatShading: true, roughness: 0.55 });
    const bellyMaterial = new THREE.MeshStandardMaterial({ color: '#d9dee2', flatShading: true, roughness: 0.6 });

    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.4, 7), material);
    body.rotation.z = Math.PI / 2;
    group.add(body);

    const belly = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.6, 6), bellyMaterial);
    belly.rotation.z = Math.PI / 2;
    belly.position.y = -0.35;
    group.add(belly);

    const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), material);
    dorsalFin.position.set(0.3, 0.9, 0);
    group.add(dorsalFin);

    const tailFin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.5, 4), material);
    tailFin.rotation.z = Math.PI / 2;
    tailFin.position.set(-2.3, 0.3, 0);
    group.add(tailFin);

    return group;
  }

  /** Lazily builds everything on first activation, then simply toggles visibility after. */
  private ensureBuilt() {
    if (this.built) return;
    this.built = true;

    // Bright, slightly emissive materials so the shallow reef reads as vibrant even in the
    // dimmer parts of the fog, rather than needing strong directional light to look colorful.
    this.coralMaterials = [
      new THREE.MeshStandardMaterial({ color: '#ff5d73', emissive: '#ff2d55', emissiveIntensity: 0.28, flatShading: true, roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: '#ffb238', emissive: '#ff8a00', emissiveIntensity: 0.28, flatShading: true, roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: '#c96bff', emissive: '#8b2dff', emissiveIntensity: 0.28, flatShading: true, roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: '#3fe0d0', emissive: '#00c2b3', emissiveIntensity: 0.28, flatShading: true, roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: '#ffe14d', emissive: '#ffb700', emissiveIntensity: 0.22, flatShading: true, roughness: 0.55 }),
    ];
    this.floraMaterials = [
      new THREE.MeshStandardMaterial({ color: '#37e08a', emissive: '#0fae63', emissiveIntensity: 0.3, flatShading: true, roughness: 0.6 }),
      new THREE.MeshStandardMaterial({ color: '#5ce6ff', emissive: '#1fb8e6', emissiveIntensity: 0.3, flatShading: true, roughness: 0.6 }),
    ];
    this.anemoneMaterials = [
      new THREE.MeshStandardMaterial({ color: '#ff77c8', emissive: '#ff2f9e', emissiveIntensity: 0.35, flatShading: true, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: '#ff9d4d', emissive: '#ff6a00', emissiveIntensity: 0.3, flatShading: true, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: '#8f7bff', emissive: '#5c3dff', emissiveIntensity: 0.3, flatShading: true, roughness: 0.5 }),
    ];

    this.reefGroup = new THREE.Group();
    this.scene.add(this.reefGroup);

    // Several distinct schools (not just one), each with its own hue and drift offset relative
    // to the bird, so the reef feels populated by multiple colorful groups of fish at once.
    this.schools = [
      { center: new THREE.Vector3(), driftOffset: new THREE.Vector3(0, -3, 10), hueBase: 0.55 },
      { center: new THREE.Vector3(), driftOffset: new THREE.Vector3(-9, -5, 13), hueBase: 0.09 },
      { center: new THREE.Vector3(), driftOffset: new THREE.Vector3(8, -2, 9), hueBase: 0.86 },
    ];
    this.fishGroup = new THREE.Group();
    this.scene.add(this.fishGroup);
    this.schools.forEach((school, schoolIndex) => {
      for (let i = 0; i < FISH_PER_SCHOOL; i += 1) {
        const group = this.buildFishMesh(school.hueBase);
        this.fishGroup!.add(group);
        this.fish.push({
          group,
          schoolIndex,
          phase: Math.random() * Math.PI * 2,
          radius: 2 + Math.random() * 3,
          speed: 0.6 + Math.random() * 0.6,
          heightOffset: (Math.random() - 0.5) * 3,
        });
      }
    });

    this.sharkGroup = this.buildShark();
    this.scene.add(this.sharkGroup);

    this.causticGroup = new THREE.Group();
    this.scene.add(this.causticGroup);
    for (let i = 0; i < CAUSTIC_RAY_COUNT; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#d4f9ff'),
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 14), material);
      mesh.rotation.x = -Math.PI / 2.3;
      this.causticGroup.add(mesh);
      this.causticRays.push({ mesh, material, phase: Math.random() * Math.PI * 2, baseOpacity: 0.1 + Math.random() * 0.1 });
    }

    this.bubblePositions = new Float32Array(BUBBLE_POOL_SIZE * 3).fill(BUBBLE_HIDDEN_Y);
    this.bubbleVelocities = new Float32Array(BUBBLE_POOL_SIZE * 3);
    this.bubbleAges = new Float32Array(BUBBLE_POOL_SIZE).fill(BUBBLE_LIFETIME + 1);
    this.bubbleGeometry = new THREE.BufferGeometry();
    this.bubbleGeometry.setAttribute('position', new THREE.BufferAttribute(this.bubblePositions, 3));
    const bubbleMaterial = new THREE.PointsMaterial({
      color: '#eafcff',
      size: 0.14,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    });
    this.bubblePoints = new THREE.Points(this.bubbleGeometry, bubbleMaterial);
    this.bubblePoints.frustumCulled = false;
    this.scene.add(this.bubblePoints);
  }

  /** Toggles visibility of the whole underwater scene; builds it lazily on first activation. */
  setActive(active: boolean) {
    if (active) this.ensureBuilt();
    this.active = active;
    if (this.reefGroup) this.reefGroup.visible = active;
    if (this.fishGroup) this.fishGroup.visible = active;
    if (this.sharkGroup) this.sharkGroup.visible = active;
    if (this.causticGroup) this.causticGroup.visible = active;
    if (this.bubblePoints) this.bubblePoints.visible = active;
  }

  isActive() {
    return this.active;
  }

  private spawnReefItem(birdPosition: THREE.Vector3, forward: THREE.Vector3) {
    const roll = Math.random();
    const kind: ReefKind = roll < 0.45 ? 'coral' : roll < 0.72 ? 'flora' : 'anemone';
    const distance = REEF_SPAWN_DISTANCE_MIN + Math.random() * (REEF_SPAWN_DISTANCE_MAX - REEF_SPAWN_DISTANCE_MIN);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const lateral = (Math.random() - 0.5) * 2 * REEF_LATERAL_OFFSET;
    const depth = REEF_DEPTH_MIN + Math.random() * (REEF_DEPTH_MAX - REEF_DEPTH_MIN);

    const position = new THREE.Vector3(birdPosition.x, 0, birdPosition.z)
      .addScaledVector(forward, distance)
      .addScaledVector(right, lateral);
    position.y = depth;

    let item = this.reefPool.pop();
    if (item) {
      item.group.visible = true;
    } else {
      const group = kind === 'coral' ? this.buildCoral() : kind === 'flora' ? this.buildFlora() : this.buildAnemone();
      this.reefGroup!.add(group);
      item = { group, position, forwardAtSpawn: forward.clone(), swayPhase: Math.random() * Math.PI * 2, kind };
    }
    item.position.copy(position);
    item.forwardAtSpawn.copy(forward);
    item.group.position.copy(position);
    this.activeReef.push(item);
  }

  private spawnBubble(origin: THREE.Vector3) {
    if (!this.bubblePositions || !this.bubbleVelocities || !this.bubbleAges) return;
    const i = this.bubbleCursor;
    this.bubbleCursor = (this.bubbleCursor + 1) % BUBBLE_POOL_SIZE;

    this.bubblePositions[i * 3] = origin.x + (Math.random() - 0.5) * 1.2;
    this.bubblePositions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.6;
    this.bubblePositions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.2;

    this.bubbleVelocities[i * 3] = (Math.random() - 0.5) * 0.2;
    this.bubbleVelocities[i * 3 + 1] = BUBBLE_RISE_SPEED_MIN + Math.random() * (BUBBLE_RISE_SPEED_MAX - BUBBLE_RISE_SPEED_MIN);
    this.bubbleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;

    this.bubbleAges[i] = 0;
  }

  /** Call every frame while active is true; safe to call while inactive too (becomes a no-op). */
  update(dt: number, birdPosition: THREE.Vector3, forward: THREE.Vector3) {
    if (!this.active || !this.built) return;

    // Reef streaming: same spawn-ahead / despawn-behind pattern as CloudManager.
    this.reefSpawnTimer -= dt;
    if (this.reefSpawnTimer <= 0 && this.activeReef.length < REEF_MAX_ACTIVE) {
      this.spawnReefItem(birdPosition, forward);
      this.reefSpawnTimer = REEF_SPAWN_INTERVAL;
    }
    for (let i = this.activeReef.length - 1; i >= 0; i -= 1) {
      const item = this.activeReef[i];
      if (item.kind !== 'coral') {
        item.swayPhase += dt * (item.kind === 'anemone' ? 1.8 : 1.4);
        const amplitude = item.kind === 'anemone' ? 0.25 : 0.18;
        for (const child of item.group.children) {
          const mesh = child as THREE.Mesh;
          const phaseOffset = (mesh.userData.phaseOffset as number) ?? 0;
          mesh.rotation.z = Math.sin(item.swayPhase + phaseOffset) * amplitude;
        }
      }
      const delta = birdPosition.clone().sub(item.position);
      const axialDist = delta.dot(item.forwardAtSpawn);
      if (axialDist > REEF_DESPAWN_BEHIND_DISTANCE) {
        this.activeReef.splice(i, 1);
        item.group.visible = false;
        this.reefPool.push(item);
      }
    }

    // Schooling fish: each school has its own slowly-drifting center near the bird (offset
    // laterally/vertically/ahead so the schools don't overlap), with each fish wandering on
    // its own sine orbit around that center.
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    for (const school of this.schools) {
      const desiredCenter = birdPosition
        .clone()
        .addScaledVector(forward, school.driftOffset.z)
        .addScaledVector(right, school.driftOffset.x)
        .add(new THREE.Vector3(0, school.driftOffset.y, 0));
      school.center.lerp(desiredCenter, 0.02);
    }
    for (const f of this.fish) {
      const school = this.schools[f.schoolIndex];
      f.phase += dt * f.speed;
      f.group.position.set(
        school.center.x + Math.cos(f.phase) * f.radius,
        school.center.y + f.heightOffset + Math.sin(f.phase * 1.7) * 0.6,
        school.center.z + Math.sin(f.phase) * f.radius,
      );
      f.group.rotation.y = -f.phase + Math.PI / 2;
    }

    // Shark: patrols a wide lazy figure via sine offsets, facing wherever it's actually
    // heading each frame (derived from its own motion delta, no extra stored heading state).
    this.sharkPhase += dt * 0.35;
    this.sharkPrevPosition.copy(this.sharkPosition);
    this.sharkPosition.set(
      birdPosition.x + Math.sin(this.sharkPhase) * 18,
      REEF_DEPTH_MIN - 2 + Math.sin(this.sharkPhase * 0.6) * 1.5,
      birdPosition.z + Math.cos(this.sharkPhase * 0.7) * 22,
    );
    if (this.sharkGroup) {
      this.sharkGroup.position.copy(this.sharkPosition);
      const movement = this.sharkPosition.clone().sub(this.sharkPrevPosition);
      if (movement.lengthSq() > 0.0001) {
        this.sharkGroup.lookAt(this.sharkPosition.clone().add(movement));
      }
    }

    // Caustic rays: pulse opacity independently and drift a slow rotation, positioned above
    // wherever the bird currently is so they always read as "sunlight streaming down".
    if (this.causticGroup) {
      this.causticGroup.position.set(birdPosition.x, 2, birdPosition.z);
      for (const ray of this.causticRays) {
        ray.phase += dt * 0.5;
        ray.material.opacity = ray.baseOpacity + Math.sin(ray.phase) * ray.baseOpacity * 0.6;
        ray.mesh.rotation.z += dt * 0.05;
      }
    }

    // Bubbles: continuously spawn near the bird, rise, and recycle once they age out or
    // reach a height above the water surface.
    this.bubbleSpawnAccumulator += dt * BUBBLE_SPAWN_PER_SECOND;
    while (this.bubbleSpawnAccumulator >= 1) {
      this.spawnBubble(birdPosition);
      this.bubbleSpawnAccumulator -= 1;
    }
    if (this.bubblePositions && this.bubbleVelocities && this.bubbleAges) {
      for (let i = 0; i < BUBBLE_POOL_SIZE; i += 1) {
        if (this.bubbleAges[i] > BUBBLE_LIFETIME) {
          this.bubblePositions[i * 3 + 1] = BUBBLE_HIDDEN_Y;
          continue;
        }
        this.bubbleAges[i] += dt;
        this.bubblePositions[i * 3] += this.bubbleVelocities[i * 3] * dt;
        this.bubblePositions[i * 3 + 1] += this.bubbleVelocities[i * 3 + 1] * dt;
        this.bubblePositions[i * 3 + 2] += this.bubbleVelocities[i * 3 + 2] * dt;
        if (this.bubblePositions[i * 3 + 1] > -0.5) {
          this.bubbleAges[i] = BUBBLE_LIFETIME + 1;
          this.bubblePositions[i * 3 + 1] = BUBBLE_HIDDEN_Y;
        }
      }
      (this.bubbleGeometry!.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Removes only the root-level groups/points from the scene (matches CloudManager's convention). */
  dispose() {
    if (this.reefGroup) this.scene.remove(this.reefGroup);
    if (this.fishGroup) this.scene.remove(this.fishGroup);
    if (this.sharkGroup) this.scene.remove(this.sharkGroup);
    if (this.causticGroup) this.scene.remove(this.causticGroup);
    if (this.bubblePoints) this.scene.remove(this.bubblePoints);
  }
}
