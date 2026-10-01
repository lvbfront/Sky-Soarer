import * as THREE from 'three';
import { bake, mergeBaked, streamlinedBody, triangle } from './lowPoly';
import type { OceanManager } from './ocean';
import { patchOceanMaterial, type OceanUniforms } from './oceanShaders';

// Above-water life on the ocean map, cheap by construction: a pooled pod of dolphins that now and
// then leaps out of the sea some way ahead of the bird, and a handful of seabirds gliding in lazy
// circles in the distance. Each is one InstancedMesh (two draw calls), with the wing beat in the
// vertex shader; the CPU only moves each animal as a whole.

const DOLPHIN_COUNT = 3;
const POD_INTERVAL_MIN = 7;
const POD_INTERVAL_MAX = 15;
const JUMPS_PER_POD = 3;
const JUMP_SECONDS = 1.25;
const JUMP_GAP_SECONDS = 0.55;
const JUMP_TRAVEL = 11;
const JUMP_PEAK = 3.1;
const JUMP_START_DEPTH = 1.6;
// Pods only appear over deep open water, this far ahead of the bird.
const POD_DISTANCE_MIN = 45;
const POD_DISTANCE_MAX = 85;
const POD_MIN_DEPTH = 6;

const SEABIRD_COUNT = 8;
const SEABIRD_DISTANCE_MIN = 70;
const SEABIRD_DISTANCE_MAX = 160;
const SEABIRD_RECYCLE_DISTANCE = 230;

function buildDolphin() {
  const top = '#5d7c92';
  const belly = '#dbe6ec';
  const body = streamlinedBody(
    [
      [1.3, 0.02, 0.02, -0.03],
      [1.08, 0.07, 0.07, -0.03],
      [0.88, 0.17, 0.19, 0.02],
      [0.3, 0.3, 0.32, 0],
      [-0.4, 0.22, 0.24, 0.02],
      [-0.9, 0.09, 0.11, 0.05],
      [-1.15, 0.04, 0.05, 0.06],
    ],
    7,
  );
  return mergeBaked([
    bake(body, (_x, y) => (y > -0.06 ? top : belly)),
    bake(triangle([0, 0.28, 0.1], [0, 0.72, -0.32], [0, 0.24, -0.42]), top),
    bake(triangle([0, 0.05, -1.08], [0.6, 0.02, -1.45], [0, 0.05, -1.28]), top),
    bake(triangle([0, 0.05, -1.08], [0, 0.05, -1.28], [-0.6, 0.02, -1.45]), top),
    bake(triangle([0.25, -0.12, 0.45], [0.62, -0.32, 0.05], [0.26, -0.16, 0.12]), top),
    bake(triangle([-0.25, -0.12, 0.45], [-0.26, -0.16, 0.12], [-0.62, -0.32, 0.05]), top),
  ]);
}

function buildSeabird() {
  const white = '#f4f6f7';
  const grey = '#b9c2c8';
  const dark = '#3b4248';
  const body = streamlinedBody(
    [
      [0.45, 0.02, 0.02, 0],
      [0.3, 0.08, 0.08, 0],
      [0, 0.1, 0.1, 0],
      [-0.35, 0.05, 0.05, 0.01],
      [-0.5, 0.01, 0.01, 0.01],
    ],
    5,
  );
  const parts = [bake(body, white)];
  for (const s of [-1, 1]) {
    // Inner wing, then the outer wing with dark tips (a gull's gentle "M" shape).
    parts.push(bake(triangle([s * 0.06, 0.02, 0.15], [s * 0.7, 0.1, 0.05], [s * 0.06, 0.02, -0.12]), grey));
    parts.push(bake(triangle([s * 0.06, 0.02, -0.12], [s * 0.7, 0.1, 0.05], [s * 0.7, 0.1, -0.12]), grey));
    parts.push(bake(triangle([s * 0.7, 0.1, 0.05], [s * 1.35, 0.0, -0.18], [s * 0.7, 0.1, -0.12]), (x) => (Math.abs(x) > 1.1 ? dark : grey)));
  }
  parts.push(bake(triangle([0, 0.01, -0.45], [0.16, 0.01, -0.62], [-0.16, 0.01, -0.62]), white));
  return mergeBaked(parts);
}

