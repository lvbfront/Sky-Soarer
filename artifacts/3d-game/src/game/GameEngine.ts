import * as THREE from 'three';
import { Bird, type BirdType } from './bird';
import { TerrainManager } from './terrain';
import { OceanManager } from './ocean';
import { OceanLife } from './oceanLife';
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
import type { SteeringSettings } from './settings';
import {
  brakeSpeed,
  createSpring,
  createTurnState,
  maxPitchAngle,
  springOmega,
  stepAngleSpring,
  stepSpring,
  stepTurn,
  visualBank,
  wrapAngle,
  type Medium,
} from './flightModel';
import {
  AIR_BRAKE_SINK,
  BODY_YAW_LEAD_AIR,
  BODY_YAW_LEAD_WATER,
  BODY_YAW_MAX_DEG,
  BRAKE_BLEND_RATE,
  BRAKE_SPEED_RATE,
  BRAKE_WIND_DIP,
  CAMERA_DISTANCE,
  CAMERA_DISTANCE_RESPONSE,
  CAMERA_DISTANCE_WATER,
  CAMERA_GROUND_CLEARANCE,
  CAMERA_HEIGHT,
  CAMERA_HEIGHT_WATER,
  CAMERA_LEAD,
  CAMERA_LEAD_REDUCED,
  CAMERA_MAX_ANGLE_DEG,
  CAMERA_PITCH_RESPONSE,
  CAMERA_ROLL_FRACTION,
  CAMERA_SPEED_PULLBACK,
  CAMERA_TURN_FOV_DEG,
  CAMERA_YAW_RESPONSE,
  LOOK_AHEAD_DISTANCE,
  MAX_YAW_RATE_DEG,
  PITCH_RESPONSE,
  UNDERWATER_BASE_SPEED,
  UNDERWATER_BOOST_SPEED,
  deg,
} from './flightTuning';

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
  /** Sensitivity and invert, shared by both inputs; changeable mid-flight with setSteering. */
  steering?: SteeringSettings;
  /** prefers-reduced-motion: no camera roll or FOV kicks, a gentler look-into-turn lead. */
  reducedMotion?: boolean;
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
// bleeds off more gradually, matching the "more drag, floatier" swimming feel from spec. The
// swimming speeds and every turning number live in flightTuning.ts.
const UNDERWATER_SPEED_RATE = perFrameRate(0.02, 60);

const BASE_FOV = 58;
const BOOST_FOV = 72;
const UNDERWATER_BASE_FOV = 50;
const UNDERWATER_BOOST_FOV = 60;
const FOV_RATE = perFrameRate(0.06, 60);

// The chase camera's springs (flightTuning.ts holds their response times).
const CAMERA_YAW_OMEGA = springOmega(CAMERA_YAW_RESPONSE);
const CAMERA_PITCH_OMEGA = springOmega(CAMERA_PITCH_RESPONSE);
const CAMERA_DISTANCE_OMEGA = springOmega(CAMERA_DISTANCE_RESPONSE);
const CAMERA_MAX_ANGLE = deg(CAMERA_MAX_ANGLE_DEG);
// Where the camera starts at takeoff (behind, far and high), so it swoops in onto the bird.
const CAMERA_START_DISTANCE = 14;
const CAMERA_START_HEIGHT = 7;
// The chase camera always stays on the bird's side of the water surface (by this margin), so a
// swimming bird is never hidden under the opaque sea and the view crosses the surface with it.
const CAMERA_SURFACE_MARGIN = 0.35;
const CAMERA_SEABED_CLEARANCE = 0.6;

