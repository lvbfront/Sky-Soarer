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
import { damp, perFrameRate } from './damping';
import { disposeObjectTree } from './dispose';
import { WATER_LEVEL } from './oceanField';
import { AutoQualityMonitor, QUALITY_PROFILES, levelFor, type QualityLevel, type QualitySetting } from './quality';
import type { HandControlState } from './handControls';

import {
  BACKFLIP_DURATION,
  BARREL_ROLL_DURATION,
  BASE_SPEED,
  BOOST_SPEED,
  NEXT_RING_HIGHLIGHTS,
  OCEAN_LOOKS,
  WEATHER_LOOKS,
  type MapType,
  type OceanLook,
  type WeatherLook,
  type WeatherPreset,
} from './presets';
import { createSkyClouds, createSkyDome, createStarfield } from './sky';

export { MAP_OPTIONS, WEATHER_OPTIONS, type MapType, type WeatherPreset } from './presets';

// Surface fog density (both maps). Underwater densities live in OCEAN_LOOKS, per sky.
const SURFACE_FOG_DENSITY = 0.0068;
// How quickly fog, light and background blend across the surface when diving or surfacing
// (per second; ~0.4 s to settle). The sky and the above-water world switch at the crossing itself.
const UNDERWATER_BLEND_RATE = 7;
// Camera depth over which the underwater colour goes from its "just below the surface" shade to
// its seabed shade.
const UNDERWATER_COLOR_DEPTH = 16;

export interface GameEngineOptions {
  birdType: BirdType;
  mapType: MapType;
  weather: WeatherPreset;
  ringChallenge: boolean;
  /** Graphics quality (Auto / High / Low); defaults to Auto. */
  quality?: QualitySetting;
  onScoreChange?: (score: number) => void;
  onBarrelRoll?: () => void;
  onBackflip?: () => void;
  onWaterTransition?: (state: 'submerged' | 'surfaced') => void;
  /** Auto quality changed the rendered level (it only ever drops, to 'low'). */
  onQualityChange?: (level: QualityLevel) => void;
}

// Every smoothing rate below is per second, applied with damp(rate, dt) so the feel is the same at
// any frame rate. Each is written as the per-frame factor it replaced, at the 60 FPS it was tuned at.

// BASE_SPEED and BOOST_SPEED live in presets.ts (the guide quotes them).
const SPEED_RATE = perFrameRate(0.04, 60);
const RING_SPEED_PULSE = 7;
const SPEED_PULSE_DECAY_PER_SEC = 9;

// Underwater flight is slower and floatier than airborne flight — momentum builds and
// bleeds off more gradually, matching the "more drag, floatier" swimming feel from spec.
const UNDERWATER_BASE_SPEED = 5;
const UNDERWATER_BOOST_SPEED = 10;
const UNDERWATER_SPEED_RATE = perFrameRate(0.02, 60);
// Steering input is damped underwater so both the visual roll and the actual turn rate
// soften together — swimming banks gentler than flying.
const UNDERWATER_STEERING_DAMPING = 0.5;

const BASE_FOV = 58;
const BOOST_FOV = 72;
const UNDERWATER_BASE_FOV = 50;
const UNDERWATER_BOOST_FOV = 60;
const FOV_RATE = perFrameRate(0.06, 60);

const CAMERA_RATE = perFrameRate(0.05, 60);
const UNDERWATER_CAMERA_RATE = perFrameRate(0.03, 60);
const CAMERA_BACK_DISTANCE = 6.5;
const CAMERA_HEIGHT = 2.2;
const LOOK_AHEAD_DISTANCE = 8;
// The chase camera always stays on the bird's side of the water surface (by this margin), so a
// swimming bird is never hidden under the opaque sea and the view crosses the surface with it.
const CAMERA_SURFACE_MARGIN = 0.35;
const CAMERA_SEABED_CLEARANCE = 0.6;