interface Dolphin {
  /** Seconds until this dolphin's current jump starts (negative once it has). */
  delay: number;
  jump: number;
  start: THREE.Vector3;
  heading: THREE.Vector3;
  splashedOut: boolean;
  splashedIn: boolean;
}

interface Seabird {
  center: THREE.Vector3;
  radius: number;
  angle: number;
  speed: number;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const scratchVec = new THREE.Vector3();
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);

export class OceanLife {
  private dolphins: THREE.InstancedMesh;
  private seabirds: THREE.InstancedMesh;
  private pod: Dolphin[] = [];
  private podTimer = 4;
  private birds: Seabird[] = [];
  private visible = true;

  constructor(
    parent: THREE.Object3D,
    private ocean: OceanManager,
    uniforms: OceanUniforms,
    private onSplash: (position: THREE.Vector3) => void,
  ) {
    this.dolphins = new THREE.InstancedMesh(
      buildDolphin(),
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
      DOLPHIN_COUNT,
    );
    const gullMaterial = patchOceanMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
      uniforms,
      {
        key: 'seabird',
        vertex: /* glsl */ `
          // Glide most of the time, with bursts of wing beats.
          float beat = pow(0.5 + 0.5 * sin(uTime * 0.45 + oceanIndex * 2.3), 3.0);
          float reach = max(0.0, abs(position.x) - 0.08);
          transformed.y += sin(uTime * 7.0 + oceanIndex) * reach * 0.55 * beat;`,
      },
    );
    this.seabirds = new THREE.InstancedMesh(buildSeabird(), gullMaterial, SEABIRD_COUNT);
    for (const mesh of [this.dolphins, this.seabirds]) {
      mesh.frustumCulled = false;
      for (let i = 0; i < mesh.count; i += 1) mesh.setMatrixAt(i, ZERO_SCALE);
      parent.add(mesh);
    }
    for (let i = 0; i < DOLPHIN_COUNT; i += 1) {
      this.pod.push({ delay: Infinity, jump: JUMPS_PER_POD, start: new THREE.Vector3(), heading: new THREE.Vector3(), splashedOut: false, splashedIn: false });
    }
    for (let i = 0; i < SEABIRD_COUNT; i += 1) {
      this.birds.push({ center: new THREE.Vector3(Number.NaN, 0, 0), radius: 0, angle: Math.random() * Math.PI * 2, speed: 0 });
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.dolphins.visible = visible;
    this.seabirds.visible = visible;
  }

