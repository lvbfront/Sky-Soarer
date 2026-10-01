import * as THREE from 'three';
import { damp } from './damping';
import { bake, jitter, mergeBaked, ribbon, streamlinedBody, triangle } from './lowPoly';
import type { OceanField } from './oceanField';
import { patchOceanMaterial, type OceanUniforms } from './oceanShaders';

// Underwater creatures. Every species is one draw call: fish are InstancedMeshes (four species,
// several schools), the jellyfish share one InstancedMesh, and the turtle, manta and shark are
// single merged meshes. All the animation that bends a body (tail wag, flipper and wing beats,
// bell pulses, tentacle sway) runs in the vertex shader; the CPU only moves each animal as a
// whole: simple flocking for the schools, a steering "cruiser" for the big animals, and every one
// of them keeps a little distance from the bird instead of swimming through it.

// Fish never come closer to the bird than this (they scatter), nor to the seabed / surface.
const FISH_AVOID_RADIUS = 6;
const BIG_AVOID_RADIUS = 9;
const SURFACE_CLEARANCE = 1.5;
// Schools drift after the bird with this lag; a school that ends up this far away is moved ahead.
const SCHOOL_FOLLOW_RATE = 0.5;
const SCHOOL_RELOCATE_DISTANCE = 60;
const JELLY_COUNT = 9;
const JELLY_RECYCLE_DISTANCE = 55;

interface FishSpeciesDef {
  geometry: () => THREE.BufferGeometry;
  colors: string[];
  schools: number;
  perSchool: number;
  scale: number;
  minSpeed: number;
  maxSpeed: number;
  /** Preferred height above the seabed. */
  height: [number, number];
  /** How far from the bird the school's anchor sits. */
  distance: [number, number];
  /** Spread of the school around its target. */
  spread: number;
  wag: { amp: number; freq: number; k: number; head: number; tail: number };
}

function fishBody(stations: [number, number, number, number][], sides: number, color: (x: number, y: number, z: number) => THREE.ColorRepresentation, tail: [number, number, number]) {
  const [tailZ, tailH, tailLen] = tail;
  const parts = [
    bake(streamlinedBody(stations, sides), color),
    bake(triangle([0, 0, tailZ + 0.02], [0, tailH, tailZ - tailLen], [0, -tailH, tailZ - tailLen]), color),
  ];
  return parts;
}

function sardine() {
  const color = (_x: number, y: number) => (y > 0.02 ? '#5f7f9f' : y > -0.03 ? '#c9dae8' : '#f2f6fa');
  return mergeBaked(
    fishBody(
      [
        [0.26, 0.005, 0.005, 0],
        [0.18, 0.045, 0.06, 0],
        [0.0, 0.055, 0.075, 0],
        [-0.16, 0.035, 0.045, 0],
        [-0.25, 0.01, 0.015, 0],
      ],
      5,
      color,
      [-0.25, 0.08, 0.12],
    ),
  );
}

function tang() {
  // Pale body (the school's instance colour tints it yellow or blue) with dark fin edges.
  const color = (_x: number, y: number) => (Math.abs(y) > 0.2 ? '#3a3a4a' : '#ffffff');
  const parts = fishBody(
    [
      [0.28, 0.005, 0.02, 0],
      [0.2, 0.045, 0.14, 0],
      [0.02, 0.06, 0.24, 0],
      [-0.16, 0.04, 0.16, 0],
      [-0.26, 0.012, 0.03, 0],
    ],
    6,
    color,
    [-0.26, 0.14, 0.14],
  );
  parts.push(bake(triangle([0, 0.2, 0.12], [0, 0.3, -0.05], [0, 0.14, -0.2]), '#3a3a4a'));
  parts.push(bake(triangle([0, -0.2, 0.08], [0, -0.28, -0.06], [0, -0.13, -0.18]), '#3a3a4a'));
  return mergeBaked(parts);
}