const MAX_PITCH_ANGLE = THREE.MathUtils.degToRad(38);
const MAX_ROLL_ANGLE = THREE.MathUtils.degToRad(48);
const ORIENTATION_RATE = perFrameRate(0.06, 60);

// Trick lengths (BARREL_ROLL_DURATION, BACKFLIP_DURATION) live in presets.ts (the guide quotes them).

const MIN_FLAP_SPEED = 3;
const MAX_FLAP_SPEED = 17;
const GLIDE_PITCH_THRESHOLD = -0.15; // diving hard enough (while not boosting) reads as a glide
const GLIDE_FLAP_MULTIPLIER = 0.55;

// Over open water the only floor is the seabed itself (dunes, rocks and reef slopes from
// OceanManager's ground), kept this far below the bird. Over solid ground (terrain map, or an
// island on the ocean map) the old hard floor above the surface is kept unchanged.
const SEABED_CLEARANCE = 1.2;
// Small hysteresis band around the water surface so skimming exactly at sea level doesn't
// rapidly flicker between airborne/underwater state.
const UNDERWATER_HYSTERESIS = 0.4;
// Where the sun/moon sits relative to the bird (its shadow frustum follows the bird).
const SUN_OFFSET = new THREE.Vector3(-55, 85, -38);
// Precompiling every shader at takeoff, so the first dive doesn't hitch; capped so a slow
// driver never holds the takeoff veil for long.
const PRECOMPILE_TIMEOUT_MS = 1500;

/** Smoothly ease in/out — used for the barrel roll and backflip sweeps. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Resolved colours for the ocean map's above/below-water blend (no per-frame allocation). */
interface AtmosphereColors {
  surfaceFog: THREE.Color;
  surfaceBackground: THREE.Color;
  underShallow: THREE.Color;
  underDeep: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  ambient: THREE.Color;
  underHemiSky: THREE.Color;
  underHemiGround: THREE.Color;
  underAmbient: THREE.Color;
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private fog: THREE.FogExp2;
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

  private cloudRoot = new THREE.Group();
  private clouds: CloudManager;
  private rings: RingManager | null;
  private splash: SplashEffect | null;
  private ringBurst: RingBurstEffect | null;
  private underwaterEnv: UnderwaterEnvironment | null;
  private waterBurst: WaterBurstEffect | null;
  private ringGuide: RingGuideArrow | null;
  private score = 0;

  private options: GameEngineOptions;
  private look: WeatherLook;
  private oceanLook: OceanLook;
  private atmosphere: AtmosphereColors;
  private underwaterBlend = 0;

  private qualitySetting: QualitySetting;
  private autoLevel: QualityLevel = 'high';
  private qualityLevel: QualityLevel;
  private autoQuality = new AutoQualityMonitor();

  // THREE.Timer (THREE.Clock is deprecated), connected to the Page Visibility API so a hidden tab
  // doesn't produce one huge delta on return.
  private timer = new THREE.Timer();
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

  // Scratch vectors, reused every frame (the hot loop allocates nothing).
  private readonly forward = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  private disposed = false;
  // While paused the loop stops entirely (no update, no render): the canvas holds the last frame.
  private paused = false;
  // Set once start() has finished; before that, setPaused only records the flag (start() reads it).
  private started = false;

