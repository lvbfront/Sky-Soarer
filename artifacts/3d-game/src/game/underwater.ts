import * as THREE from 'three';
import type { OceanManager } from './ocean';
import type { QualityProfile } from './quality';
import { Reef } from './reef';
import { SeaLife } from './seaLife';
import { UnderwaterFx, type UnderwaterFxLook } from './underwaterFx';

// Everything that only exists below the surface: the reef on the seabed, the fish, turtle, manta,
// jellyfish and shark, light shafts, marine snow and bubbles. Built with the engine on the ocean
// map (so its shaders compile under the takeoff veil instead of on the first dive), hidden until
// the bird dives. The seabed itself and its caustics belong to OceanManager's ground tiles.

// Reef tiles are generated whenever the bird is at most this high over the sea, so they're ready
// before a dive; above it nothing is spent on them.
const REEF_PREFETCH_ALTITUDE = 30;
const REEF_WORK_BUDGET_MS = 1.2;
// Bubble burst on entry.
const DIVE_BUBBLES = 46;

export class UnderwaterEnvironment {
  private root = new THREE.Group();
  private reef: Reef;
  private life: SeaLife;
  private fx: UnderwaterFx;
  private active = false;
  private pendingSeed = false;

  constructor(
    scene: THREE.Scene,
    private ocean: OceanManager,
    profile: QualityProfile,
  ) {
    const u = ocean.uniforms;
    this.reef = new Reef(this.root, ocean.field, u);
    this.life = new SeaLife(this.root, ocean.field, u);
    this.fx = new UnderwaterFx(this.root, u.uTime, u.uGlow, u.uGlowColor);
    this.root.visible = false;
    scene.add(this.root);
    this.setQuality(profile);
  }

  setQuality(profile: QualityProfile) {
    this.reef.setQuality(profile.reefDensity, profile.reefRadius);
    this.life.setDensity(profile.fishDensity);
    this.fx.setQuality(profile.lightShafts, profile.marineSnow);
  }

  setLook(look: UnderwaterFxLook) {
    this.fx.setLook(look);
  }

  setSunLean(toSunX: number, toSunZ: number) {
    this.fx.setSunLean(toSunX, toSunZ);
  }

  /** Shows everything for one `renderer.compile` pass, so no shader compiles on the first dive. */
  setVisibleForCompile(visible: boolean) {
    this.root.visible = visible || this.active;
  }

  /** Toggles the whole underwater scene. */
  setActive(active: boolean, birdPosition?: THREE.Vector3) {
    if (active === this.active) return;
    this.active = active;
    this.root.visible = active;
    if (active) {
      this.pendingSeed = true;
      if (birdPosition) this.fx.burst(birdPosition, DIVE_BUBBLES);
    } else {
      this.fx.clearBubbles();
    }
  }

  isActive() {
    return this.active;
  }

  /**
   * Every frame on the ocean map: prepares the reef ahead of a dive (idle-time generation, only
   * while the ocean isn't streaming), then animates the scene when active.
   */
  update(dt: number, birdPosition: THREE.Vector3, forward: THREE.Vector3) {
    if (birdPosition.y < REEF_PREFETCH_ALTITUDE) {
      this.reef.prefetch(birdPosition);
      if (!this.ocean.hasPendingWork()) this.reef.work(performance.now() + REEF_WORK_BUDGET_MS);
    }
    if (!this.active) return;

    if (this.pendingSeed) {
      this.pendingSeed = false;
      this.life.resetSeed();
      // The bird's own reef tile must exist the moment it's underwater.
      this.reef.work(performance.now() + 6);
    }
    this.reef.refresh(birdPosition);
    this.life.update(dt, birdPosition, forward);
    this.fx.update(dt, birdPosition, this.ocean.waterHeightAt(birdPosition.x, birdPosition.z));
  }

  /** Number of reef items drawn right now (the perf harness reads it). */
  getReefCount() {
    return this.reef.getDrawnCount();
  }

  dispose() {
    this.root.removeFromParent();
    this.reef.dispose();
    this.life.dispose();
    this.fx.dispose();
  }
}
