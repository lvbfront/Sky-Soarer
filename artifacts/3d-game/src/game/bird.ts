import * as THREE from 'three';

export type BirdType = 'pigeon' | 'falcon' | 'flamingo' | 'duck';

export const BIRD_OPTIONS: { id: BirdType; name: string; tagline: string }[] = [
  { id: 'pigeon', name: 'Pigeon', tagline: 'Light and agile — the friendly default.' },
  { id: 'falcon', name: 'Falcon', tagline: 'Sleek, dark, narrow-winged speedster.' },
  { id: 'flamingo', name: 'Greater Flamingo', tagline: 'Pink & white, long neck, unmistakable beak.' },
  { id: 'duck', name: 'Duck / Seabird', tagline: 'Built to dive — paddles and swims beneath the waves.' },
];

interface WingSpec {
  radius: number;
  length: number;
  spanScale: number;
  sweepAngle: number;
  position: [number, number, number];
  tipColor?: string;
}

/** Legs and feet: hips under the body, a straight leg, and a foot pointing forward. */
interface LegSpec {
  /** Hip position (x is the half-spacing between the legs). */
  hip: [number, number, number];
  length: number;
  radius: number;
  footLength: number;
  footWidth: number;
  color: string;
}

/**
 * The bird's procedural pose, on top of the flap cycle (all 0 is plain flight). The engine reuses one
 * object and writes every field each frame; nothing here allocates.
 */
export interface BirdPose {
  /** Air brake: wings spread, swept forward and cupped, flapping shallow. */
  brake: number;
  /** Landing flare: wings forward and strongly cupped, tail fanned down, legs swung forward. */
  flare: number;
  /** Wing fold: 0 open, 0.5 half folded, 1 tucked against the body (two stages). */
  fold: number;
  /** Legs: 0 tucked back under the tail (flight), 1 straight down (standing). */
  legs: number;
  /** Walking: radians each leg swings, alternating (the left leg gets +swing). */
  legSwing: number;
  /** Flap amplitude multiplier (strong takeoff strokes > 1). */
  flapAmplitude: number;
  headYaw: number;
  /** Head pushed forward (+) or back (−), in model units: a pigeon's walking bob. */
  headBob: number;
  /** 0..1 tail fanned out (also fanned by the flare). */
  tailFan: number;
  /** Tail flick: radians up (+) or down (−). */
  tailLift: number;
  /** Touchdown squash, 0..1. */
  squash: number;
  /** Crouch before a jump, 0..1. */
  crouch: number;
  /** Wing ruffle / shake, 0..1. */
  ruffle: number;
  /** Extra nose-up pitch of the body (radians), e.g. standing posture. */
  bodyPitch: number;
  /** Slow breathing amplitude, 0..1. */
  breathe: number;
}

export function createBirdPose(): BirdPose {
  return {
    brake: 0,
    flare: 0,
    fold: 0,
    legs: 0,
    legSwing: 0,
    flapAmplitude: 1,
    headYaw: 0,
    headBob: 0,
    tailFan: 0,
    tailLift: 0,
    squash: 0,
    crouch: 0,
    ruffle: 0,
    bodyPitch: 0,
    breathe: 0,
  };
}

const NEUTRAL_POSE = createBirdPose();
// Legs swing back this far to tuck under the tail in flight (radians).
const LEG_TUCK = 1.35;

const smooth01 = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * A small low-poly bird made from primitive geometry, with two wing pivots that flap on a sine wave,
 * plus head, tail and leg pivots for the procedural ground and landing poses (see BirdPose).
 * `flapSpeed` lets the caller speed up flapping during boosts. Geometry/coloring varies by
 * `BirdType` so the player's chosen bird reads distinctly.
 */
export class Bird {
  /** Positioned and rotated by the engine (heading, pitch, bank). */
  readonly group: THREE.Group;
  /** Every part hangs off this inner root, so squash, crouch and posture never fight the engine. */
  private root = new THREE.Group();
  private leftWing!: THREE.Group;
  private rightWing!: THREE.Group;
  private head = new THREE.Group();
  private headBaseZ = 0;
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private flapPhase = 0;
  private time = 0;
  // The pose used when a caller passes only a brake amount (the landing scene, plain flight).
  private flightPose = createBirdPose();
  /** Distance from the group's origin down to the soles of the feet, legs straight down. */
  readonly standHeight: number;

