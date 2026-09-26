import * as THREE from 'three';
import { Bird, type BirdType } from './bird';
import { TerrainManager } from './terrain';
import { OceanManager } from './ocean';
import { RingManager } from './rings';
import { SplashEffect } from './splash';
import { CloudManager } from './clouds';
import { RingBurstEffect } from './ringBurst';
import { UnderwaterEnvironment } from './underwater';
import { WaterBurstEffect } from './waterBurst';
import { RingGuideArrow } from './ringGuide';
import { WindAudio, SoundEffects } from './audio';
import type { HandControlState } from './handControls';

import { WEATHER_LOOKS, type MapType, type WeatherLook, type WeatherPreset } from './presets';
import { createSkyClouds, createSkyDome, createStarfield } from './sky';

export { MAP_OPTIONS, WEATHER_OPTIONS, type MapType, type WeatherPreset } from './presets';

// Underwater look — a fixed cyan/blue palette independent of the surface weather preset,
// since sunlight/moonlight above doesn't meaningfully change how it looks a few meters down.
// Brighter and less foggy than a "deep ocean" look, since the reef now sits in a shallow band
// just below the surface and should read as vibrant, not murky.
const UNDERWATER_BACKGROUND = '#0f7a9c';
// Lighter fog + brighter hemi/ambient than the original pass — the reef sits close to the
// surface and needs to stay visible out to its full spawn distance instead of fogging out
// to near-black well before items are close enough to read clearly.
const UNDERWATER_FOG_DENSITY = 0.022;
const UNDERWATER_HEMI_SKY = '#4fc0dd';
const UNDERWATER_HEMI_GROUND = '#063049';
const UNDERWATER_HEMI_INTENSITY = 0.9;
const UNDERWATER_AMBIENT_COLOR = '#a0ecff';
const UNDERWATER_AMBIENT_INTENSITY = 0.7;

export interface GameEngineOptions {
  birdType: BirdType;
  mapType: MapType;
  weather: WeatherPreset;
  ringChallenge: boolean;
  onScoreChange?: (score: number) => void;
  onBarrelRoll?: () => void;
  onBackflip?: () => void;
  onWaterTransition?: (state: 'submerged' | 'surfaced') => void;
}

const BASE_SPEED = 9;
const BOOST_SPEED = 20;
const SPEED_LERP = 0.04;
const RING_SPEED_PULSE = 7;
const SPEED_PULSE_DECAY_PER_SEC = 9;

// Underwater flight is slower and floatier than airborne flight — momentum builds and
// bleeds off more gradually, matching the "more drag, floatier" swimming feel from spec.
const UNDERWATER_BASE_SPEED = 5;
const UNDERWATER_BOOST_SPEED = 10;
const UNDERWATER_SPEED_LERP = 0.02;
// Steering input is damped underwater so both the visual roll and the actual turn rate
// soften together — swimming banks gentler than flying.
const UNDERWATER_STEERING_DAMPING = 0.5;

const BASE_FOV = 58;
const BOOST_FOV = 72;
const UNDERWATER_BASE_FOV = 50;
const UNDERWATER_BOOST_FOV = 60;
const FOV_LERP = 0.06;

const CAMERA_LERP = 0.05;
const UNDERWATER_CAMERA_LERP = 0.03;
const CAMERA_BACK_DISTANCE = 6.5;
const CAMERA_HEIGHT = 2.2;
const LOOK_AHEAD_DISTANCE = 8;

const MAX_PITCH_ANGLE = THREE.MathUtils.degToRad(38);
const MAX_ROLL_ANGLE = THREE.MathUtils.degToRad(48);
const ORIENTATION_LERP = 0.06;

const FLIP_DURATION = 0.8; // seconds, per spec
const BACKFLIP_DURATION = 0.9;