function clownfish() {
  // Orange with three white bands edged in black.
  const color = (_x: number, _y: number, z: number) => {
    for (const band of [0.12, -0.02, -0.17]) {
      const d = Math.abs(z - band);
      if (d < 0.025) return '#ffffff';
      if (d < 0.038) return '#1a1a1a';
    }
    return '#ff7a1a';
  };
  return mergeBaked(
    fishBody(
      [
        [0.21, 0.01, 0.02, 0],
        [0.14, 0.06, 0.08, 0],
        [0.0, 0.07, 0.1, 0],
        [-0.14, 0.045, 0.065, 0],
        [-0.2, 0.015, 0.02, 0],
      ],
      6,
      color,
      [-0.2, 0.09, 0.1],
    ),
  );
}

function parrotfish() {
  const color = (_x: number, y: number, z: number) => (z > 0.36 ? '#f0e0c0' : y > 0.05 ? '#2fb5a0' : Math.sin(z * 30) > 0.6 ? '#ff8fb0' : '#58d6c2');
  const parts = fishBody(
    [
      [0.45, 0.02, 0.03, -0.01],
      [0.34, 0.11, 0.13, 0],
      [0.05, 0.15, 0.2, 0],
      [-0.22, 0.1, 0.13, 0],
      [-0.4, 0.03, 0.04, 0],
    ],
    6,
    color,
    [-0.4, 0.18, 0.18],
  );
  parts.push(bake(triangle([0, 0.19, 0.25], [0, 0.27, -0.05], [0, 0.12, -0.3]), '#1f8f80'));
  return mergeBaked(parts);
}

const FISH_SPECIES: FishSpeciesDef[] = [
  {
    geometry: sardine,
    colors: ['#ffffff', '#e8f2ff'],
    schools: 1,
    perSchool: 34,
    scale: 1.3,
    minSpeed: 2.8,
    maxSpeed: 5.5,
    height: [4, 7],
    distance: [16, 26],
    spread: 3.2,
    wag: { amp: 0.035, freq: 15, k: 12, head: 0.2, tail: -0.28 },
  },
  {
    geometry: tang,
    colors: ['#ffd23f', '#3f7fff', '#ffd23f'],
    schools: 2,
    perSchool: 10,
    scale: 1.5,
    minSpeed: 1.6,
    maxSpeed: 3.6,
    height: [1.5, 3.5],
    distance: [12, 24],
    spread: 2.4,
    wag: { amp: 0.05, freq: 9, k: 8, head: 0.15, tail: -0.3 },
  },
  {
    geometry: clownfish,
    colors: ['#ffffff'],
    schools: 2,
    perSchool: 6,
    scale: 1.7,
    minSpeed: 1.2,
    maxSpeed: 2.8,
    height: [0.8, 2],
    distance: [9, 20],
    spread: 1.4,
    wag: { amp: 0.05, freq: 11, k: 10, head: 0.1, tail: -0.24 },
  },
  {
    geometry: parrotfish,
    colors: ['#ffffff', '#e0fff4'],
    schools: 1,
    perSchool: 5,
    scale: 1.8,
    minSpeed: 1.4,
    maxSpeed: 3.2,
    height: [1.2, 3],
    distance: [14, 28],
    spread: 2.6,
    wag: { amp: 0.07, freq: 7, k: 5, head: 0.2, tail: -0.5 },
  },
];

function buildTurtle() {
  const parts: THREE.BufferGeometry[] = [];
  const shell = jitter(new THREE.IcosahedronGeometry(1, 1), 0.06, 2);
  shell.scale(0.85, 0.36, 1.05);
  parts.push(
    bake(shell, (x, y, z) => (y < -0.05 ? '#e2d49a' : Math.sin(x * 9) * Math.sin(z * 8) > 0.25 ? '#8a6a3a' : '#5f7f3f'), { aFlap: 0 }),
  );
  const head = new THREE.IcosahedronGeometry(0.28, 0);
  head.scale(0.9, 0.75, 1.2);
  head.translate(0, 0.02, 1.2);
  parts.push(bake(head, '#8fa070', { aFlap: 0 }));
  for (const side of [-1, 1]) {
    const front = new THREE.BoxGeometry(1.0, 0.07, 0.34);
    front.translate(0.5, 0, 0);
    front.rotateY(side > 0 ? -0.5 : Math.PI + 0.5);
    front.translate(side * 0.72, -0.05, 0.45);
    parts.push(bake(front, '#7f9a60', { aFlap: side }));
    const back = new THREE.BoxGeometry(0.5, 0.06, 0.28);
    back.translate(0.25, 0, 0);
    back.rotateY(side > 0 ? 0.6 : Math.PI - 0.6);
    back.translate(side * 0.5, -0.05, -0.85);
    parts.push(bake(back, '#7f9a60', { aFlap: side * 0.4 }));
  }
  return mergeBaked(parts);
}

