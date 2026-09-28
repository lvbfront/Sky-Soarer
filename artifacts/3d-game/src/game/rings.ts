import * as THREE from 'three';
import type { RingHighlight } from './presets';

const SPAWN_INTERVAL = 2.1; // seconds between ring spawns after the first
const FIRST_RING_DISTANCE = 42; // close enough to be immediately visible at flight start
const CHAIN_DISTANCE_MIN = 55;
const CHAIN_DISTANCE_MAX = 80;

// Subsequent rings trace a gentle sine-wave curve ahead of the bird instead of jumping to
// fully random offsets, so the chain reads as a deliberate, flyable path rather than noise.
const CURVE_STEP = 0.85; // radians of curve phase advanced per ring
const CURVE_LATERAL_AMPLITUDE = 16;
const CURVE_VERTICAL_AMPLITUDE = 6;
const CURVE_VERTICAL_PHASE_SCALE = 0.6;
const MIN_ALTITUDE_ABOVE_GROUND = 8;

export const RING_RADIUS = 3.4;
const RING_TUBE = 0.32;
const MAX_ACTIVE_RINGS = 6;
const DESPAWN_BEHIND_DISTANCE = 40; // recycle once this far behind the bird along its forward axis
// Also recycle any ring this far from the bird in any direction. Rings spawn at most ~85 units
// away, so this only catches rings the bird has turned away from — which the axial check above
// never recycles, and which would otherwise fill MAX_ACTIVE_RINGS and stop spawning for good.
const DESPAWN_MAX_DISTANCE = 120;

// How precisely the bird has to thread the ring to count as "collected".
export const AXIAL_HIT_THRESHOLD = 2.2;

// A ring counts as "ahead" of the bird (a candidate for the next target) while its center is no
// more than this far behind the bird along the bird's horizontal heading. The small allowance keeps
// the ring being threaded (level with the bird, possibly off to one side) targeted until it's
// actually collected or missed, instead of dropping it a frame early.
const AHEAD_MARGIN = 3;

// Look of the ordinary (non-target) rings: the original gold, slightly dimmed so the target pops.
const RING_COLOR = '#ffe066';
const RING_EMISSIVE = '#ffb703';
const RING_EMISSIVE_INTENSITY = 0.55;
const RING_GLOW_COLOR = '#fff3bf';
const RING_GLOW_OPACITY = 0.2;
const RING_PULSE = 0.04;

// The next ring: its own color (per map + sky, see NEXT_RING_HIGHLIGHTS), a brighter emissive that
// breathes, a stronger scale pulse, and an additive halo around the hoop.
const NEXT_EMISSIVE_MIN = 1.0;
const NEXT_EMISSIVE_MAX = 1.7;
const NEXT_GLOW_OPACITY = 0.42;
const NEXT_PULSE = 0.07;
const HALO_OPACITY_MIN = 0.22;
const HALO_OPACITY_MAX = 0.55;
const HIGHLIGHT_PULSE_SPEED = 4.2; // radians per second

/** Where the bird is relative to a ring, in the ring's own frame. */
export interface RingFrame {
  /** Distance along the ring's normal: negative while the bird is short of the ring's plane,
   * positive once it's past it. */
  axial: number;
  /** Distance from the ring's axis. */
  radial: number;
}

const scratchDelta = new THREE.Vector3();
const scratchHeading = new THREE.Vector3();

/** Measures the bird's position in a ring's frame (see RingFrame). */
export function ringFrame(ringPosition: THREE.Vector3, ringNormal: THREE.Vector3, birdPosition: THREE.Vector3): RingFrame {
  // `delta` points from the ring to the bird.
  const delta = scratchDelta.subVectors(birdPosition, ringPosition);
  const axial = delta.dot(ringNormal);
  const radial = Math.sqrt(Math.max(0, delta.lengthSq() - axial * axial));
  return { axial, radial };
}