  private startPod(bird: THREE.Vector3, forward: THREE.Vector3) {
    const heading = Math.atan2(forward.x, forward.z);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const a = heading + (Math.random() - 0.5) * 1.4;
      const d = POD_DISTANCE_MIN + Math.random() * (POD_DISTANCE_MAX - POD_DISTANCE_MIN);
      const x = bird.x + Math.sin(a) * d;
      const z = bird.z + Math.cos(a) * d;
      if (this.ocean.groundHeightAt(x, z) > -POD_MIN_DEPTH || this.ocean.groundHeightAt(x + 25, z + 25) > -POD_MIN_DEPTH) continue;
      // Swim roughly across the bird's path, so the leaps are seen side-on.
      const swim = heading + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 0.8;
      this.pod.forEach((dolphin, i) => {
        dolphin.start.set(x + Math.cos(swim) * (i - 1) * 2.5, -JUMP_START_DEPTH, z - Math.sin(swim) * (i - 1) * 2.5);
        dolphin.heading.set(Math.sin(swim), 0, Math.cos(swim));
        dolphin.delay = i * 0.22 + Math.random() * 0.15;
        dolphin.jump = 0;
        dolphin.splashedIn = false;
        dolphin.splashedOut = false;
      });
      return;
    }
  }

  update(dt: number, bird: THREE.Vector3, forward: THREE.Vector3) {
    if (!this.visible) return;
    this.updateDolphins(dt, bird, forward);
    this.updateSeabirds(dt, bird, forward);
  }

  private updateDolphins(dt: number, bird: THREE.Vector3, forward: THREE.Vector3) {
    const idle = this.pod.every((d) => d.jump >= JUMPS_PER_POD);
    if (idle) {
      this.podTimer -= dt;
      if (this.podTimer <= 0 && bird.y < 60) {
        this.podTimer = POD_INTERVAL_MIN + Math.random() * (POD_INTERVAL_MAX - POD_INTERVAL_MIN);
        this.startPod(bird, forward);
      }
    }
    this.pod.forEach((dolphin, i) => {
      if (dolphin.jump >= JUMPS_PER_POD) {
        this.dolphins.setMatrixAt(i, ZERO_SCALE);
        return;
      }
      dolphin.delay -= dt;
      const t = -dolphin.delay;
      if (t < 0 || t > JUMP_SECONDS) {
        this.dolphins.setMatrixAt(i, ZERO_SCALE);
        if (t > JUMP_SECONDS) {
          // Next leap, a little further along, after a short swim underwater.
          dolphin.start.addScaledVector(dolphin.heading, JUMP_TRAVEL * 1.5);
          dolphin.jump += 1;
          dolphin.delay = JUMP_GAP_SECONDS;
          dolphin.splashedIn = false;
          dolphin.splashedOut = false;
        }
        return;
      }
      const s = t / JUMP_SECONDS;
      const y = -JUMP_START_DEPTH + 4 * (JUMP_PEAK + JUMP_START_DEPTH) * s * (1 - s);
      scratchPos.copy(dolphin.start).addScaledVector(dolphin.heading, JUMP_TRAVEL * s);
      scratchPos.y = y;
      if (!dolphin.splashedOut && y > 0) {
        dolphin.splashedOut = true;
        this.onSplash(scratchVec.set(scratchPos.x, 0, scratchPos.z));
      } else if (dolphin.splashedOut && !dolphin.splashedIn && s > 0.5 && y < 0) {
        dolphin.splashedIn = true;
        this.onSplash(scratchVec.set(scratchPos.x, 0, scratchPos.z));
      }
      const vy = (4 * (JUMP_PEAK + JUMP_START_DEPTH) * (1 - 2 * s)) / JUMP_SECONDS;
      const vh = JUMP_TRAVEL / JUMP_SECONDS;
      scratchEuler.set(-Math.atan2(vy, vh), Math.atan2(dolphin.heading.x, dolphin.heading.z), 0);
      scratchQuat.setFromEuler(scratchEuler);
      scratchScale.setScalar(1.25);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      this.dolphins.setMatrixAt(i, scratchMatrix);
    });
    this.dolphins.instanceMatrix.needsUpdate = true;
  }

  private placeSeabird(gull: Seabird, bird: THREE.Vector3, forward: THREE.Vector3, ahead: boolean) {
    const heading = Math.atan2(forward.x, forward.z);
    const a = ahead ? heading + (Math.random() - 0.5) * 2 : Math.random() * Math.PI * 2;
    const d = SEABIRD_DISTANCE_MIN + Math.random() * (SEABIRD_DISTANCE_MAX - SEABIRD_DISTANCE_MIN);
    gull.center.set(bird.x + Math.sin(a) * d, 14 + Math.random() * 30, bird.z + Math.cos(a) * d);
    gull.radius = 8 + Math.random() * 18;
    gull.speed = (7 + Math.random() * 3) / gull.radius;
  }

  private updateSeabirds(dt: number, bird: THREE.Vector3, forward: THREE.Vector3) {
    this.birds.forEach((gull, i) => {
      if (Number.isNaN(gull.center.x)) this.placeSeabird(gull, bird, forward, false);
      const dx = gull.center.x - bird.x;
      const dz = gull.center.z - bird.z;
      if (dx * dx + dz * dz > SEABIRD_RECYCLE_DISTANCE * SEABIRD_RECYCLE_DISTANCE) this.placeSeabird(gull, bird, forward, true);
      gull.angle += gull.speed * dt * (i % 2 === 0 ? 1 : -1);
      const dir = i % 2 === 0 ? 1 : -1;
      scratchPos.set(gull.center.x + Math.cos(gull.angle) * gull.radius, gull.center.y + Math.sin(gull.angle * 0.5) * 1.5, gull.center.z + Math.sin(gull.angle) * gull.radius);
      // Heading along the circle's tangent, banked into the turn.
      const yaw = Math.atan2(-Math.sin(gull.angle) * dir, Math.cos(gull.angle) * dir);
      scratchEuler.set(0, yaw, 0.35 * dir);
      scratchQuat.setFromEuler(scratchEuler);
      scratchScale.setScalar(1.6);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      this.seabirds.setMatrixAt(i, scratchMatrix);
    });
    this.seabirds.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.dolphins, this.seabirds]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