function buildManta() {
  const parts: THREE.BufferGeometry[] = [];
  const top = '#25323d';
  const belly = '#e3eaee';
  // Outline (x, z), nose to tail, right half; mirrored for the left.
  const rim: [number, number][] = [
    [0, 1.1],
    [0.7, 0.75],
    [1.6, 0.2],
    [2.5, -0.35],
    [1.5, -0.55],
    [0.6, -0.9],
    [0, -1.0],
  ];
  const center: [number, number, number] = [0, 0.16, 0.05];
  const centerBelow: [number, number, number] = [0, -0.1, 0.05];
  for (const side of [-1, 1]) {
    for (let i = 0; i < rim.length - 1; i += 1) {
      const a = [rim[i][0] * side, 0, rim[i][1]];
      const b = [rim[i + 1][0] * side, 0, rim[i + 1][1]];
      parts.push(bake(triangle([...center], side > 0 ? b : a, side > 0 ? a : b), top));
      parts.push(bake(triangle([...centerBelow], side > 0 ? a : b, side > 0 ? b : a), belly));
    }
    // Cephalic fins.
    parts.push(bake(triangle([side * 0.35, 0.02, 0.95], [side * 0.55, -0.05, 1.45], [side * 0.62, 0.02, 0.85]), top));
  }
  // Tail.
  parts.push(bake(triangle([-0.06, 0, -0.95], [0.06, 0, -0.95], [0, 0.02, -3.2]), top));
  return mergeBaked(parts);
}

