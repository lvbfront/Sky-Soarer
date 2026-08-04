import * as THREE from 'three';

// Floats just ahead of and above the bird, gently bobbing, and always orients to point at
// whichever ring is currently the nearest target — a lightweight compass rather than a
// literal in-world marker on the ring itself, so it reads clearly even when the target ring
// is far away or off-screen.
const ANCHOR_FORWARD_OFFSET = 2.4;
const ANCHOR_UP_OFFSET = 3.0;
const ANCHOR_LERP = 0.08;
const BOB_SPEED = 2.2;
const BOB_AMPLITUDE = 0.14;
const ARROW_LENGTH = 1.5;

/**
 * A small glowing arrow that hovers near the bird and continuously points toward the next
 * active ring in Ring Challenge mode — only visible while a target ring exists.
 */
export class RingGuideArrow {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private anchor = new THREE.Vector3();
  private hasAnchor = false;
  private bobPhase = Math.random() * Math.PI * 2;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;

    const material = new THREE.MeshStandardMaterial({
      color: '#ffe066',
      emissive: '#ffb703',
      emissiveIntensity: 1.1,
      flatShading: true,
      roughness: 0.35,
      fog: false,
    });

    // Built pointing along local -Z, since Object3D.lookAt orients an object's local -Z axis
    // toward its target — this way the arrowhead itself ends up aimed at the ring, with no
    // extra 180-degree correction needed after `lookAt`.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, ARROW_LENGTH * 0.6, 8), material);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = ARROW_LENGTH * 0.18;
    this.group.add(shaft);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, ARROW_LENGTH * 0.5, 10), material);
    head.rotation.x = -Math.PI / 2;
    head.position.z = -ARROW_LENGTH * 0.35;
    this.group.add(head);

    scene.add(this.group);
  }

  /**
   * Advances the arrow's float/bob and orientation. Pass the world position of the currently
   * targeted ring, or null when there's no active ring (or Ring Challenge is off) to hide it.
   */
  update(dt: number, birdPosition: THREE.Vector3, forward: THREE.Vector3, targetPosition: THREE.Vector3 | null) {
    if (!targetPosition) {
      this.group.visible = false;
      this.hasAnchor = false;
      return;
    }

    this.group.visible = true;
    this.bobPhase += dt * BOB_SPEED;
    const bob = Math.sin(this.bobPhase) * BOB_AMPLITUDE;

    const desiredAnchor = birdPosition
      .clone()
      .addScaledVector(forward, ANCHOR_FORWARD_OFFSET)
      .add(new THREE.Vector3(0, ANCHOR_UP_OFFSET + bob, 0));

    if (!this.hasAnchor) {
      this.anchor.copy(desiredAnchor);
      this.hasAnchor = true;
    } else {
      this.anchor.lerp(desiredAnchor, ANCHOR_LERP);
    }

    this.group.position.copy(this.anchor);
    this.group.lookAt(targetPosition);
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