  constructor(private container: HTMLDivElement, options: GameEngineOptions) {
    this.options = options;
    const look = WEATHER_LOOKS[options.weather];
    this.look = look;
    this.oceanLook = OCEAN_LOOKS[options.weather];
    const isOcean = options.mapType === 'ocean';
    this.qualitySetting = options.quality ?? 'auto';
    this.qualityLevel = levelFor(this.qualitySetting, this.autoLevel);
    const profile = QUALITY_PROFILES[this.qualityLevel];

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(look.skyTop);
    this.fog = new THREE.FogExp2(isOcean ? look.fogOcean : look.fogMountain, SURFACE_FOG_DENSITY);
    this.scene.fog = this.fog;

    const ol = this.oceanLook;
    this.atmosphere = {
      surfaceFog: new THREE.Color(isOcean ? look.fogOcean : look.fogMountain),
      surfaceBackground: new THREE.Color(look.skyTop),
      underShallow: new THREE.Color(ol.underwaterShallow),
      underDeep: new THREE.Color(ol.underwaterDeep),
      hemiSky: new THREE.Color(look.hemiSky),
      hemiGround: new THREE.Color(look.hemiGround),
      ambient: new THREE.Color(look.ambientColor),
      underHemiSky: new THREE.Color(ol.underwaterHemiSky),
      underHemiGround: new THREE.Color(ol.underwaterHemiGround),
      underAmbient: new THREE.Color(ol.underwaterAmbient),
    };

    this.camera = new THREE.PerspectiveCamera(
      BASE_FOV,
      container.clientWidth / container.clientHeight,
      0.1,
      1200,
    );
    this.camera.position.set(0, 6, -12);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatioCap));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in r185 and falls back to this anyway (CLAUDE.md §9 #17).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.buildSky(look);
    this.buildLighting(look, profile.shadowMapSize);
    this.scene.add(this.cloudRoot);

    if (isOcean) {
      const ocean = new OceanManager(this.scene, profile);
      this.environment = ocean;
      this.ocean = ocean;
      this.splash = new SplashEffect(this.scene);
      this.waterBurst = new WaterBurstEffect(this.scene);
      this.underwaterEnv = new UnderwaterEnvironment(this.scene, ocean, profile);
      this.applyOceanLook();
    } else {
      this.environment = new TerrainManager(this.scene);
      this.ocean = null;
      this.splash = null;
      this.underwaterEnv = null;
      this.waterBurst = null;
    }
    this.clouds = new CloudManager(this.cloudRoot);
    // The next ring and the guide arrow share one highlight color, picked for this map + sky.
    const highlight = NEXT_RING_HIGHLIGHTS[options.mapType][options.weather];
    this.rings = options.ringChallenge ? new RingManager(this.scene, highlight) : null;
    this.ringBurst = options.ringChallenge ? new RingBurstEffect(this.scene) : null;
    this.ringGuide = options.ringChallenge ? new RingGuideArrow(this.scene, highlight) : null;

    this.bird = new Bird(options.birdType);
    this.bird.group.position.set(0, 26, 0);
    this.scene.add(this.bird.group);

    this.environment.update(this.bird.group.position);

    this.timer.connect(document);
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

  private buildLighting(look: WeatherLook, shadowMapSize: number) {
    const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
    this.scene.add(hemi);
    this.hemi = hemi;

    const ambient = new THREE.AmbientLight(look.ambientColor, look.ambientIntensity);
    this.scene.add(ambient);
    this.ambient = ambient;

    // Dynamic directional sun/moon light — casts soft low-poly shadows and follows the
    // bird each frame (see `update`) so its shadow camera frustum stays centered nearby.
    const sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    sun.position.copy(SUN_OFFSET);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
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

  /** The ocean's water and underwater colours for the chosen sky (set once). */
  private applyOceanLook() {
    const ocean = this.ocean;
    if (!ocean || !this.underwaterEnv) return;
    const ol = this.oceanLook;
    ocean.setSurfaceLook({
      shallow: new THREE.Color(ol.waterShallow),
      mid: new THREE.Color(ol.waterMid),
      deep: new THREE.Color(ol.waterDeep),
      underDeep: new THREE.Color(ol.undersideDeep),
      window: new THREE.Color(ol.undersideWindow),
    });
    ocean.uniforms.uCausticColor.value.set(ol.causticColor);
    ocean.uniforms.uGlowColor.value.set(ol.glowColor);
    this.underwaterEnv.setLook({
      shaftColor: new THREE.Color(ol.shaftColor),
      shaftIntensity: ol.shaftIntensity,
      snowColor: new THREE.Color(ol.snowColor),
    });
    this.underwaterEnv.setSunLean(SUN_OFFSET.x, SUN_OFFSET.z);
  }

  /** Switches everything that only exists on one side of the water surface. */
  private setUnderwaterWorld(underwater: boolean) {
    this.sky.visible = !underwater;
    this.skyClouds.visible = !underwater;
    this.cloudRoot.visible = !underwater;
    if (this.starfield) this.starfield.visible = !underwater;
    this.ocean?.setUnderwaterView(underwater);
    this.underwaterEnv?.setActive(underwater, this.bird.group.position);
    this.wind.setUnderwater(underwater);
    // Below the surface nothing receives the sun's shadows, so stop re-rendering the shadow map
    // (the bird is the only caster); it's refreshed on the first frame back above water.
    this.renderer.shadowMap.autoUpdate = !underwater;
    if (!underwater) this.renderer.shadowMap.needsUpdate = true;
    this.applyCaustics();
  }

  private applyCaustics() {
    if (!this.ocean) return;
    const u = this.ocean.uniforms;
    const profile = QUALITY_PROFILES[this.qualityLevel];
    u.uCaustics.value = this.underwater && profile.caustics ? this.oceanLook.caustics : 0;
    u.uGlow.value = this.underwater ? this.oceanLook.glow : 0;
  }

  /**
   * Ocean map: blends fog, background and light between the sky's look and the underwater look
   * (which itself darkens and blues with the camera's depth). Runs every frame; allocation-free.
   */
  private updateAtmosphere(dt: number) {
    const target = this.underwater ? 1 : 0;
    this.underwaterBlend += (target - this.underwaterBlend) * damp(UNDERWATER_BLEND_RATE, dt);
    if (Math.abs(this.underwaterBlend - target) < 0.001) this.underwaterBlend = target;
    const t = this.underwaterBlend;
    const a = this.atmosphere;
    const ol = this.oceanLook;
    const look = this.look;
    const depthT = THREE.MathUtils.clamp((WATER_LEVEL - this.camera.position.y) / UNDERWATER_COLOR_DEPTH, 0, 1);

    const under = this.tmpColor.copy(a.underShallow).lerp(a.underDeep, Math.pow(depthT, 0.8));
    this.fog.color.copy(a.surfaceFog).lerp(under, t);
    const underDensity = THREE.MathUtils.lerp(ol.underwaterDensityShallow, ol.underwaterDensityDeep, depthT);
    this.fog.density = THREE.MathUtils.lerp(SURFACE_FOG_DENSITY, underDensity, t);
    const background = this.scene.background as THREE.Color;
    // Below the surface the background is the fog itself, so the far distance is just water.
    if (this.underwater) background.copy(this.fog.color);
    else background.copy(a.surfaceBackground);

    const light = 1 - depthT * 0.35;
    this.hemi.color.copy(a.hemiSky).lerp(a.underHemiSky, t);
    this.hemi.groundColor.copy(a.hemiGround).lerp(a.underHemiGround, t);
    this.hemi.intensity = THREE.MathUtils.lerp(look.hemiIntensity, ol.underwaterHemiIntensity * light, t);
    this.ambient.color.copy(a.ambient).lerp(a.underAmbient, t);
    this.ambient.intensity = THREE.MathUtils.lerp(look.ambientIntensity, ol.underwaterAmbientIntensity * light, t);
    this.sun.intensity = THREE.MathUtils.lerp(look.sunIntensity, ol.underwaterSunIntensity * light, t);
  }

  private applyQualityLevel(level: QualityLevel) {
    this.qualityLevel = level;
    const profile = QUALITY_PROFILES[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.pixelRatioCap));
    if (this.sun.shadow.mapSize.x !== profile.shadowMapSize) {
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      // The shadow map is reallocated at its new size on the next render.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.ocean?.setQuality(profile);
    this.underwaterEnv?.setQuality(profile);
    this.applyCaustics();
    this.autoQuality.reset(1);
    if (this.paused && this.started && !this.disposed) this.renderer.render(this.scene, this.camera);
  }

  /** The player's quality setting (from the pause menu). */
  setQuality(setting: QualitySetting) {
    if (this.disposed) return;
    this.qualitySetting = setting;
    const level = levelFor(setting, this.autoLevel);
    if (level !== this.qualityLevel) this.applyQualityLevel(level);
  }

  /** The level actually being rendered (Auto resolves to High or Low). */
  getQualityLevel() {
    return this.qualityLevel;
  }

  private handleResize = () => {
    if (!this.container) return;
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    // setSize clears the canvas; a paused game has no loop to redraw it, so redraw the held frame.
    if (this.paused && !this.disposed) this.renderer.render(this.scene, this.camera);
  };

  async start() {
    await this.wind.start();
    if (this.disposed) return;
    // Compile every shader now, under the takeoff veil, including the underwater scene's (made
    // visible just for this pass), so neither the first frames nor the first dive hitch.
    this.underwaterEnv?.setVisibleForCompile(true);
    try {
      await Promise.race([
        this.renderer.compileAsync(this.scene, this.camera),
        new Promise((resolve) => window.setTimeout(resolve, PRECOMPILE_TIMEOUT_MS)),
      ]);
    } catch (error) {
      console.warn('Shader precompile failed; shaders will compile on first use', error);
    }
    this.underwaterEnv?.setVisibleForCompile(false);
    if (this.disposed) return;
    this.timer.reset();
    this.started = true;
    if (this.paused) {
      this.wind.setSuspended(true);
      return;
    }
    this.animationHandle = requestAnimationFrame(this.loop);
  }

  private loop = () => {
    if (this.disposed || this.paused) return;
    const rawDt = this.timer.update().getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    // Auto quality watches the real frame time (before the 0.05 s clamp).
    if (this.qualitySetting === 'auto' && this.autoQuality.sample(rawDt)) {
      this.autoLevel = 'low';
      if (this.qualityLevel !== 'low') this.applyQualityLevel('low');
      this.options.onQualityChange?.('low');
    }
    this.animationHandle = requestAnimationFrame(this.loop);
  };

  /**
   * Freezes or resumes the game: while paused nothing moves (flight, tricks, rings, water, the
   * chase camera), control input is ignored, and the wind is silenced. Resuming discards the time
   * spent paused, so the first frame back doesn't jump.
   */
  setPaused(paused: boolean) {
    if (this.disposed || paused === this.paused) return;
    this.paused = paused;
    if (!this.started) return;
    this.wind.setSuspended(paused);
    if (paused) {
      if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
      return;
    }
    // Discard the paused time: the next update() measures from now.
    this.timer.reset();
    this.autoQuality.reset(1);
    this.animationHandle = requestAnimationFrame(this.loop);
  }

  isPaused() {
    return this.paused;
  }

  /** Called by the active input (hand tracker or keyboard) whenever a new control reading is available. */
  applyControls(state: HandControlState) {
    // Paused: input must not steer, boost or start a trick behind the pause menu. The next
    // reading after resuming sets the targets again.
    if (this.paused) return;

    // The backflip gesture's "hand left frame" fallback reports handDetected: false (the
    // flick often carries the hand out of the webcam view), so this check must run before
    // the guard below or that fallback path would silently do nothing.
    if (state.backflip && this.flipProgress === null && this.backflipProgress === null) {
      this.backflipProgress = 0;
      this.backflipStartPitch = this.currentPitch;
      this.options.onBackflip?.();
    }

    // Hand lost: ease back to level flight at cruise speed instead of latching the last steering
    // and boost input (the pitch/roll ease comes from the ORIENTATION_RATE chase in `update`).
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
    const orientationAlpha = damp(ORIENTATION_RATE, dt);
    this.currentPitch += (this.targetPitch - this.currentPitch) * orientationAlpha;
    this.currentRoll += (this.targetRoll - this.currentRoll) * orientationAlpha;

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
      this.flipProgress += dt / BARREL_ROLL_DURATION;
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
    const speedRate = this.underwater ? UNDERWATER_SPEED_RATE : SPEED_RATE;
    const targetSpeed = (this.boosting ? boostSpeed : baseSpeed) + this.speedPulse;
    this.speed += (targetSpeed - this.speed) * damp(speedRate, dt);

    // The actual flight path uses only the steering pitch (never the trick sweep above), so
    // a backflip never alters where the bird is actually heading.
    const forward = this.forward
      .set(
        Math.sin(this.headingYaw) * Math.cos(steeringPitchAngle),
        Math.sin(steeringPitchAngle),
        Math.cos(this.headingYaw) * Math.cos(steeringPitchAngle),
      )
      .normalize();

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

    // Altitude clamp: over open water the floor is the seabed itself (with its dunes, rocks and
    // the reef slopes rising toward islands). Over solid ground — the mountain map, or an island
    // on the ocean map — the old hard floor just above the surface is unchanged.
    const overWater = this.ocean !== null && this.ocean.isOverWater(bird.position.x, bird.position.z);
    if (overWater && this.ocean) {
      const floor = this.ocean.groundHeightAt(bird.position.x, bird.position.z) + SEABED_CLEARANCE;
      if (bird.position.y < floor) bird.position.y = floor;
    } else {
      const minAltitude = this.environment.heightAtWorld(bird.position.x, bird.position.z) + 3.5;
      if (bird.position.y < minAltitude) bird.position.y = minAltitude;
    }
    if (bird.position.y > 140) bird.position.y = 140;

    // Underwater state, recomputed from the bird's post-movement position, with a small
    // hysteresis band around the calm water level so skimming the waves doesn't flicker.
    let targetUnderwater = false;
    if (overWater) {
      const depthBelowSurface = WATER_LEVEL - bird.position.y;
      const threshold = this.underwater ? -UNDERWATER_HYSTERESIS : UNDERWATER_HYSTERESIS;
      targetUnderwater = depthBelowSurface > threshold;
    }
    if (targetUnderwater !== this.underwater) {
      this.underwater = targetUnderwater;
      this.setUnderwaterWorld(this.underwater);
      if (this.underwater) {
        this.sfx.playSplash('dive');
        this.options.onWaterTransition?.('submerged');
      } else {
        this.waterBurst?.trigger(bird.position.clone());
        this.sfx.playSplash('surface');
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

    this.ocean?.animateWater(dt);
    this.environment.update(bird.position);
    if (!this.underwater) this.clouds.update(dt, bird.position, forward);
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
      this.ringGuide?.update(dt, bird.position, forward, this.rings.getNextRingPosition());
    }
    this.ringBurst?.update(dt);
    this.waterBurst?.update(dt);

    if (this.splash && this.ocean) {
      const waterSurfaceY = this.ocean.waterHeightAt(bird.position.x, bird.position.z);
      this.splash.update(dt, bird.position, forward, waterSurfaceY, overWater);
    }

    // Camera follow: heavy lerp for a floaty, relaxed feel — even heavier underwater so the
    // chase camera reads as swimming through water rather than flying through air.
    const cameraLerp = damp(this.underwater ? UNDERWATER_CAMERA_RATE : CAMERA_RATE, dt);
    const desiredCameraPos = this.desiredCamera.copy(bird.position).addScaledVector(forward, -CAMERA_BACK_DISTANCE);
    desiredCameraPos.y += CAMERA_HEIGHT;
    this.cameraTarget.lerp(desiredCameraPos, cameraLerp);
    if (this.ocean) this.keepCameraOnBirdSide(this.cameraTarget);
    this.camera.position.copy(this.cameraTarget);

    const desiredLookAt = this.desiredLookAt.copy(bird.position).addScaledVector(forward, LOOK_AHEAD_DISTANCE);
    this.cameraLookAt.lerp(desiredLookAt, cameraLerp);
    this.camera.lookAt(this.cameraLookAt);

    const baseFov = this.underwater ? UNDERWATER_BASE_FOV : BASE_FOV;
    const boostFov = this.underwater ? UNDERWATER_BOOST_FOV : BOOST_FOV;
    const targetFov = this.boosting ? boostFov : baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * damp(FOV_RATE, dt);
    this.camera.updateProjectionMatrix();

    // Keep the sun's shadow frustum centered near the bird as it travels the endless map.
    this.sun.position.copy(bird.position).add(SUN_OFFSET);
    this.sun.target.position.copy(bird.position);
    this.sun.target.updateMatrixWorld();

    // The sky backdrop (gradient dome, distant clouds, starfield) follows the bird on XZ so the
    // endless world never flies out of it.
    this.sky.position.set(bird.position.x, 0, bird.position.z);
    this.skyClouds.position.set(bird.position.x, 0, bird.position.z);
    if (this.starfield) {
      this.starfield.position.set(bird.position.x, 0, bird.position.z);
    }

    if (this.ocean) this.updateAtmosphere(dt);

    const speedRatio = (this.speed - baseSpeed) / (boostSpeed - baseSpeed);
    this.wind.setIntensity(0.3 + speedRatio);
  }

  /** The chase camera stays on the bird's side of the waves (and above the seabed). */
  private keepCameraOnBirdSide(camera: THREE.Vector3) {
    const ocean = this.ocean!;
    const surface = ocean.waterHeightAt(camera.x, camera.z);
    if (this.underwater) {
      if (camera.y > surface - CAMERA_SURFACE_MARGIN) camera.y = surface - CAMERA_SURFACE_MARGIN;
      const floor = ocean.groundHeightAt(camera.x, camera.z) + CAMERA_SEABED_CLEARANCE;
      if (camera.y < floor) camera.y = floor;
    } else if (ocean.isOverWater(camera.x, camera.z) && camera.y < surface + CAMERA_SURFACE_MARGIN) {
      camera.y = surface + CAMERA_SURFACE_MARGIN;
    }
  }

  /** Current airspeed in world units per second (treated as m/s by the HUD). */
  getSpeed() {
    return this.speed;
  }

  /** Bird altitude in world units (treated as meters by the HUD); sea level is 0 on the ocean map. */
  getAltitude() {
    return this.bird.group.position.y;
  }

  /**
   * Compass heading in degrees, 0..360, where 0 is the starting direction (+Z). A right bank
   * decreases `headingYaw`, so the yaw is negated to make right turns raise the heading.
   */
  getHeadingDegrees() {
    const degrees = THREE.MathUtils.radToDeg(-this.headingYaw) % 360;
    return degrees < 0 ? degrees + 360 : degrees;
  }

  getScore() {
    return this.score;
  }

  /** Ring Challenge: world position of the next ring (the one the guide arrow points at), or null. */
  getNextRingPosition() {
    return this.rings?.getNextRingPosition() ?? null;
  }

  /** Ring Challenge: straight-line distance from the bird to the next ring (world units, shown as
   * meters by the HUD), or null when there's no next ring or rings are off. */
  getNextRingDistance() {
    const next = this.getNextRingPosition();
    return next ? next.distanceTo(this.bird.group.position) : null;
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
    this.timer.dispose();
    this.wind.stop();
    this.sfx.dispose();
    this.clouds.dispose();
    this.rings?.dispose();
    this.splash?.dispose();
    this.ringBurst?.dispose();
    this.waterBurst?.dispose();
    this.ringGuide?.dispose();
    this.underwaterEnv?.dispose();
    this.ocean?.dispose();
    // Free everything else still in the scene (terrain, sky, bird, clouds), then the context
    // itself, so repeated sessions don't pile up GPU memory or live WebGL contexts.
    disposeObjectTree(this.scene);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