function buildJelly() {
  const parts: THREE.BufferGeometry[] = [];
  const bell = new THREE.SphereGeometry(0.6, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  bell.scale(1, 0.75, 1);
  parts.push(bake(bell, (_x, y) => (y < 0.08 ? '#ffffff' : '#f2e6ff'), { aGlow: (_x, y) => (y < 0.1 ? 1 : 0.35), aPulse: 1 }));
  const tentacles = 8;
  for (let i = 0; i < tentacles; i += 1) {
    const a = (i / tentacles) * Math.PI * 2;
    const t = ribbon(0.05, 1.5 + (i % 3) * 0.35, 5, 0.6);
    t.rotateX(Math.PI);
    t.rotateY(a);
    t.translate(Math.cos(a) * 0.48, 0.02, Math.sin(a) * 0.48);
    parts.push(bake(t, '#ffffff', { aGlow: 0.8, aPulse: 0 }));
  }
  for (let i = 0; i < 3; i += 1) {
    const arm = ribbon(0.14, 1.1, 5, 0.5);
    arm.rotateX(Math.PI);
    arm.rotateY((i / 3) * Math.PI * 2);
    arm.translate(0, 0.05, 0);
    parts.push(bake(arm, '#fbe8ff', { aGlow: 0.5, aPulse: 0 }));
  }
  return mergeBaked(parts);
}

function buildShark() {
  const top = '#6b7a88';
  const belly = '#e6eaec';
  const fin = '#5b6875';
  const body = streamlinedBody(
    [
      [2.55, 0.02, 0.02, 0.02],
      [2.25, 0.26, 0.22, 0.02],
      [1.6, 0.48, 0.44, 0],
      [0.6, 0.6, 0.55, 0],
      [-0.5, 0.48, 0.44, 0.02],
      [-1.5, 0.26, 0.24, 0.05],
      [-2.1, 0.11, 0.12, 0.08],
      [-2.4, 0.05, 0.05, 0.1],
    ],
    8,
  );
  const parts = [
    // Counter-shaded: slate on top, pale belly; dark eyes near the snout.
    bake(body, (x, y, z) => (z > 1.85 && z < 2.05 && y > 0.05 && Math.abs(x) > 0.2 ? '#101418' : y > -0.08 ? top : belly)),
    bake(triangle([0, 0.5, 0.55], [0, 1.55, -0.25], [0, 0.44, -0.55]), fin),
    bake(triangle([0, 0.2, -1.55], [0, 0.55, -1.8], [0, 0.18, -1.85]), fin),
  ];
  for (const side of [-1, 1]) {
    parts.push(bake(triangle([side * 0.5, -0.2, 0.9], [side * 1.7, -0.62, -0.05], [side * 0.46, -0.24, 0.1]), fin));
  }
  // Heterocercal tail: a tall upper lobe and a shorter lower one.
  parts.push(bake(triangle([0, 0.08, -2.3], [0, 1.25, -3.15], [0, 0.12, -2.7]), fin));
  parts.push(bake(triangle([0, 0.02, -2.3], [0, -0.7, -2.95], [0, 0.0, -2.6]), fin));
  return mergeBaked(parts);
}

const scratchMatrix = new THREE.Matrix4();
const scratchLook = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchDir = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Rotation that points local +Z along `dir` (unit), keeping the animal upright. */
function orient(out: THREE.Quaternion, dir: THREE.Vector3) {
  scratchLook.lookAt(dir, ORIGIN, UP);
  return out.setFromRotationMatrix(scratchLook);
}

interface School {
  species: number;
  mesh: THREE.InstancedMesh;
  start: number;
  /** Index of this school's first fish inside its species' InstancedMesh. */
  meshStart: number;
  count: number;
  /** Anchor offset around the bird: angle (relative to its heading) and distance. */
  angle: number;
  distance: number;
  anchor: THREE.Vector3;
  target: THREE.Vector3;
  wander: number;
  height: number;
  groundY: number;
}

/** A single big animal that steers toward a wandering goal near the bird, keeping its distance. */
class Cruiser {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3(0, 0, 1);
  readonly direction = new THREE.Vector3(0, 0, 1);
  readonly goal = new THREE.Vector3();
  private phase = Math.random() * 100;

  constructor(
    readonly object: THREE.Object3D,
    private speed: number,
    private orbit: [number, number],
    private height: [number, number],
    private turnRate: number,
  ) {}

  place(bird: THREE.Vector3, forward: THREE.Vector3, field: OceanField) {
    const a = Math.random() * Math.PI * 2;
    const d = this.orbit[0] + Math.random() * (this.orbit[1] - this.orbit[0]);
    this.position.set(bird.x + Math.sin(a) * d, 0, bird.z + Math.cos(a) * d);
    this.position.y = this.depthAt(field, this.position.x, this.position.z, 0.5);
    this.velocity.set(forward.x, 0, forward.z).normalize().multiplyScalar(this.speed);
    this.direction.copy(this.velocity).normalize();
  }

  private depthAt(field: OceanField, x: number, z: number, t: number) {
    const ground = field.groundHeight(x, z);
    return Math.min(ground + this.height[0] + (this.height[1] - this.height[0]) * t, -SURFACE_CLEARANCE - 1);
  }

  update(dt: number, bird: THREE.Vector3, field: OceanField) {
    this.phase += dt;
    // Goal: a slow orbit around the bird at the preferred distance and height.
    const a = this.phase * (this.speed / ((this.orbit[0] + this.orbit[1]) * 0.5)) * 0.7;
    const d = (this.orbit[0] + this.orbit[1]) * 0.5 + Math.sin(this.phase * 0.23) * (this.orbit[1] - this.orbit[0]) * 0.5;
    this.goal.set(bird.x + Math.sin(a) * d, 0, bird.z + Math.cos(a) * d);
    this.goal.y = this.depthAt(field, this.goal.x, this.goal.z, 0.5 + 0.5 * Math.sin(this.phase * 0.31));

    const desired = scratchA.subVectors(this.goal, this.position);
    const toBird = scratchDir.subVectors(this.position, bird);
    const birdDist = toBird.length();
    if (birdDist < BIG_AVOID_RADIUS && birdDist > 1e-3) desired.addScaledVector(toBird, ((BIG_AVOID_RADIUS - birdDist) / birdDist) * 4);
    const floor = field.groundHeight(this.position.x, this.position.z) + this.height[0] * 0.6;
    if (this.position.y < floor) desired.y += (floor - this.position.y) * 4;
    if (this.position.y > -SURFACE_CLEARANCE) desired.y -= 4;
    desired.normalize();
    this.direction.lerp(desired, damp(this.turnRate, dt)).normalize();
    this.velocity.copy(this.direction).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.distanceToSquared(bird) > 90 * 90) this.position.set(this.goal.x, this.goal.y, this.goal.z);

    this.object.position.copy(this.position);
    orient(this.object.quaternion, this.direction);
  }
}

