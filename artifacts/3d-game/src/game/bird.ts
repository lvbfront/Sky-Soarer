import * as THREE from 'three';

/**
 * A small low-poly bird made from primitive geometry, with two wing pivots that
 * flap on a sine wave. `flapSpeed` lets the caller speed up flapping during boosts.
 */
export class Bird {
  readonly group: THREE.Group;
  private leftWing: THREE.Group;
  private rightWing: THREE.Group;
  private flapPhase = 0;

  constructor() {
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: '#f7ecd6',
      flatShading: true,
      roughness: 0.85,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: '#e98a5b',
      flatShading: true,
      roughness: 0.75,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: '#3d2c22',
      flatShading: true,
      roughness: 0.6,
    });

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

    const eyeGeometry = new THREE.SphereGeometry(0.045, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeometry, darkMat);
    leftEye.position.set(-0.17, 0.24, 0.98);
    this.group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeometry, darkMat);
    rightEye.position.set(0.17, 0.24, 0.98);
    this.group.add(rightEye);

    this.leftWing = this.buildWing(bodyMat, -1);
    this.leftWing.position.set(-0.12, 0.06, -0.05);
    this.group.add(this.leftWing);

    this.rightWing = this.buildWing(bodyMat, 1);
    this.rightWing.position.set(0.12, 0.06, -0.05);
    this.group.add(this.rightWing);

    // Note: `group.rotation` (including yaw/heading) is driven every frame by GameEngine's
    // flight physics, not set here — the beak is modeled facing local +Z, which GameEngine
    // aligns directly with the direction of travel.
  }

  private buildWing(material: THREE.Material, side: 1 | -1) {
    const pivot = new THREE.Group();
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 4), material);
    wing.rotation.z = side * (Math.PI / 2 - 0.15);
    wing.scale.set(1, 1, 2.4);
    wing.position.set(side * 0.7, 0, 0);
    pivot.add(wing);
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