/** True when the bird is threading the ring: within the hoop's slab and inside its radius. */
export function isRingHit(frame: RingFrame) {
  return Math.abs(frame.axial) < AXIAL_HIT_THRESHOLD && frame.radial < RING_RADIUS;
}

/** True once the bird has crossed the ring's plane without threading it. */
export function isRingPassed(frame: RingFrame) {
  return frame.axial > AXIAL_HIT_THRESHOLD;
}

export interface RingCandidate {
  position: THREE.Vector3;
  /** Set once the bird crossed the ring's plane outside the hoop: never targeted again. */
  missed: boolean;
}

/**
 * Picks the next ring to fly through: the earliest-spawned ring (`rings` is in spawn order) that
 * hasn't been missed and is still ahead of the bird along its horizontal heading. Rings the bird
 * has turned away from are skipped, so after a sharp turn the target moves on to the next ring
 * that's actually in front. Returns its index, or -1 when no ring is ahead.
 */
export function selectNextRing(rings: readonly RingCandidate[], birdPosition: THREE.Vector3, forward: THREE.Vector3) {
  const heading = scratchHeading.set(forward.x, 0, forward.z);
  if (heading.lengthSq() < 1e-6) heading.copy(forward);
  heading.normalize();
  for (let i = 0; i < rings.length; i += 1) {
    const ring = rings[i];
    if (ring.missed) continue;
    const along =
      (ring.position.x - birdPosition.x) * heading.x +
      (ring.position.y - birdPosition.y) * heading.y +
      (ring.position.z - birdPosition.z) * heading.z;
    if (along > -AHEAD_MARGIN) return i;
  }
  return -1;
}

interface ActiveRing extends RingCandidate {
  mesh: THREE.Group;
  torus: THREE.Mesh;
  glow: THREE.Mesh;
  normal: THREE.Vector3;
  spinPhase: number;
}

/**
 * Spawns glowing low-poly rings ahead of the bird's flight path, detects when the bird
 * flies through one, and recycles rings once they're collected or left behind. Used only
 * when "Ring Challenge" mode is enabled from the start menu.
 *
 * One ring at a time is the "next" ring (see `selectNextRing`): it's drawn in the map + sky's
 * highlight color with a pulsing halo, the guide arrow points at it, and the HUD shows how far
 * away it is. The other rings stay gold, slightly dimmed.
 */