export class SeaLife {
  readonly group = new THREE.Group();
  private fishMeshes: THREE.InstancedMesh[] = [];
  private schools: School[] = [];
  // Per fish (across all species): position, velocity, heading and a size factor.
  private fishPos: Float32Array;
  private fishVel: Float32Array;
  private fishScale: Float32Array;
  private density = 1;

  private cruisers: Cruiser[] = [];
  private jellies: THREE.InstancedMesh;
  private jellyPos = new Float32Array(JELLY_COUNT * 3);
  private jellyPhase = new Float32Array(JELLY_COUNT);
  private seeded = false;

  constructor(
    parent: THREE.Object3D,
    private field: OceanField,
    uniforms: OceanUniforms,
  ) {
    let fishIndex = 0;
    FISH_SPECIES.forEach((def, speciesIndex) => {
      const capacity = def.schools * def.perSchool;
      const wag = { uWagAmp: { value: def.wag.amp }, uWagFreq: { value: def.wag.freq }, uWagK: { value: def.wag.k }, uHeadZ: { value: def.wag.head }, uTailZ: { value: def.wag.tail } };
      const material = patchOceanMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), uniforms, {
        key: 'fish',
        uniforms: wag,
        vertex: /* glsl */ `
          float tailW = 1.0 - smoothstep(uTailZ, uHeadZ, position.z);
          transformed.x += sin(uTime * uWagFreq + oceanIndex * 1.7 - position.z * uWagK) * uWagAmp * tailW;`,
      });
      const mesh = new THREE.InstancedMesh(def.geometry(), material, capacity);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.frustumCulled = false;
      this.fishMeshes.push(mesh);
      this.group.add(mesh);
      for (let s = 0; s < def.schools; s += 1) {
        const tint = new THREE.Color(def.colors[s % def.colors.length]);
        const school: School = {
          species: speciesIndex,
          mesh,
          start: fishIndex,
          meshStart: s * def.perSchool,
          count: def.perSchool,
          angle: ((this.schools.length * 2.4) % (Math.PI * 2)) - Math.PI,
          distance: def.distance[0] + Math.random() * (def.distance[1] - def.distance[0]),
          anchor: new THREE.Vector3(),
          target: new THREE.Vector3(),
          wander: Math.random() * 100,
          height: def.height[0] + Math.random() * (def.height[1] - def.height[0]),
          groundY: -15,
        };
        for (let i = 0; i < def.perSchool; i += 1) {
          const c = tint.clone().offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.08);
          mesh.setColorAt(s * def.perSchool + i, c);
        }
        this.schools.push(school);
        fishIndex += def.perSchool;
      }
    });
    this.fishPos = new Float32Array(fishIndex * 3);
    this.fishVel = new Float32Array(fishIndex * 3);
    this.fishScale = new Float32Array(fishIndex);
    this.schools.forEach((school) => {
      for (let i = 0; i < school.count; i += 1) {
        this.fishScale[school.start + i] = FISH_SPECIES[school.species].scale * (0.8 + Math.random() * 0.4);
      }
    });

    const bigMaterial = (key: string, vertex: string, header: string) =>
      patchOceanMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), uniforms, {
        key,
        caustics: true,
        vertex,
        vertexHeader: header,
      });

    const turtle = new THREE.Mesh(
      buildTurtle(),
      bigMaterial(
        'turtle',
        /* glsl */ `
          float stroke = sin(uTime * 1.7);
          float reach = abs(position.x) - 0.6;
          if (aFlap != 0.0 && reach > 0.0) {
            transformed.y += stroke * reach * 0.55 * abs(aFlap);
            transformed.z += cos(uTime * 1.7) * reach * 0.25 * abs(aFlap);
          }`,
        'attribute float aFlap;',
      ),
    );
    turtle.scale.setScalar(1.3);
    const manta = new THREE.Mesh(
      buildManta(),
      bigMaterial(
        'manta',
        /* glsl */ `
          float span = abs(position.x) / 2.5;
          transformed.y += sin(uTime * 1.25 - abs(position.x) * 0.55) * pow(span, 1.5) * 0.85;
          transformed.x += sin(uTime * 0.9 + position.z) * 0.05 * step(position.z, -1.0);`,
        '',
      ),
    );
    manta.scale.setScalar(1.6);
    const shark = new THREE.Mesh(
      buildShark(),
      bigMaterial(
        'shark',
        /* glsl */ `
          float tailW = 1.0 - smoothstep(-2.8, 1.2, position.z);
          transformed.x += sin(uTime * 2.3 - position.z * 0.85) * 0.32 * tailW * tailW;`,
        '',
      ),
    );
    for (const mesh of [turtle, manta, shark]) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.cruisers.push(new Cruiser(turtle, 1.7, [16, 30], [2.5, 5], 0.8));
    this.cruisers.push(new Cruiser(manta, 3.2, [22, 38], [5, 9], 0.5));
    this.cruisers.push(new Cruiser(shark, 3.8, [18, 28], [3, 6], 0.9));

    const jellyMaterial = patchOceanMaterial(
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      uniforms,
      {
        key: 'jelly',
        glow: true,
        fogCull: false,
        vertexHeader: 'attribute float aPulse;',
        vertex: /* glsl */ `
          float pulse = sin(uTime * 2.1 + oceanIndex * 1.3);
          transformed.xz *= 1.0 + aPulse * pulse * 0.13;
          transformed.y *= 1.0 - aPulse * pulse * 0.08;
          float hang = max(0.0, -position.y);
          transformed.x += sin(uTime * 1.4 + oceanIndex + position.y * 2.2) * 0.12 * hang;
          transformed.z += cos(uTime * 1.1 + oceanIndex * 0.7 + position.y * 1.8) * 0.1 * hang;`,
      },
    );
    this.jellies = new THREE.InstancedMesh(buildJelly(), jellyMaterial, JELLY_COUNT);
    this.jellies.frustumCulled = false;
    this.jellies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(JELLY_COUNT * 3), 3);
    const jellyTints = ['#ff9ad8', '#b99aff', '#8fe9ff', '#ffc2e8'];
    for (let i = 0; i < JELLY_COUNT; i += 1) this.jellies.setColorAt(i, new THREE.Color(jellyTints[i % jellyTints.length]));
    this.jellies.renderOrder = 2;
    this.group.add(this.jellies);

    parent.add(this.group);
  }

  setDensity(density: number) {
    this.density = density;
  }

  /** Snaps everything to the bird's neighbourhood (the moment it dives). */
  seed(bird: THREE.Vector3, forward: THREE.Vector3) {
    for (const school of this.schools) {
      this.placeSchoolAnchor(school, bird, forward, true);
      school.target.copy(school.anchor);
      for (let i = 0; i < school.count; i += 1) {
        const k = (school.start + i) * 3;
        this.fishPos[k] = school.anchor.x + (Math.random() - 0.5) * 4;
        this.fishPos[k + 1] = school.anchor.y + (Math.random() - 0.5) * 1.5;
        this.fishPos[k + 2] = school.anchor.z + (Math.random() - 0.5) * 4;
        this.fishVel[k] = forward.x;
        this.fishVel[k + 1] = 0;
        this.fishVel[k + 2] = forward.z;
      }
    }
    for (const cruiser of this.cruisers) cruiser.place(bird, forward, this.field);
    for (let i = 0; i < JELLY_COUNT; i += 1) this.placeJelly(i, bird, forward, true);
    this.seeded = true;
  }

  private placeSchoolAnchor(school: School, bird: THREE.Vector3, forward: THREE.Vector3, snap: boolean) {
    const heading = Math.atan2(forward.x, forward.z);
    const a = heading + school.angle * 0.8;
    const x = bird.x + Math.sin(a) * school.distance;
    const z = bird.z + Math.cos(a) * school.distance;
    school.groundY = this.field.groundHeight(x, z);
    const y = Math.min(school.groundY + school.height, -SURFACE_CLEARANCE - 0.5);
    if (snap) school.anchor.set(x, y, z);
    return scratchPos.set(x, y, z);
  }

  private placeJelly(i: number, bird: THREE.Vector3, forward: THREE.Vector3, around: boolean) {
    const a = around ? Math.random() * Math.PI * 2 : Math.atan2(forward.x, forward.z) + (Math.random() - 0.5) * 1.6;
    const d = around ? 10 + Math.random() * 35 : 38 + Math.random() * 12;
    const x = bird.x + Math.sin(a) * d;
    const z = bird.z + Math.cos(a) * d;
    const ground = this.field.groundHeight(x, z);
    const top = -SURFACE_CLEARANCE - 1;
    const y = ground + 2 + Math.random() * Math.max(0.5, top - ground - 2);
    this.jellyPos[i * 3] = x;
    this.jellyPos[i * 3 + 1] = Math.min(y, top);
    this.jellyPos[i * 3 + 2] = z;
    this.jellyPhase[i] = Math.random() * 10;
  }

  update(dt: number, bird: THREE.Vector3, forward: THREE.Vector3) {
    if (!this.seeded) this.seed(bird, forward);
    this.updateFish(dt, bird, forward);
    for (const cruiser of this.cruisers) cruiser.update(dt, bird, this.field);
    this.updateJellies(dt, bird, forward);
  }

  private updateFish(dt: number, bird: THREE.Vector3, forward: THREE.Vector3) {
    const pos = this.fishPos;
    const vel = this.fishVel;
    const follow = damp(SCHOOL_FOLLOW_RATE, dt);
    for (const school of this.schools) {
      const desired = this.placeSchoolAnchor(school, bird, forward, false);
      if (school.anchor.distanceToSquared(bird) > SCHOOL_RELOCATE_DISTANCE * SCHOOL_RELOCATE_DISTANCE) {
        // Left far behind: re-form ahead, out in the fog, rather than chasing across the map.
        school.anchor.copy(desired);
        for (let i = 0; i < school.count; i += 1) {
          const k = (school.start + i) * 3;
          pos[k] = desired.x + (Math.random() - 0.5) * 4;
          pos[k + 1] = desired.y + (Math.random() - 0.5) * 1.5;
          pos[k + 2] = desired.z + (Math.random() - 0.5) * 4;
        }
      } else {
        school.anchor.lerp(desired, follow);
      }
      school.wander += dt;
      const spread = FISH_SPECIES[school.species].spread;
      school.target.set(
        school.anchor.x + Math.sin(school.wander * 0.37) * spread * 1.5,
        school.anchor.y + Math.sin(school.wander * 0.53) * 0.6,
        school.anchor.z + Math.cos(school.wander * 0.29) * spread * 1.5,
      );
    }

    for (let si = 0; si < this.schools.length; si += 1) {
      const school = this.schools[si];
      const def = FISH_SPECIES[school.species];
      const active = Math.max(1, Math.round(school.count * this.density));
      const { mesh, meshStart: meshOffset } = school;
      // Average velocity (alignment).
      let avx = 0;
      let avy = 0;
      let avz = 0;
      for (let i = 0; i < active; i += 1) {
        const k = (school.start + i) * 3;
        avx += vel[k];
        avy += vel[k + 1];
        avz += vel[k + 2];
      }
      avx /= active;
      avy /= active;
      avz /= active;
      const sep = def.spread * 0.35;
      for (let i = 0; i < active; i += 1) {
        const f = school.start + i;
        const k = f * 3;
        const px = pos[k];
        const py = pos[k + 1];
        const pz = pos[k + 2];
        // Cohesion: toward a per-fish slot around the school target.
        const slot = f * 2.399;
        let ax = (school.target.x + Math.cos(slot) * def.spread * 0.6 - px) * 0.9;
        let ay = (school.target.y + Math.sin(slot * 1.7) * def.spread * 0.2 - py) * 0.9;
        let az = (school.target.z + Math.sin(slot) * def.spread * 0.6 - pz) * 0.9;
        // Alignment.
        ax += (avx - vel[k]) * 0.8;
        ay += (avy - vel[k + 1]) * 0.8;
        az += (avz - vel[k + 2]) * 0.8;
        // Separation.
        for (let j = 0; j < active; j += 1) {
          if (j === i) continue;
          const q = (school.start + j) * 3;
          const dx = px - pos[q];
          const dy = py - pos[q + 1];
          const dz = pz - pos[q + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < sep * sep && d2 > 1e-6) {
            const push = (sep * sep - d2) / d2;
            ax += dx * push * 0.5;
            ay += dy * push * 0.5;
            az += dz * push * 0.5;
          }
        }
        // Keep clear of the bird.
        const bx = px - bird.x;
        const by = py - bird.y;
        const bz = pz - bird.z;
        const bd = Math.sqrt(bx * bx + by * by + bz * bz);
        if (bd < FISH_AVOID_RADIUS && bd > 1e-3) {
          const flee = ((FISH_AVOID_RADIUS - bd) / bd) * 9;
          ax += bx * flee;
          ay += by * flee;
          az += bz * flee;
        }
        // Stay between the seabed and the surface.
        if (py < school.groundY + 0.7) ay += (school.groundY + 0.7 - py) * 8;
        if (py > -SURFACE_CLEARANCE) ay -= (py + SURFACE_CLEARANCE) * 8;

        let vx = vel[k] + ax * dt;
        let vy = vel[k + 1] + ay * dt;
        let vz = vel[k + 2] + az * dt;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        const clamped = Math.min(def.maxSpeed, Math.max(def.minSpeed, speed));
        vx = (vx / speed) * clamped;
        vy = (vy / speed) * clamped * 0.6;
        vz = (vz / speed) * clamped;
        vel[k] = vx;
        vel[k + 1] = vy;
        vel[k + 2] = vz;
        pos[k] = px + vx * dt;
        pos[k + 1] = py + vy * dt;
        pos[k + 2] = pz + vz * dt;

        scratchDir.set(vx, vy, vz).normalize();
        orient(scratchQuat, scratchDir);
        scratchPos.set(pos[k], pos[k + 1], pos[k + 2]);
        scratchScale.setScalar(this.fishScale[f]);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        mesh.setMatrixAt(meshOffset + i, scratchMatrix);
      }
      // Fish beyond this quality's density are parked out of sight (scale 0).
      scratchMatrix.makeScale(0, 0, 0);
      for (let i = active; i < school.count; i += 1) mesh.setMatrixAt(meshOffset + i, scratchMatrix);
    }
    for (const mesh of this.fishMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  private updateJellies(dt: number, bird: THREE.Vector3, forward: THREE.Vector3) {
    for (let i = 0; i < JELLY_COUNT; i += 1) {
      const k = i * 3;
      this.jellyPhase[i] += dt;
      // Jellies rise on each bell pulse and sink slowly between them.
      const pulse = Math.max(0, Math.sin(this.jellyPhase[i] * 2.1 + i * 1.3));
      this.jellyPos[k + 1] += (pulse * 0.5 - 0.12) * dt;
      this.jellyPos[k] += Math.sin(this.jellyPhase[i] * 0.2 + i) * 0.15 * dt;
      const dx = this.jellyPos[k] - bird.x;
      const dy = this.jellyPos[k + 1] - bird.y;
      const dz = this.jellyPos[k + 2] - bird.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 16 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = ((4 - d) / d) * 2 * dt;
        this.jellyPos[k] += dx * push;
        this.jellyPos[k + 1] += dy * push;
        this.jellyPos[k + 2] += dz * push;
      }
      if (this.jellyPos[k + 1] > -SURFACE_CLEARANCE - 0.8) this.jellyPos[k + 1] = -SURFACE_CLEARANCE - 0.8;
      if (dx * dx + dz * dz > JELLY_RECYCLE_DISTANCE * JELLY_RECYCLE_DISTANCE) this.placeJelly(i, bird, forward, false);
      scratchPos.set(this.jellyPos[k], this.jellyPos[k + 1], this.jellyPos[k + 2]);
      scratchQuat.identity();
      scratchScale.setScalar(0.9 + (i % 3) * 0.25);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      this.jellies.setMatrixAt(i, scratchMatrix);
    }
    this.jellies.instanceMatrix.needsUpdate = true;
  }

  /** Reset on each dive so everything re-forms around the bird. */
  resetSeed() {
    this.seeded = false;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
    });
  }
}