const PITCH_OMEGA = springOmega(PITCH_RESPONSE);
const MAX_YAW_RATE = deg(MAX_YAW_RATE_DEG);
const BODY_YAW_MAX = deg(BODY_YAW_MAX_DEG);

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
  private oceanLife: OceanLife | null;
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

  private steering: SteeringSettings;
  private reducedMotion: boolean;

  // Control targets from the active input (pitch already inverted if the player chose that).
  private targetPitch = 0;
  private targetRoll = 0;
  private brakeInput = false;
  // The smoothed inputs: critically damped springs (no overshoot), see flightModel.ts.
  private pitchSpring = createSpring();
  // The smoothed bank input and the yaw rate (rad/s, positive = turning right; see stepTurn).
  private turn = createTurnState();
  // 0..1: how much of the air brake is applied (blends in and out over ~0.1 s).
  private brakeBlend = 0;

  private speed = BASE_SPEED;
  private speedPulse = 0;
  private boosting = false;

  private flipProgress: number | null = null; // barrel roll; null when not flipping
  private flipStartRoll = 0; // visual roll angle when the roll began

  private backflipProgress: number | null = null; // null when not backflipping
  private backflipStartPitch = 0; // pitch angle when the flip began

  private underwater = false;

  private headingYaw = 0;
  // The chase camera: yaw and pitch springs behind the bird, distance and height springs.
  private cameraYaw = createSpring();
  private cameraPitch = createSpring();
  private cameraDistance = createSpring(CAMERA_START_DISTANCE);
  private cameraHeight = createSpring(CAMERA_START_HEIGHT);
  private cameraFovKick = 0;
  // Diagnostics for the ?debug=flight overlay: the last visual bank.
  private lastVisualBank = 0;

  // Scratch vectors, reused every frame (the hot loop allocates nothing).
  private readonly forward = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly desiredLookAt = new THREE.Vector3();
  private readonly cameraDir = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  private disposed = false;
  // While paused the loop stops entirely (no update, no render): the canvas holds the last frame.
  private paused = false;
  // Set once start() has finished; before that, setPaused only records the flag (start() reads it).
  private started = false;

  constructor(private container: HTMLDivElement, options: GameEngineOptions) {
    this.options = options;
    this.steering = options.steering ?? { sensitivity: 1, invertPitch: false };
    this.reducedMotion = options.reducedMotion ?? false;
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
      this.oceanLife = new OceanLife(this.scene, ocean, ocean.uniforms, (position) => {
        this.waterBurst?.trigger(position);
        this.sfx.playSplash('surface', 0.12);
      });
      this.applyOceanLook();
    } else {
      this.environment = new TerrainManager(this.scene);
      this.ocean = null;
      this.splash = null;
      this.underwaterEnv = null;
      this.oceanLife = null;
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

  /** The ocean's water, horizon and underwater colours for the chosen sky (set once). */
  private applyOceanLook() {
    const ocean = this.ocean;
    if (!ocean || !this.underwaterEnv) return;
    const look = this.look;
    const ol = this.oceanLook;
    ocean.setSurfaceLook(
      {
        shallow: new THREE.Color(ol.waterShallow),
        mid: new THREE.Color(ol.waterMid),
        deep: new THREE.Color(ol.waterDeep),
        reflect: new THREE.Color(ol.waterReflect),
        foam: new THREE.Color('#f4fdff').lerp(new THREE.Color(look.fogOcean), look.stars ? 0.6 : 0.1),
        sunColor: new THREE.Color(look.sunColor),
        glint: ol.glint,
        underDeep: new THREE.Color(ol.undersideDeep),
        window: new THREE.Color(ol.undersideWindow),
      },
      new THREE.Color(ol.horizonTint),
      ol.horizonStrength,
    );
    ocean.setSunDirection(SUN_OFFSET);
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
    this.oceanLife?.setVisible(!underwater);
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

  /** Steering settings changed (pause menu or landing): applies from the next frame. */
  setSteering(steering: SteeringSettings) {
    this.steering = { ...steering };
  }

  setReducedMotion(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
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
      this.backflipStartPitch = this.pitchSpring.value * maxPitchAngle(this.steering.sensitivity);
      this.options.onBackflip?.();
    }

    // Hand lost: ease back to level flight at cruise speed instead of latching the last steering,
    // boost and brake input (the pitch/bank ease comes from their springs in `update`).
    if (!state.handDetected) {
      this.targetPitch = 0;
      this.targetRoll = 0;
      this.boosting = false;
      this.brakeInput = false;
      return;
    }

    this.targetPitch = this.steering.invertPitch ? -state.pitch : state.pitch;
    this.targetRoll = state.roll;
    this.brakeInput = state.brake;

    const wasBoosting = this.boosting;
    this.boosting = state.boost;

    // The barrel roll fires automatically the instant a fist closes (boost starts), instead
    // of needing a separate gesture — mutually exclusive with an in-progress backflip so the
    // two one-shot tricks never fight over the bird's rotation in the same frame.
    if (!wasBoosting && this.boosting && this.flipProgress === null && this.backflipProgress === null) {
      this.flipProgress = 0;
      this.flipStartRoll = this.lastVisualBank;
      this.options.onBarrelRoll?.();
    }
  }

  private update(dt: number) {
    const sensitivity = this.steering.sensitivity;
    const medium: Medium = this.underwater ? 'water' : 'air';

    // The inputs, smoothed by critically damped springs: the bank responds in ~0.15 s and rolls
    // out to level without overshoot; pitch a little softer.
    stepSpring(this.pitchSpring, this.targetPitch, PITCH_OMEGA, dt, true);
    const bankInput = this.turn.bank.value;

    // The air brake (boost cancels it).
    const braking = this.brakeInput && !this.boosting;
    this.brakeBlend += ((braking ? 1 : 0) - this.brakeBlend) * damp(BRAKE_BLEND_RATE, dt);

    // `steeringPitchAngle` and the yaw rate are the player's actual steering input and are the
    // ONLY things allowed to change the flight path (forward vector, heading/yaw).
    // `visualPitchAngle`/`visualRollAngle` are what actually gets applied to the bird's
    // mesh/camera rotation, which during a trick sweeps a full 360 degrees on top — keeping
    // them separate is what makes the barrel roll and backflip purely cosmetic instead of
    // corrupting the actual momentum/direction (see project memory on this pattern).
    const steeringPitchAngle = this.pitchSpring.value * maxPitchAngle(sensitivity);
    let visualPitchAngle = steeringPitchAngle;

    // Visual bank: up to ~60° flying, ~40° swimming (the body yaws into the turn instead).
    const bankAngle = visualBank(bankInput, medium, sensitivity);
    this.lastVisualBank = bankAngle;
    let visualRollAngle = bankAngle;

    // Barrel roll: sweep a full 360 degrees of roll on top of the steering roll over 0.8s.
    if (this.flipProgress !== null) {
      this.flipProgress += dt / BARREL_ROLL_DURATION;
      if (this.flipProgress >= 1) {
        this.flipProgress = null;
      } else {
        const sweep = easeInOutCubic(this.flipProgress) * Math.PI * 2;
        visualRollAngle = this.flipStartRoll + sweep;
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
        visualPitchAngle = this.backflipStartPitch + sweep;
      }
    }

    this.speedPulse = Math.max(0, this.speedPulse - SPEED_PULSE_DECAY_PER_SEC * dt);
    const baseSpeed = this.underwater ? UNDERWATER_BASE_SPEED : BASE_SPEED;
    const boostSpeed = this.underwater ? UNDERWATER_BOOST_SPEED : BOOST_SPEED;
    let targetSpeed = this.boosting ? boostSpeed : baseSpeed;
    let speedRate = this.underwater ? UNDERWATER_SPEED_RATE : SPEED_RATE;
    if (braking) {
      targetSpeed = brakeSpeed(medium, BASE_SPEED);
      speedRate = BRAKE_SPEED_RATE;
    }
    this.speed += (targetSpeed + this.speedPulse - this.speed) * damp(speedRate, dt);

    // Turning: a coordinated turn (rate ∝ tan(bank), falling with speed; see flightModel.ts), eased
    // in and out with a capped yaw acceleration. The heading is locked while a barrel roll is in
    // progress, so boosting always continues straight ahead.
    // (headingYaw grows to the left: a right turn decreases it.)
    const yawRate = stepTurn(this.turn, this.targetRoll, this.speed, medium, braking, sensitivity, dt, this.flipProgress !== null);
    this.headingYaw -= yawRate * dt;

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
    // Braking in the air sinks gently (a landing approach). Banking alone never changes altitude:
    // the model is kinematic, so a level turn holds its height exactly with no lift term needed.
    if (!this.underwater) bird.position.y -= AIR_BRAKE_SINK * this.brakeBlend * dt;

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
        this.waterBurst?.trigger(bird.position);
        this.sfx.playSplash('surface');
        this.options.onWaterTransition?.('surfaced');
      }
    }

    // The bird mesh's beak/head faces local +Z, which is the same axis `forward` above is
    // built from — so setting yaw to headingYaw directly (no extra 180deg offset) makes the
    // beak point the way the bird is actually flying, away from the chase camera, instead of
    // staring back at it. The body also yaws a little into the turn (much more when swimming,
    // where it banks less).
    const bodyLead = this.underwater ? BODY_YAW_LEAD_WATER : BODY_YAW_LEAD_AIR;
    const bodyYaw = THREE.MathUtils.clamp(-yawRate * bodyLead, -BODY_YAW_MAX, BODY_YAW_MAX);
    bird.rotation.order = 'YXZ';
    bird.rotation.y = this.headingYaw + bodyYaw;
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
    this.bird.update(dt, flapSpeed, this.underwater, this.brakeBlend);

    this.ocean?.animateWater(dt);
    this.environment.update(bird.position);
    if (!this.underwater) this.clouds.update(dt, bird.position, forward);
    this.underwaterEnv?.update(dt, bird.position, forward);
    if (!this.underwater) this.oceanLife?.update(dt, bird.position, forward);

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

    this.updateCamera(dt, steeringPitchAngle, bankAngle);

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

    // The wind follows the airspeed (a quiet floor when slow) and dips a little under the brake.
    const speedRatio = Math.max(-0.15, (this.speed - baseSpeed) / (boostSpeed - baseSpeed));
    this.wind.setIntensity((0.3 + speedRatio) * (1 - BRAKE_WIND_DIP * this.brakeBlend));
  }

  /**
   * The chase camera. Its yaw follows the heading with a critically damped spring, aimed slightly
   * into the turn (yaw rate × CAMERA_LEAD), and never trails the heading by more than
   * CAMERA_MAX_ANGLE_DEG, so the bird stays in frame through a U-turn. Pitch, distance and height
   * have springs of their own (boost pulls the camera back). It rolls with a fraction of the bird's
   * bank and widens its FOV slightly in tight turns, except under reduced motion. Allocation-free.
   */
  private updateCamera(dt: number, pitchAngle: number, bankAngle: number) {
    const bird = this.bird.group.position;
    const reduced = this.reducedMotion;
    // Heading-space yaw rate (headingYaw grows to the left).
    const headingRate = -this.turn.yawRate.value;
    const lead = (reduced ? CAMERA_LEAD_REDUCED : CAMERA_LEAD) * headingRate;
    stepAngleSpring(this.cameraYaw, this.headingYaw + lead, CAMERA_YAW_OMEGA, dt);
    const trail = wrapAngle(this.cameraYaw.value - this.headingYaw);
    if (Math.abs(trail) > CAMERA_MAX_ANGLE) {
      this.cameraYaw.value = this.headingYaw + Math.sign(trail) * CAMERA_MAX_ANGLE;
      this.cameraYaw.velocity = headingRate;
    }
    stepSpring(this.cameraPitch, pitchAngle, CAMERA_PITCH_OMEGA, dt);

    const underwater = this.underwater;
    const pullback = underwater ? 0 : Math.max(0, this.speed - BASE_SPEED) * CAMERA_SPEED_PULLBACK;
    stepSpring(this.cameraDistance, (underwater ? CAMERA_DISTANCE_WATER : CAMERA_DISTANCE) + pullback, CAMERA_DISTANCE_OMEGA, dt);
    stepSpring(this.cameraHeight, underwater ? CAMERA_HEIGHT_WATER : CAMERA_HEIGHT, CAMERA_DISTANCE_OMEGA, dt);

    const yaw = this.cameraYaw.value;
    const pitch = this.cameraPitch.value;
    const dir = this.cameraDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const position = this.desiredCamera.copy(bird).addScaledVector(dir, -this.cameraDistance.value);
    position.y += this.cameraHeight.value;
    if (this.ocean) this.keepCameraOnBirdSide(position);
    if (!this.underwater && (!this.ocean || !this.ocean.isOverWater(position.x, position.z))) {
      const floor = this.environment.heightAtWorld(position.x, position.z) + CAMERA_GROUND_CLEARANCE;
      if (position.y < floor) position.y = floor;
    }
    this.camera.position.copy(position);
    this.camera.lookAt(this.desiredLookAt.copy(bird).addScaledVector(dir, LOOK_AHEAD_DISTANCE));
    if (!reduced) this.camera.rotateZ(-bankAngle * CAMERA_ROLL_FRACTION);

    const baseFov = underwater ? UNDERWATER_BASE_FOV : BASE_FOV;
    const boostFov = underwater ? UNDERWATER_BOOST_FOV : BOOST_FOV;
    const turnKick = reduced ? 0 : CAMERA_TURN_FOV_DEG * Math.min(1, Math.abs(headingRate) / MAX_YAW_RATE);
    this.cameraFovKick += (turnKick - this.cameraFovKick) * damp(FOV_RATE, dt);
    const targetFov = (this.boosting && !reduced ? boostFov : baseFov) + this.cameraFovKick;
    this.camera.fov += (targetFov - this.camera.fov) * damp(FOV_RATE, dt);
    this.camera.updateProjectionMatrix();
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

  /** True while the air brake is applied (held, and not cancelled by boost). */
  isBraking() {
    return this.brakeInput && !this.boosting;
  }

  /** Current turn rate in degrees per second (positive = turning right). */
  getYawRateDegrees() {
    return THREE.MathUtils.radToDeg(this.turn.yawRate.value);
  }

  /** Numbers for the ?debug=flight overlay. */
  getDebugInfo() {
    const p = this.bird.group.position;
    return {
      state: this.underwater ? 'SWIMMING' : 'FLYING',
      substate: '',
      speed: this.speed,
      yawRate: this.getYawRateDegrees(),
      bank: THREE.MathUtils.radToDeg(this.lastVisualBank),
      agl: p.y - this.environment.heightAtWorld(p.x, p.z),
      brake: this.isBraking(),
      slope: null as number | null,
      landable: null as boolean | null,
      steering: this.steering,
      drawCalls: this.renderer.info.render.calls,
    };
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
    this.oceanLife?.dispose();
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