export class RingManager {
  private scene: THREE.Scene;
  // In spawn order (spawns push, removals splice), which `selectNextRing` relies on.
  private active: ActiveRing[] = [];
  private pool: { mesh: THREE.Group; torus: THREE.Mesh; glow: THREE.Mesh }[] = [];
  // Zero so the very first ring spawns on the first update() call, directly ahead of the
  // bird's starting position — visible the instant flight begins.
  private spawnTimer = 0;
  private ringsSpawned = 0;
  private curvePhase = 0;
  private highlightPhase = 0;
  private next: ActiveRing | null = null;
  private torusGeometry = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 16);
  private glowGeometry = new THREE.CircleGeometry(RING_RADIUS * 0.92, 20);
  private ringMaterial: THREE.MeshStandardMaterial;
  private glowMaterial: THREE.MeshBasicMaterial;
  private nextRingMaterial: THREE.MeshStandardMaterial;
  private nextGlowMaterial: THREE.MeshBasicMaterial;
  private halo: THREE.Mesh;
  private haloMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, highlight: RingHighlight) {
    this.scene = scene;
    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: RING_COLOR,
      emissive: RING_EMISSIVE,
      emissiveIntensity: RING_EMISSIVE_INTENSITY,
      flatShading: true,
      roughness: 0.4,
    });
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: RING_GLOW_COLOR,
      transparent: true,
      opacity: RING_GLOW_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.nextRingMaterial = new THREE.MeshStandardMaterial({
      color: highlight.color,
      emissive: highlight.emissive,
      emissiveIntensity: NEXT_EMISSIVE_MIN,
      flatShading: true,
      roughness: 0.35,
    });
    this.nextGlowMaterial = new THREE.MeshBasicMaterial({
      color: highlight.glow,
      transparent: true,
      opacity: NEXT_GLOW_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // A soft additive band just outside the hoop, so the target reads as glowing even far away.
    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: highlight.color,
      transparent: true,
      opacity: HALO_OPACITY_MIN,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS * 1.08, RING_TUBE * 2.4, 8, 24), this.haloMaterial);
    this.halo.visible = false;
  }

  private buildRingMesh() {
    const mesh = new THREE.Group();
    const torus = new THREE.Mesh(this.torusGeometry, this.ringMaterial);
    mesh.add(torus);
    // A soft translucent disc through the hoop makes the "threading" plane readable at a glance.
    const glow = new THREE.Mesh(this.glowGeometry, this.glowMaterial);
    mesh.add(glow);
    return { mesh, torus, glow };
  }

  private spawnRing(birdPosition: THREE.Vector3, forward: THREE.Vector3, heightAtWorld: (x: number, z: number) => number) {
    const isFirst = this.ringsSpawned === 0;
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let distance: number;
    let lateral: number;
    let vertical: number;

    if (isFirst) {
      // Spawn directly on the player's starting trajectory — no lateral/vertical offset —
      // so the first ring is immediately visible dead ahead as soon as flight begins.
      distance = FIRST_RING_DISTANCE;
      lateral = 0;
      vertical = 0;
    } else {
      distance = CHAIN_DISTANCE_MIN + Math.random() * (CHAIN_DISTANCE_MAX - CHAIN_DISTANCE_MIN);
      this.curvePhase += CURVE_STEP;
      lateral = Math.sin(this.curvePhase) * CURVE_LATERAL_AMPLITUDE;
      vertical = Math.sin(this.curvePhase * CURVE_VERTICAL_PHASE_SCALE + 1.2) * CURVE_VERTICAL_AMPLITUDE;
    }

    const position = birdPosition
      .clone()
      .addScaledVector(forward, distance)
      .addScaledVector(right, lateral)
      .add(new THREE.Vector3(0, vertical, 0));

    const ground = heightAtWorld(position.x, position.z);
    const minY = ground + MIN_ALTITUDE_ABOVE_GROUND;
    if (position.y < minY) position.y = minY;

    let parts = this.pool.pop();
    if (parts) {
      parts.mesh.visible = true;
    } else {
      parts = this.buildRingMesh();
      this.scene.add(parts.mesh);
    }
    parts.mesh.position.copy(position);
    parts.mesh.lookAt(position.clone().add(forward));

    this.active.push({
      ...parts,
      position,
      normal: forward.clone(),
      missed: false,
      spinPhase: Math.random() * Math.PI * 2,
    });

    this.ringsSpawned += 1;
  }

  private remove(index: number) {
    const [ring] = this.active.splice(index, 1);
    if (ring === this.next) this.next = null;
    ring.mesh.visible = false;
    ring.torus.material = this.ringMaterial;
    ring.glow.material = this.glowMaterial;
    this.pool.push({ mesh: ring.mesh, torus: ring.torus, glow: ring.glow });
  }

  /**
   * Advance ring animation/spawning and check for a collection this frame.
   * Returns the collected ring's world position exactly once, the frame the bird threads
   * a ring — the caller can use it to trigger a burst effect at that spot — or `null`.
   */
  update(
    dt: number,
    birdPosition: THREE.Vector3,
    forward: THREE.Vector3,
    heightAtWorld: (x: number, z: number) => number,
  ): THREE.Vector3 | null {
    this.spawnTimer -= dt;
    // No ring ahead (the bird turned away from all of them, or threaded the last one): spawn one
    // now rather than leaving the guide with nothing to point at, making room by recycling the
    // oldest ring if the pool is full (none of them is ahead, so none is a target).
    const noTarget = this.next === null;
    if (noTarget && this.active.length >= MAX_ACTIVE_RINGS) this.remove(0);
    if ((this.spawnTimer <= 0 || noTarget) && this.active.length < MAX_ACTIVE_RINGS) {
      this.spawnRing(birdPosition, forward, heightAtWorld);
      this.spawnTimer = SPAWN_INTERVAL;
    }

    let collectedPosition: THREE.Vector3 | null = null;

    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const ring = this.active[i];
      ring.spinPhase += dt * 0.6;
      ring.mesh.rotation.z = ring.spinPhase * 0.15;

      const frame = ringFrame(ring.position, ring.normal, birdPosition);
      if (isRingHit(frame)) {
        collectedPosition = ring.position.clone();
        this.remove(i);
        continue;
      }
      // Crossed the ring's plane outside the hoop: missed. It stays visible until it despawns,
      // but is never the target again.
      if (isRingPassed(frame)) ring.missed = true;

      // Recycle rings the bird has flown well past, or turned away from, without collecting.
      // `axial` is positive once the bird is past the ring (see RingFrame).
      const distanceSq = frame.axial * frame.axial + frame.radial * frame.radial;
      if (frame.axial > DESPAWN_BEHIND_DISTANCE || distanceSq > DESPAWN_MAX_DISTANCE * DESPAWN_MAX_DISTANCE) {
        this.remove(i);
      }
    }

    const nextIndex = selectNextRing(this.active, birdPosition, forward);
    this.setNext(nextIndex >= 0 ? this.active[nextIndex] : null);

    // Pulses: every ring breathes gently; the target breathes harder and glows.
    this.highlightPhase += dt * HIGHLIGHT_PULSE_SPEED;
    const wave = 0.5 + 0.5 * Math.sin(this.highlightPhase);
    for (const ring of this.active) {
      const amount = ring === this.next ? NEXT_PULSE * (wave * 2 - 1) : Math.sin(ring.spinPhase * 2.2) * RING_PULSE;
      ring.mesh.scale.setScalar(1 + amount);
    }
    this.nextRingMaterial.emissiveIntensity = THREE.MathUtils.lerp(NEXT_EMISSIVE_MIN, NEXT_EMISSIVE_MAX, wave);
    this.haloMaterial.opacity = THREE.MathUtils.lerp(HALO_OPACITY_MIN, HALO_OPACITY_MAX, wave);

    return collectedPosition;
  }

  /** Moves the highlight (materials + halo) onto `ring`. */
  private setNext(ring: ActiveRing | null) {
    if (ring === this.next) return;
    if (this.next) {
      this.next.torus.material = this.ringMaterial;
      this.next.glow.material = this.glowMaterial;
    }
    this.next = ring;
    if (ring) {
      ring.torus.material = this.nextRingMaterial;
      ring.glow.material = this.nextGlowMaterial;
      ring.mesh.add(this.halo); // re-parents it from the previous target
      this.halo.visible = true;
    } else {
      this.halo.removeFromParent();
      this.halo.visible = false;
    }
  }

  /**
   * World position of the next ring (see `selectNextRing`), for the guide arrow and the HUD's
   * distance readout — or null when no ring is ahead. The returned vector is the ring's own; don't
   * modify it.
   */
  getNextRingPosition(): THREE.Vector3 | null {
    return this.next?.position ?? null;
  }

  dispose() {
    this.halo.removeFromParent();
    for (const ring of this.active) this.scene.remove(ring.mesh);
    for (const { mesh } of this.pool) this.scene.remove(mesh);
    this.active = [];
    this.pool = [];
    this.next = null;
    this.torusGeometry.dispose();
    this.glowGeometry.dispose();
    this.halo.geometry.dispose();
    for (const material of [
      this.ringMaterial,
      this.glowMaterial,
      this.nextRingMaterial,
      this.nextGlowMaterial,
      this.haloMaterial,
    ]) {
      material.dispose();
    }
  }
}
