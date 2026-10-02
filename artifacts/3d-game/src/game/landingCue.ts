import * as THREE from 'three';

// The touchdown cue: a thin reticle projected on the surface under a bird that's low over
// landable ground or water, in the HUD's instrument style (cyan once every landing condition holds,
// pale while something's missing, e.g. the brake). One small mesh, two materials, no per-frame
// allocation; it shrinks as the bird descends onto it.

const RING_RADIUS = 1.1;
const RING_WIDTH = 0.06;
const TICK_LENGTH = 0.35;
// Sits just above the surface so it never z-fights with the ground or the waves.
const LIFT = 0.06;
const READY_COLOR = new THREE.Color('#9ff3e4');
const IDLE_COLOR = new THREE.Color('#ffffff');

const UP = new THREE.Vector3(0, 1, 0);
const scratchNormal = new THREE.Vector3();

export class LandingCue {
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  constructor(private scene: THREE.Scene) {
    const ring = new THREE.RingGeometry(RING_RADIUS - RING_WIDTH, RING_RADIUS, 40);
    const parts: THREE.BufferGeometry[] = [ring];
    // Four ticks pointing in, like the HUD's frame brackets.
    for (let i = 0; i < 4; i += 1) {
      const tick = new THREE.PlaneGeometry(RING_WIDTH, TICK_LENGTH);
      tick.translate(0, RING_RADIUS - RING_WIDTH - TICK_LENGTH / 2, 0);
      tick.rotateZ((i * Math.PI) / 2);
      parts.push(tick);
    }
    const geometry = mergeFlat(parts);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: IDLE_COLOR,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** Shows the cue at (x, y, z) on a surface with the given normal; `ready` lights it up. */
  show(x: number, y: number, z: number, nx: number, ny: number, nz: number, agl: number, ready: boolean, time: number) {
    const mesh = this.mesh;
    mesh.visible = true;
    scratchNormal.set(nx, ny, nz);
    mesh.quaternion.setFromUnitVectors(UP, scratchNormal);
    mesh.position.set(x + nx * LIFT, y + ny * LIFT, z + nz * LIFT);
    // Wider while high, closing in on touchdown; a slow breathe while it's lit.
    const scale = 0.7 + Math.min(agl, 10) * 0.09 + (ready ? Math.sin(time * 6) * 0.04 : 0);
    mesh.scale.setScalar(scale);
    mesh.material.color.copy(ready ? READY_COLOR : IDLE_COLOR);
    mesh.material.opacity = ready ? 0.95 : 0.55;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Merges non-indexed copies of simple geometries (positions only). */
function mergeFlat(parts: THREE.BufferGeometry[]) {
  const arrays = parts.map((part) => {
    const flat = part.index ? part.toNonIndexed() : part;
    return flat.getAttribute('position').array as Float32Array;
  });
  const merged = new Float32Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let offset = 0;
  for (const array of arrays) {
    merged.set(array, offset);
    offset += array.length;
  }
  parts.forEach((part) => part.dispose());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  return geometry;
}
