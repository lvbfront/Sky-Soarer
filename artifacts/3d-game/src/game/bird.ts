import * as THREE from 'three';

export type BirdType = 'pigeon' | 'falcon' | 'flamingo';

export const BIRD_OPTIONS: { id: BirdType; name: string; tagline: string }[] = [
  { id: 'pigeon', name: 'Pigeon', tagline: 'Light and agile — the friendly default.' },
  { id: 'falcon', name: 'Falcon', tagline: 'Sleek, dark, narrow-winged speedster.' },
  { id: 'flamingo', name: 'Greater Flamingo', tagline: 'Pink & white, long neck, unmistakable beak.' },
];

interface WingSpec {
  radius: number;
  length: number;
  spanScale: number;
  sweepAngle: number;
  position: [number, number, number];
  tipColor?: string;
}

/**
 * A small low-poly bird made from primitive geometry, with two wing pivots that
 * flap on a sine wave. `flapSpeed` lets the caller speed up flapping during boosts.
 * Geometry/coloring varies by `BirdType` so the player's chosen bird reads distinctly.
 */
export class Bird {
  readonly group: THREE.Group;
  private leftWing: THREE.Group;
  private rightWing: THREE.Group;
  private flapPhase = 0;

  constructor(type: BirdType = 'pigeon') {
    this.group = new THREE.Group();

    switch (type) {
      case 'falcon': {
        const wings = this.buildFalcon();
        this.leftWing = wings.leftWing;
        this.rightWing = wings.rightWing;
        break;
      }
      case 'flamingo': {
        const wings = this.buildFlamingo();
        this.leftWing = wings.leftWing;
        this.rightWing = wings.rightWing;
        break;
      }
      case 'pigeon':
      default: {
        const wings = this.buildPigeon();
        this.leftWing = wings.leftWing;
        this.rightWing = wings.rightWing;
        break;
      }
    }

    // Note: `group.rotation` (including yaw/heading) is driven every frame by GameEngine's
    // flight physics, not set here — every bird variant is modeled facing local +Z, which
    // GameEngine aligns directly with the direction of travel.
  }

  private buildPigeon() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f7ecd6', flatShading: true, roughness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({ color: '#e98a5b', flatShading: true, roughness: 0.75 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#3d2c22', flatShading: true, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.7, 6), bodyMat);
    body.rotation.x = Math.PI / 2;
    this.group.add(body);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), bodyMat);
    head.position.set(0, 0.14, 0.82);
    this.group.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.36, 4), accentMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.08, 1.18);
    this.group.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 4), accentMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.02, -1.0);
    this.group.add(tail);

    this.addEyes(darkMat, 0.24, 0.98);

    return this.attachWings(bodyMat, {
      radius: 0.16,
      length: 1.5,
      spanScale: 2.4,
      sweepAngle: 0.15,
      position: [0.12, 0.06, -0.05],
    });
  }

  private buildFalcon() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', flatShading: true, roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: '#e0a83f', flatShading: true, roughness: 0.55 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1c1c1c', flatShading: true, roughness: 0.5 });

    // Longer, narrower body for a streamlined silhouette.
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.95, 6), bodyMat);
    body.rotation.x = Math.PI / 2;
    this.group.add(body);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), bodyMat);
    head.position.set(0, 0.12, 0.92);
    this.group.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 4), accentMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.05, 1.24);
    this.group.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.05, 4), darkMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.0, -1.15);
    this.group.add(tail);

    this.addEyes(darkMat, 0.2, 1.06);

    return this.attachWings(darkMat, {
      radius: 0.1,
      length: 1.85,
      spanScale: 3.1,
      sweepAngle: 0.4,
      position: [0.1, 0.04, -0.2],
    });
  }

  private buildFlamingo() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f6b9d3', flatShading: true, roughness: 0.8 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#fdf3f7', flatShading: true, roughness: 0.8 });
    const beakMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', flatShading: true, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#3d2c22', flatShading: true, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.44, 8, 6), bodyMat);
    body.scale.set(1, 0.85, 1.35);
    this.group.add(body);

    // Long S-curved neck built from two angled segments rising up and forward from the body.
    const lowerNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.85, 6), whiteMat);
    lowerNeck.position.set(0, 0.55, 0.55);
    lowerNeck.rotation.x = -Math.PI / 5;
    this.group.add(lowerNeck);

    const upperNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.75, 6), bodyMat);
    upperNeck.position.set(0, 1.08, 0.92);
    upperNeck.rotation.x = Math.PI / 9;
    this.group.add(upperNeck);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), whiteMat);
    head.position.set(0, 1.42, 1.12);
    this.group.add(head);

    // Distinctive down-bent flamingo beak: a bent cone angled sharply downward off the head.
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 4), beakMat);
    beak.rotation.x = Math.PI / 2.1;
    beak.position.set(0, 1.32, 1.35);
    this.group.add(beak);

    this.addEyes(darkMat, 1.46, 1.2);

    // Tucked legs trailing behind for silhouette flavor (flamingos are famous for them).
    const legMat = new THREE.MeshStandardMaterial({ color: '#e07a8f', flatShading: true, roughness: 0.7 });
    for (const side of [-1, 1] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.9, 5), legMat);
      leg.position.set(side * 0.08, -0.15, -0.55);
      leg.rotation.x = Math.PI / 2.4;
      this.group.add(leg);
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4), bodyMat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.05, -0.7);
    this.group.add(tail);

    return this.attachWings(bodyMat, {
      radius: 0.15,
      length: 1.6,
      spanScale: 2.5,
      sweepAngle: 0.2,
      position: [0.14, 0.1, 0.05],
      tipColor: '#2b2b2b',
    });
  }

  private addEyes(material: THREE.Material, y: number, z: number) {
    const eyeGeometry = new THREE.SphereGeometry(0.045, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeometry, material);
    leftEye.position.set(-0.15, y, z);
    this.group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeometry, material);
    rightEye.position.set(0.15, y, z);
    this.group.add(rightEye);
  }

  private attachWings(material: THREE.Material, spec: WingSpec) {
    const leftWing = this.buildWing(material, -1, spec);
    leftWing.position.set(-spec.position[0], spec.position[1], spec.position[2]);
    this.group.add(leftWing);

    const rightWing = this.buildWing(material, 1, spec);
    rightWing.position.set(spec.position[0], spec.position[1], spec.position[2]);
    this.group.add(rightWing);

    return { leftWing, rightWing };
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

  /** Advance the flap animation. `flapSpeed` in cycles/sec-ish; higher = faster flapping. */
  update(dt: number, flapSpeed: number) {
    this.flapPhase += dt * flapSpeed;
    const flap = Math.sin(this.flapPhase) * 0.65 + 0.25;
    this.leftWing.rotation.z = flap;
    this.rightWing.rotation.z = -flap;
  }
}
