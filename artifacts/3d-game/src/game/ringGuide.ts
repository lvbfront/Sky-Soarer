import * as THREE from 'three';
import { damp } from './damping';
import type { RingHighlight } from './presets';

// Floats just ahead of and above the bird, gently bobbing, and always orients to point at the
// next ring (see RingManager) — a lightweight compass rather than a literal in-world marker on
// the ring itself, so it reads clearly even when the target ring is far away or off-screen.
const ANCHOR_FORWARD_OFFSET = 2.4;
const ANCHOR_UP_OFFSET = 3.0;
// How quickly the arrow's position follows the bird (per second; 0.08 per frame at 60 FPS).
const ANCHOR_RATE = 5;
// How quickly the arrow turns toward its target (per second). Fast enough to track a ring while
// the bird banks, slow enough that a retarget (a ring collected or missed, or a sharp turn) reads
// as a smooth swing rather than a snap.
const TURN_RATE = 7;
const BOB_SPEED = 2.2;
const BOB_AMPLITUDE = 0.14;
const ARROW_LENGTH = 1.9;

const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchAnchor = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A small glowing arrow, in the next ring's highlight color, that hovers near the bird and
 * continuously points toward the next ring in Ring Challenge mode — only visible while a target
 * ring exists.
 */
export class RingGuideArrow {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private material: THREE.MeshStandardMaterial;
  private anchor = new THREE.Vector3();
  private hasAnchor = false;
  private bobPhase = Math.random() * Math.PI * 2;

  constructor(scene: THREE.Scene, highlight: RingHighlight) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.material = new THREE.MeshStandardMaterial({
      color: highlight.color,
      emissive: highlight.emissive,
      emissiveIntensity: 1.1,
      flatShading: true,
      roughness: 0.35,
      fog: false,
    });

    // Built pointing along local +Z: for anything but a camera or light, Object3D.lookAt turns the
    // object's local +Z axis toward its target, so the arrowhead ends up aimed at the ring.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, ARROW_LENGTH * 0.6, 8), this.material);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -ARROW_LENGTH * 0.18;
    this.group.add(shaft);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, ARROW_LENGTH * 0.5, 10), this.material);
    head.rotation.x = Math.PI / 2; // the cone's tip (+Y) now faces +Z
    head.position.z = ARROW_LENGTH * 0.35;
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

    this.bobPhase += dt * BOB_SPEED;
    const bob = Math.sin(this.bobPhase) * BOB_AMPLITUDE;

    const desiredAnchor = scratchAnchor.copy(birdPosition).addScaledVector(forward, ANCHOR_FORWARD_OFFSET);
    desiredAnchor.y += ANCHOR_UP_OFFSET + bob;

    // Same orientation Object3D.lookAt would produce (+Z toward the target), computed so the arrow
    // can turn toward it gradually.
    const snap = !this.hasAnchor;
    if (snap) {
      this.anchor.copy(desiredAnchor);
      this.hasAnchor = true;
    } else {
      this.anchor.lerp(desiredAnchor, damp(ANCHOR_RATE, dt));
    }
    this.group.position.copy(this.anchor);
    scratchMatrix.lookAt(targetPosition, this.anchor, UP);
    scratchQuaternion.setFromRotationMatrix(scratchMatrix);
    if (snap) this.group.quaternion.copy(scratchQuaternion);
    else this.group.quaternion.slerp(scratchQuaternion, damp(TURN_RATE, dt));
    this.group.visible = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.material.dispose();
  }
}