  constructor(type: BirdType = 'pigeon') {
    this.group = new THREE.Group();
    this.group.add(this.root);

    let legs: LegSpec;
    switch (type) {
      case 'falcon':
        legs = this.buildFalcon();
        break;
      case 'flamingo':
        legs = this.buildFlamingo();
        break;
      case 'duck':
        legs = this.buildDuck();
        break;
      case 'pigeon':
      default:
        legs = this.buildPigeon();
        break;
    }
    this.buildLegs(legs);
    this.standHeight = -(legs.hip[1] - legs.length) + 0.02;
    this.applyPose(NEUTRAL_POSE, 0.25);

    // Note: `group.rotation` (including yaw/heading) is driven every frame by GameEngine's
    // flight physics, not set here — every bird variant is modeled facing local +Z, which
    // GameEngine aligns directly with the direction of travel.

    // Let the bird cast a shadow onto the terrain/ocean below (from the sun light rig set
    // up in GameEngine) — it doesn't need to receive shadows on itself.
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
      }
    });
  }

  /** A head pivot at `position`: the head mesh, beak and eyes are added around it. */
  private placeHead(position: [number, number, number]) {
    this.head.position.set(...position);
    this.headBaseZ = position[2];
    this.root.add(this.head);
  }

  /** A tail pivot at its base, with the tail mesh trailing behind it. */
  private placeTail(mesh: THREE.Mesh, base: [number, number, number]) {
    this.tail.position.set(...base);
    mesh.position.x -= base[0];
    mesh.position.y -= base[1];
    mesh.position.z -= base[2];
    this.tail.add(mesh);
    this.root.add(this.tail);
  }

  private buildLegs(spec: LegSpec) {
    const material = new THREE.MeshStandardMaterial({ color: spec.color, flatShading: true, roughness: 0.7 });
    const legGeometry = new THREE.CylinderGeometry(spec.radius, spec.radius * 0.8, spec.length, 5);
    legGeometry.translate(0, -spec.length / 2, 0);
    const footGeometry = new THREE.BoxGeometry(spec.footWidth, 0.035, spec.footLength);
    footGeometry.translate(0, -spec.length, spec.footLength * 0.3);
    for (const side of [-1, 1] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(side * spec.hip[0], spec.hip[1], spec.hip[2]);
      pivot.add(new THREE.Mesh(legGeometry, material));
      pivot.add(new THREE.Mesh(footGeometry, material));
      this.root.add(pivot);
      this.legs.push(pivot);
    }
  }

  private buildPigeon() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f7ecd6', flatShading: true, roughness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({ color: '#e98a5b', flatShading: true, roughness: 0.75 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#3d2c22', flatShading: true, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.7, 6), bodyMat);
    body.rotation.x = Math.PI / 2;
    this.root.add(body);

    this.placeHead([0, 0.14, 0.82]);
    this.head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), bodyMat));

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.36, 4), accentMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.06, 0.36);
    this.head.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 4), accentMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.02, -1.0);
    this.placeTail(tail, [0, 0.02, -0.6]);

    this.addEyes(darkMat, 0.1, 0.16);

    this.attachWings(bodyMat, {
      radius: 0.16,
      length: 1.5,
      spanScale: 2.4,
      sweepAngle: 0.15,
      position: [0.12, 0.06, -0.05],
    });
    return { hip: [0.14, -0.28, 0.08], length: 0.44, radius: 0.035, footLength: 0.24, footWidth: 0.1, color: '#d9706a' } as LegSpec;
  }

  private buildFalcon() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', flatShading: true, roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: '#e0a83f', flatShading: true, roughness: 0.55 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1c1c1c', flatShading: true, roughness: 0.5 });

    // Longer, narrower body for a streamlined silhouette.
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.95, 6), bodyMat);
    body.rotation.x = Math.PI / 2;
    this.root.add(body);

    this.placeHead([0, 0.12, 0.92]);
    this.head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), bodyMat));

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), accentMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.07, 0.32);
    this.head.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.05, 4), darkMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.0, -1.15);
    this.placeTail(tail, [0, 0, -0.65]);

    this.addEyes(darkMat, 0.08, 0.14);

    this.attachWings(darkMat, {
      radius: 0.1,
      length: 1.85,
      spanScale: 3.1,
      sweepAngle: 0.4,
      position: [0.1, 0.04, -0.2],
    });
    return { hip: [0.12, -0.22, 0.12], length: 0.42, radius: 0.035, footLength: 0.22, footWidth: 0.11, color: '#e0a83f' } as LegSpec;
  }

  private buildFlamingo() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f6b9d3', flatShading: true, roughness: 0.8 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#fdf3f7', flatShading: true, roughness: 0.8 });
    const beakMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', flatShading: true, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#3d2c22', flatShading: true, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.44, 8, 6), bodyMat);
    body.scale.set(1, 0.85, 1.35);
    this.root.add(body);

    // Long S-curved neck built from two angled segments rising up and forward from the body.
    const lowerNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.85, 6), whiteMat);
    lowerNeck.position.set(0, 0.55, 0.55);
    lowerNeck.rotation.x = -Math.PI / 5;
    this.root.add(lowerNeck);

    const upperNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.75, 6), bodyMat);
    upperNeck.position.set(0, 1.08, 0.92);
    upperNeck.rotation.x = Math.PI / 9;
    this.root.add(upperNeck);

    this.placeHead([0, 1.42, 1.12]);
    this.head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), whiteMat));

    // Distinctive down-bent flamingo beak: a bent cone angled sharply downward off the head.
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 4), beakMat);
    beak.rotation.x = Math.PI / 2.1;
    beak.position.set(0, -0.1, 0.23);
    this.head.add(beak);

    this.addEyes(darkMat, 0.04, 0.08);

    // Long legs (flamingos are famous for them): tucked trailing behind in flight, stilts on the
    // ground (see the leg spec returned below).
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4), bodyMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.05, -0.7);
    this.placeTail(tail, [0, 0.05, -0.5]);

    this.attachWings(bodyMat, {
      radius: 0.15,
      length: 1.6,
      spanScale: 2.5,
      sweepAngle: 0.2,
      position: [0.14, 0.1, 0.05],
      tipColor: '#2b2b2b',
    });
    return { hip: [0.08, -0.2, -0.05], length: 1.05, radius: 0.03, footLength: 0.2, footWidth: 0.1, color: '#e07a8f' } as LegSpec;
  }

  private buildDuck() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#8a6b3d', flatShading: true, roughness: 0.85 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#3f6b4a', flatShading: true, roughness: 0.7 });
    const billMat = new THREE.MeshStandardMaterial({ color: '#e2932f', flatShading: true, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#2b2116', flatShading: true, roughness: 0.6 });

    // Plump, rounded body — reads as a duck's silhouette rather than a streamlined flier.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 8, 6), bodyMat);
    body.scale.set(1, 0.9, 1.35);
    this.root.add(body);

    this.placeHead([0, 0.32, 0.72]);
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), headMat));

    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.32), billMat);
    bill.position.set(0, -0.06, 0.3);
    this.head.add(bill);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), bodyMat);
    tail.rotation.x = -Math.PI / 2.4;
    tail.position.set(0, 0.18, -0.75);
    this.placeTail(tail, [0, 0.12, -0.55]);

    this.addEyes(darkMat, 0.08, 0.18);

    this.attachWings(bodyMat, {
      radius: 0.15,
      length: 1.3,
      spanScale: 2.1,
      sweepAngle: 0.1,
      position: [0.16, 0.14, -0.05],
    });
    // Short legs and broad webbed feet: a nod to its diving/paddling specialty.
    return { hip: [0.16, -0.3, -0.05], length: 0.24, radius: 0.04, footLength: 0.26, footWidth: 0.2, color: '#e2932f' } as LegSpec;
  }

  /** Eyes on the head pivot, at (±0.15, y, z) from the head's center. */
  private addEyes(material: THREE.Material, y: number, z: number) {
    const eyeGeometry = new THREE.SphereGeometry(0.045, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeometry, material);
    leftEye.position.set(-0.15, y, z);
    this.head.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeometry, material);
    rightEye.position.set(0.15, y, z);
    this.head.add(rightEye);
  }

  private attachWings(material: THREE.Material, spec: WingSpec) {
    this.leftWing = this.buildWing(material, -1, spec);
    this.leftWing.position.set(-spec.position[0], spec.position[1], spec.position[2]);
    this.leftWing.rotation.order = 'YZX';
    this.root.add(this.leftWing);

    this.rightWing = this.buildWing(material, 1, spec);
    this.rightWing.position.set(spec.position[0], spec.position[1], spec.position[2]);
    this.rightWing.rotation.order = 'YZX';
    this.root.add(this.rightWing);
  }

  private buildWing(material: THREE.Material, side: 1 | -1, spec: WingSpec) {
    const pivot = new THREE.Group();
    const wing = new THREE.Mesh(new THREE.ConeGeometry(spec.radius, spec.length, 4), material);
    wing.rotation.z = side * (Math.PI / 2 - spec.sweepAngle);
    wing.scale.set(1, 1, spec.spanScale);
    wing.position.set(side * spec.length * 0.47, 0, 0);
    pivot.add(wing);

    if (spec.tipColor) {
      const tipMat = new THREE.MeshStandardMaterial({ color: spec.tipColor, flatShading: true, roughness: 0.6 });
      const tip = new THREE.Mesh(new THREE.ConeGeometry(spec.radius * 0.8, spec.length * 0.35, 4), tipMat);
      tip.scale.set(1, 1, spec.spanScale);
      tip.rotation.copy(wing.rotation);
      tip.position.set(side * spec.length * 0.9, 0, 0);
      pivot.add(tip);
    }

    return pivot;
  }

  /**
   * Advance the flap animation. `flapSpeed` in cycles/sec-ish; higher = faster flapping.
   * `swimming` softens the wing motion into a gentle paddle stroke — used whenever the bird is
   * submerged underwater, regardless of which species is selected. `pose` adds the brake, landing
   * and ground poses (a number is the air brake alone, for callers that only fly).
   */
  update(dt: number, flapSpeed: number, swimming = false, pose: BirdPose | number = 0) {
    this.flapPhase += dt * flapSpeed;
    this.time += dt;
    let p: BirdPose;
    if (typeof pose === 'number') {
      p = this.flightPose;
      p.brake = pose;
    } else {
      p = pose;
    }
    const wave = Math.sin(this.flapPhase);
    const flap = swimming ? wave * 0.22 + 0.1 : wave * 0.65 * p.flapAmplitude + 0.25;
    this.applyPose(p, flap);
  }

  /** Puts every pivot in `pose`, with the wings at `flap` (their up/down angle before the pose). */
  private applyPose(p: BirdPose, flapIn: number) {
    // Wing fold, in two stages: half folded (swept back, edge-on), then tucked along the body.
    const stage1 = smooth01(0, 0.5, p.fold);
    const stage2 = smooth01(0.5, 1, p.fold);
    const openness = 1 - stage1;
    // Air brake: spread wide and steady, swept forward and cupped (leading edges up against the
    // airflow), only a shallow flutter left. The flare does the same, harder, wings raised.
    const brake = Math.max(p.brake, p.flare * 0.6);
    let flap = flapIn * (1 - 0.7 * brake) + 0.12 * brake - 0.25 * p.flare;
    flap = flap * openness + 0.12 * stage2;
    flap += Math.sin(this.time * 38) * 0.14 * p.ruffle;
    const sweepForward = (0.3 * p.brake + 0.55 * p.flare) * openness;
    const sweepBack = 0.75 * stage1 + 0.62 * stage2;
    const sweep = sweepForward - sweepBack;
    const twist = -(0.42 * p.brake + 0.8 * p.flare) * openness + 0.65 * stage1 + 0.9 * stage2 + Math.sin(this.time * 31) * 0.1 * p.ruffle;
    const span = 1 - 0.12 * stage1 - 0.2 * stage2;
    this.leftWing.rotation.set(twist, sweep, flap);
    this.rightWing.rotation.set(twist, -sweep, -flap);
    this.leftWing.scale.set(span, 1, 1);
    this.rightWing.scale.set(span, 1, 1);

    // Legs: tucked back in flight, straight down to stand, swung forward for the flare.
    const legBase = LEG_TUCK * (1 - p.legs) - 0.55 * p.flare * p.legs;
    const crouchBend = 0.3 * p.crouch;
    if (this.legs.length === 2) {
      this.legs[0].rotation.x = legBase + p.legSwing - crouchBend;
      this.legs[1].rotation.x = legBase - p.legSwing - crouchBend;
    }

    this.head.rotation.y = p.headYaw;
    this.head.position.z = this.headBaseZ + p.headBob;

    const fan = Math.max(p.tailFan, p.flare);
    this.tail.rotation.x = p.tailLift - 0.45 * p.flare;
    this.tail.scale.set(1 + 0.8 * fan, 1, 1);

    const breath = 1 + Math.sin(this.time * 2.2) * 0.018 * p.breathe;
    this.root.scale.set(1 + 0.07 * p.squash, (1 - 0.15 * p.squash) * breath, 1 + 0.07 * p.squash);
    this.root.position.y = -0.06 * p.crouch - 0.08 * p.squash;
    this.root.rotation.x = -p.bodyPitch;
  }
}