const MIN_FLAP_SPEED = 3;
const MAX_FLAP_SPEED = 17;
const GLIDE_PITCH_THRESHOLD = -0.15; // diving hard enough (while not boosting) reads as a glide
const GLIDE_FLAP_MULTIPLIER = 0.55;

// Over open water there is no altitude floor except the seabed itself, so the bird can dive
// to (and below) true sea level. Over solid ground (terrain map, or an island on the ocean
// map) the old hard floor above the surface is kept unchanged. The seabed sits close to the
// surface — a shallow, densely-populated reef band rather than a deep empty ocean.
const SEABED_FLOOR_Y = -15;
// Small hysteresis band around the water surface so skimming exactly at sea level doesn't
// rapidly flicker between airborne/underwater state.
const UNDERWATER_HYSTERESIS = 0.4;

/** Smoothly ease in/out — used for the barrel roll and backflip sweeps. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private environment: TerrainManager | OceanManager;
  private ocean: OceanManager | null;
  private bird: Bird;
  private wind = new WindAudio();
  private sfx = new SoundEffects();

  private sky!: THREE.Mesh;
  private skyClouds!: THREE.Group;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ambient!: THREE.AmbientLight;
  private starfield: THREE.Points | null = null;

  private clouds: CloudManager;
  private rings: RingManager | null;
  private splash: SplashEffect | null;
  private ringBurst: RingBurstEffect | null;
  private underwaterEnv: UnderwaterEnvironment | null;
  private waterBurst: WaterBurstEffect | null;
  private ringGuide: RingGuideArrow | null;
  private score = 0;

  private options: GameEngineOptions;

  private clock = new THREE.Clock();
  private animationHandle: number | null = null;

  private targetPitch = 0;
  private targetRoll = 0;
  private currentPitch = 0;
  private currentRoll = 0;

  private speed = BASE_SPEED;
  private speedPulse = 0;
  private boosting = false;

  private flipProgress: number | null = null; // barrel roll; null when not flipping
  private flipStartRoll = 0;

  private backflipProgress: number | null = null; // null when not backflipping
  private backflipStartPitch = 0;

  private underwater = false;

  private headingYaw = 0;
  private cameraTarget = new THREE.Vector3();
  private cameraLookAt = new THREE.Vector3();

  private disposed = false;

  constructor(private container: HTMLDivElement, options: GameEngineOptions) {
    this.options = options;
    const look = WEATHER_LOOKS[options.weather];
    const isOcean = options.mapType === 'ocean';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(look.skyTop);
    this.scene.fog = new THREE.FogExp2(isOcean ? look.fogOcean : look.fogMountain, 0.0068);

    this.camera = new THREE.PerspectiveCamera(
      BASE_FOV,
      container.clientWidth / container.clientHeight,
      0.1,
      1200,
    );
    this.camera.position.set(0, 6, -12);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.buildSky(look);
    this.buildLighting(look);

    if (isOcean) {
      const ocean = new OceanManager(this.scene);
      this.environment = ocean;
      this.ocean = ocean;
      this.splash = new SplashEffect(this.scene);
      this.underwaterEnv = new UnderwaterEnvironment(this.scene);
      this.waterBurst = new WaterBurstEffect(this.scene);
    } else {
      this.environment = new TerrainManager(this.scene);
      this.ocean = null;
      this.splash = null;
      this.underwaterEnv = null;
      this.waterBurst = null;
    }
    this.clouds = new CloudManager(this.scene);
    this.rings = options.ringChallenge ? new RingManager(this.scene) : null;
    this.ringBurst = options.ringChallenge ? new RingBurstEffect(this.scene) : null;
    this.ringGuide = options.ringChallenge ? new RingGuideArrow(this.scene) : null;

    this.bird = new Bird(options.birdType);
    this.bird.group.position.set(0, 26, 0);
    this.scene.add(this.bird.group);

    this.environment.update(this.bird.group.position);

    window.addEventListener('resize', this.handleResize);
  }

  private buildSky(look: WeatherLook) {
    // Soft gradient sky dome, tinted per the selected day/night/weather preset (see sky.ts).
    this.sky = createSkyDome(look.skyTop, look.skyBottom);
    this.scene.add(this.sky);

    if (look.stars) {
      this.starfield = createStarfield();
      this.scene.add(this.starfield);
    }

    // Distant horizon cloud puffs, grouped so the whole backdrop can follow the bird on XZ (see
    // `update`), like the sky dome and starfield.
    this.skyClouds = createSkyClouds(look.stars ? 0.18 : 0.85).group;
    this.scene.add(this.skyClouds);
  }

  private buildLighting(look: WeatherLook) {
    const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
    this.scene.add(hemi);
    this.hemi = hemi;

    const ambient = new THREE.AmbientLight(look.ambientColor, look.ambientIntensity);
    this.scene.add(ambient);
    this.ambient = ambient;

    // Dynamic directional sun/moon light — casts soft low-poly shadows and follows the
    // bird each frame (see `update`) so its shadow camera frustum stays centered nearby.
    const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    sun.position.set(-60, 90, -40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.bias = -0.0025;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    const fill = new THREE.DirectionalLight(look.fillColor, 0.3);
    fill.position.set(50, 40, 60);
    this.scene.add(fill);
  }

  /** Swaps the scene's fog/background/lighting to the fixed cyan underwater look. */
  private enterUnderwaterLook() {
    this.scene.background = new THREE.Color(UNDERWATER_BACKGROUND);
    this.scene.fog = new THREE.FogExp2(UNDERWATER_BACKGROUND, UNDERWATER_FOG_DENSITY);
    this.hemi.color.set(UNDERWATER_HEMI_SKY);
    this.hemi.groundColor.set(UNDERWATER_HEMI_GROUND);
    this.hemi.intensity = UNDERWATER_HEMI_INTENSITY;
    this.ambient.color.set(UNDERWATER_AMBIENT_COLOR);
    this.ambient.intensity = UNDERWATER_AMBIENT_INTENSITY;
  }

  /** Restores the surface fog/background/lighting for the currently selected weather preset. */
  private exitUnderwaterLook() {
    const look = WEATHER_LOOKS[this.options.weather];
    const isOcean = this.options.mapType === 'ocean';
    this.scene.background = new THREE.Color(look.skyTop);
    this.scene.fog = new THREE.FogExp2(isOcean ? look.fogOcean : look.fogMountain, 0.0068);
    this.hemi.color.set(look.hemiSky);
    this.hemi.groundColor.set(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.ambient.color.set(look.ambientColor);
    this.ambient.intensity = look.ambientIntensity;
  }

  private handleResize = () => {
    if (!this.container) return;
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  };

  async start() {
    await this.wind.start();
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.animationHandle = requestAnimationFrame(loop);
    };
    this.animationHandle = requestAnimationFrame(loop);
  }

  /** Called from the hand tracker whenever a new gesture reading is available. */
  applyControls(state: HandControlState) {
    // The backflip gesture's "hand left frame" fallback reports handDetected: false (the
    // flick often carries the hand out of the webcam view), so this check must run before
    // the guard below or that fallback path would silently do nothing.
    if (state.backflip && this.flipProgress === null && this.backflipProgress === null) {
      this.backflipProgress = 0;
      this.backflipStartPitch = this.currentPitch;
      this.options.onBackflip?.();
    }

    // Hand lost: ease back to level flight at cruise speed instead of latching the last steering
    // and boost input (the pitch/roll ease comes from the ORIENTATION_LERP chase in `update`).
    if (!state.handDetected) {
      this.targetPitch = 0;
      this.targetRoll = 0;
      this.boosting = false;
      return;
    }

    this.targetPitch = state.pitch;
    this.targetRoll = state.roll;

    const wasBoosting = this.boosting;
    this.boosting = state.boost;

    // The barrel roll fires automatically the instant a fist closes (boost starts), instead
    // of needing a separate gesture — mutually exclusive with an in-progress backflip so the
    // two one-shot tricks never fight over the bird's rotation in the same frame.
    if (!wasBoosting && this.boosting && this.flipProgress === null && this.backflipProgress === null) {
      this.flipProgress = 0;
      this.flipStartRoll = this.currentRoll;
      this.options.onBarrelRoll?.();
    }
  }

  private update(dt: number) {
    // Smoothly chase the gesture-driven pitch/roll targets (extra jitter removal beyond
    // the exponential smoothing already applied to the raw hand keypoints).
    this.currentPitch += (this.targetPitch - this.currentPitch) * ORIENTATION_LERP;
    this.currentRoll += (this.targetRoll - this.currentRoll) * ORIENTATION_LERP;

    // `steeringPitchAngle`/`steeringRollAngle` are the player's actual steering input and are
    // the ONLY things allowed to change the flight path (forward vector, heading/yaw).
    // `visualPitchAngle`/`visualRollAngle` are what actually gets applied to the bird's
    // mesh/camera rotation, which during a trick sweeps a full 360 degrees on top — keeping
    // them separate is what makes the barrel roll and backflip purely cosmetic instead of
    // corrupting the actual momentum/direction (see project memory on this pattern).
    const steeringPitchAngle = this.currentPitch * MAX_PITCH_ANGLE;
    let visualPitchAngle = steeringPitchAngle;

    let steeringRollAngle = this.currentRoll * MAX_ROLL_ANGLE;
    if (this.underwater) steeringRollAngle *= UNDERWATER_STEERING_DAMPING;
    let visualRollAngle = steeringRollAngle;

    // Barrel roll: sweep a full 360 degrees of roll on top of the steering roll over 0.8s.
    if (this.flipProgress !== null) {
      this.flipProgress += dt / FLIP_DURATION;
      if (this.flipProgress >= 1) {
        this.flipProgress = null;
      } else {
        const sweep = easeInOutCubic(this.flipProgress) * Math.PI * 2;
        visualRollAngle = this.flipStartRoll * MAX_ROLL_ANGLE + sweep;
      }
    }

    // Backflip: sweep a full 360 degrees of pitch on top of the steering pitch, triggered by
    // a rapid upward hand flick. Mirrors the barrel roll's fix exactly, along the pitch axis.
    if (this.backflipProgress !== null) {
      this.backflipProgress += dt / BACKFLIP_DURATION;
      if (this.backflipProgress >= 1) {
        this.backflipProgress = null;
      } else {
        const sweep = easeInOutCubic(this.backflipProgress) * Math.PI * 2;
        visualPitchAngle = this.backflipStartPitch * MAX_PITCH_ANGLE + sweep;
      }
    }

    // Turning: bank angle steers yaw, like a real glider — but heading is locked while a
    // barrel roll is in progress, so boosting always continues straight ahead.
    if (this.flipProgress === null) {
      this.headingYaw -= steeringRollAngle * dt * 0.6;
    }

    this.speedPulse = Math.max(0, this.speedPulse - SPEED_PULSE_DECAY_PER_SEC * dt);
    const baseSpeed = this.underwater ? UNDERWATER_BASE_SPEED : BASE_SPEED;
    const boostSpeed = this.underwater ? UNDERWATER_BOOST_SPEED : BOOST_SPEED;
    const speedLerp = this.underwater ? UNDERWATER_SPEED_LERP : SPEED_LERP;
    const targetSpeed = (this.boosting ? boostSpeed : baseSpeed) + this.speedPulse;
    this.speed += (targetSpeed - this.speed) * speedLerp;

    // The actual flight path uses only the steering pitch (never the trick sweep above), so
    // a backflip never alters where the bird is actually heading.
    const forward = new THREE.Vector3(
      Math.sin(this.headingYaw) * Math.cos(steeringPitchAngle),
      Math.sin(steeringPitchAngle),
      Math.cos(this.headingYaw) * Math.cos(steeringPitchAngle),
    ).normalize();

    const bird = this.bird.group;
    const prevX = bird.position.x;
    const prevZ = bird.position.z;
    bird.position.addScaledVector(forward, this.speed * dt);

    // Islands are solid below the waterline: a submerged bird that swims into an island's
    // footprint slides along its edge instead of being snapped up through the surface by the
    // solid-ground altitude floor below. Try keeping each horizontal axis of the move on its
    // own before falling back to blocking the horizontal move entirely.
    if (this.underwater && this.ocean && !this.ocean.isOverWater(bird.position.x, bird.position.z)) {
      const newX = bird.position.x;
      const newZ = bird.position.z;
      if (this.ocean.isOverWater(newX, prevZ)) {
        bird.position.z = prevZ;
      } else if (this.ocean.isOverWater(prevX, newZ)) {
        bird.position.x = prevX;
      } else {
        bird.position.x = prevX;
        bird.position.z = prevZ;
      }
    }

    // Altitude clamp: over open water there is no floor except the seabed itself, letting
    // the bird dive to (and below) true sea level. Over solid ground — the mountain map, or
    // an island on the ocean map — the old hard floor just above the surface is unchanged.
    const overWater = this.ocean !== null && this.ocean.isOverWater(bird.position.x, bird.position.z);
    if (overWater) {
      if (bird.position.y < SEABED_FLOOR_Y) bird.position.y = SEABED_FLOOR_Y;
    } else {
      const minAltitude = this.environment.heightAtWorld(bird.position.x, bird.position.z) + 3.5;
      if (bird.position.y < minAltitude) bird.position.y = minAltitude;
    }
    if (bird.position.y > 140) bird.position.y = 140;

    // Underwater state, recomputed from the bird's post-movement position, with a small
    // hysteresis band around the surface so skimming right at sea level doesn't flicker.
    let targetUnderwater = false;
    if (overWater && this.ocean) {
      const waterSurfaceY = this.ocean.heightAtWorld(bird.position.x, bird.position.z);
      const depthBelowSurface = waterSurfaceY - bird.position.y;
      const threshold = this.underwater ? -UNDERWATER_HYSTERESIS : UNDERWATER_HYSTERESIS;
      targetUnderwater = depthBelowSurface > threshold;
    }
    if (targetUnderwater !== this.underwater) {
      this.underwater = targetUnderwater;
      this.underwaterEnv?.setActive(this.underwater);
      if (this.underwater) {
        this.enterUnderwaterLook();
        this.options.onWaterTransition?.('submerged');
      } else {
        this.exitUnderwaterLook();
        this.waterBurst?.trigger(bird.position.clone());
        this.options.onWaterTransition?.('surfaced');
      }
    }

    // The bird mesh's beak/head faces local +Z, which is the same axis `forward` above is
    // built from — so setting yaw to headingYaw directly (no extra 180deg offset) makes the
    // beak point the way the bird is actually flying, away from the chase camera, instead of
    // staring back at it.
    bird.rotation.order = 'YXZ';
    bird.rotation.y = this.headingYaw;
    bird.rotation.x = -visualPitchAngle;
    bird.rotation.z = visualRollAngle;

    // Wing-flap speed now tracks actual flight speed continuously (fast during boost,
    // slower cruising otherwise) instead of a binary boosting/not-boosting switch, and
    // eases further when diving un-boosted for a proper "gliding" look.
    let flapSpeed = THREE.MathUtils.mapLinear(this.speed, baseSpeed, boostSpeed, 7, MAX_FLAP_SPEED);
    if (!this.boosting && !this.underwater && steeringPitchAngle < GLIDE_PITCH_THRESHOLD) {
      flapSpeed *= GLIDE_FLAP_MULTIPLIER;
    }
    flapSpeed = THREE.MathUtils.clamp(flapSpeed, MIN_FLAP_SPEED, MAX_FLAP_SPEED);
    this.bird.update(dt, flapSpeed, this.underwater);

    this.environment.update(bird.position);
    this.clouds.update(dt, bird.position, forward);
    this.underwaterEnv?.update(dt, bird.position, forward);

    if (this.rings) {
      const collectedAt = this.rings.update(dt, bird.position, forward, (x, z) => this.environment.heightAtWorld(x, z));
      if (collectedAt) {
        this.score += 1;
        this.speedPulse = RING_SPEED_PULSE;
        this.sfx.playChime();
        this.ringBurst?.trigger(collectedAt);
        this.options.onScoreChange?.(this.score);
      }
      this.ringGuide?.update(dt, bird.position, forward, this.rings.getNextRingPosition(bird.position));
    }
    this.ringBurst?.update(dt);
    this.waterBurst?.update(dt);

    if (this.splash && this.ocean) {
      const waterSurfaceY = this.ocean.heightAtWorld(bird.position.x, bird.position.z);
      this.splash.update(dt, bird.position, forward, waterSurfaceY, overWater);
    }
    this.ocean?.animateWater(dt);

    // Camera follow: heavy lerp for a floaty, relaxed feel — even heavier underwater so the
    // chase camera reads as swimming through water rather than flying through air.
    const cameraLerp = this.underwater ? UNDERWATER_CAMERA_LERP : CAMERA_LERP;
    const behind = forward.clone().multiplyScalar(-CAMERA_BACK_DISTANCE);
    const desiredCameraPos = bird.position.clone().add(behind).add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
    this.cameraTarget.lerp(desiredCameraPos, cameraLerp);
    this.camera.position.copy(this.cameraTarget);

    const desiredLookAt = bird.position.clone().addScaledVector(forward, LOOK_AHEAD_DISTANCE);
    this.cameraLookAt.lerp(desiredLookAt, cameraLerp);
    this.camera.lookAt(this.cameraLookAt);

    const baseFov = this.underwater ? UNDERWATER_BASE_FOV : BASE_FOV;
    const boostFov = this.underwater ? UNDERWATER_BOOST_FOV : BOOST_FOV;
    const targetFov = this.boosting ? boostFov : baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * FOV_LERP;
    this.camera.updateProjectionMatrix();

    // Keep the sun's shadow frustum centered near the bird as it travels the endless map.
    this.sun.position.set(bird.position.x - 55, bird.position.y + 85, bird.position.z - 38);
    this.sun.target.position.copy(bird.position);
    this.sun.target.updateMatrixWorld();

    // The sky backdrop (gradient dome, distant clouds, starfield) follows the bird on XZ so the
    // endless world never flies out of it.
    this.sky.position.set(bird.position.x, 0, bird.position.z);
    this.skyClouds.position.set(bird.position.x, 0, bird.position.z);
    if (this.starfield) {
      this.starfield.position.set(bird.position.x, 0, bird.position.z);
    }

    const speedRatio = (this.speed - baseSpeed) / (boostSpeed - baseSpeed);
    this.wind.setIntensity(this.underwater ? 0 : 0.3 + speedRatio);
  }

  getSpeed() {
    return this.speed;
  }

  getScore() {
    return this.score;
  }

  isBoosting() {
    return this.boosting;
  }

  isFlipping() {
    return this.flipProgress !== null;
  }

  isBackflipping() {
    return this.backflipProgress !== null;
  }

  isUnderwater() {
    return this.underwater;
  }

  dispose() {
    this.disposed = true;
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    window.removeEventListener('resize', this.handleResize);
    this.wind.stop();
    this.sfx.dispose();
    this.clouds.dispose();
    this.rings?.dispose();
    this.splash?.dispose();
    this.ringBurst?.dispose();
    this.underwaterEnv?.dispose();
    this.waterBurst?.dispose();
    this.ringGuide?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
