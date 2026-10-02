import * as THREE from 'three';
import { Bird, createBirdPose, type BirdType } from './bird';
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
import { BirdStateMachine, type BirdEvent, type BirdMode, type BirdStepInput } from './birdState';
import {
  createFootprint,
  createSurfaceSample,
  evaluateLandingEnvelope,
  heightFieldSurfaces,
  isLandable,
  sampleFootprint,
  type EnvelopeFailure,
  type LandingEnvelope,
  type LandingEnvelopeInput,
  type LandingSurfaces,
  type SurfaceKind,
} from './landingSurface';
import { LandingCue } from './landingCue';
import { GroundWalker, type GroundEvent, type GroundInput } from './groundMotion';
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
  CAMERA_IDLE_ANGLE_DEG,
  CAMERA_IDLE_DELAY,
  CAMERA_IDLE_ORBIT_RATE,
  CAMERA_SURFACE_CLEARANCE,
  GROUND_FLIP_SPEED,
  JUMP_FLUTTER_SPEED,
  JUMP_SPEED,
  LEDGE_GLIDE_PITCH,
  LEDGE_GLIDE_SPEED,
  PADDLE_RIPPLE_INTERVAL,
  STEPS_PER_SECOND,
  WALK_SPEED,
  FLARE_MIN_DURATION,
  FLARE_PITCH_DEG,
  GO_AROUND_CLIMB,
  GO_AROUND_DURATION,
  LANDING_CUE_AGL,
  MIN_FLYING_SPEED,
  SURFACE_ALIGN,
  TAKEOFF_CLIMB_DEG,
  TAKEOFF_CROUCH,
  TAKEOFF_EXIT_SPEED,
  TAKEOFF_FLAP_SPEED,
  TAKEOFF_JUMP_FORWARD,
  TAKEOFF_JUMP_UP,
  TOUCHDOWN_DURATION,
  TOUCHDOWN_SPEED,
  TURN_MIN_SPEED,
  WATER_TAKEOFF_RUN,
  WATER_TAKEOFF_RUN_SPEED,
  WING_FOLD_DURATION,
  BODY_YAW_LEAD_WATER,
  BODY_YAW_MAX_DEG,
  BRAKE_BLEND_RATE,
  BRAKE_SPEED_RATE,
  BRAKE_WIND_DIP,
  CAMERA_DISTANCE,
  CAMERA_DISTANCE_RESPONSE,
  CAMERA_DISTANCE_SURFACE,
  CAMERA_DISTANCE_WATER,
  CAMERA_HEIGHT_SURFACE,
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
  /** The bird changed state (landing, standing, floating, taking off, flying). */
  onModeChange?: (mode: BirdMode) => void;
}

/** What the HUD's LDG readout shows (one reused object). */
export interface LandingCueInfo {
  visible: boolean;
  /** Height of the feet above the surface below. */
  agl: number;
  /** Every landing condition holds (or the landing is under way). */
  ready: boolean;
  /** The first condition that doesn't hold, e.g. 'not-braking'. */
  failure: EnvelopeFailure | null;
}

// ---- Landing, standing, floating (Part B; the tunable numbers are in flightTuning.ts) ----------
// A floating bird's origin rides this far above the drawn water surface (the body sits in it).
const FLOAT_BODY_LIFT = 0.18;
// The waves under a floating bird are probed this far ahead/behind/aside to pitch and roll it, and
// it follows that slope by this fraction.
const FLOAT_PROBE = 0.6;
const FLOAT_ALIGN = 0.85;
// Standing posture: nose a little up.
const STAND_PITCH_DEG = 8;
// On the ocean map, dry ground below this height is beach (sand puffs, a softer thump).
const BEACH_TOP = 1.4;
const DUST_COLOR = new THREE.Color('#d8c49a');
const SAND_COLOR = new THREE.Color('#f2e2b6');
const GRASS_DUST_COLOR = new THREE.Color('#cfd8a6');

const smoothstep01 = (x: number) => {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

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
// On the ground the camera looks just past the bird; the idle 3/4 view returns behind on this spring.
const SURFACE_LOOK_AHEAD = 1.5;
const CAMERA_IDLE_RETURN_OMEGA = springOmega(0.35);
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
// Over solid ground the flying bird stays this far above it…
const FLIGHT_FLOOR_CLEARANCE = 3.5;
// …except right after leaving the ground, when the floor starts at the bird and eases up (per second).
const FLOOR_RELAX_RATE = 1.2;
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
  // The last visual bank (the barrel roll starts from it; the debug overlay shows it).
  private lastVisualBank = 0;

  // Landing, standing, floating and takeoff (Part B).
  private state = new BirdStateMachine();
  private surfaces: LandingSurfaces;
  private footprint = createFootprint();
  private envelope: LandingEnvelope = { ok: false, landable: false, failure: null };
  private envelopeInput: LandingEnvelopeInput;
  private stateInput: BirdStepInput = {
    brake: false,
    boost: false,
    takeoffHold: false,
    envelopeOk: false,
    approachOk: true,
    agl: 0,
    surface: 'ground',
    walk: 0,
    turn: 0,
    backflip: false,
    ground: null,
  };
  private landingCue: LandingCue;
  private landingCueInfo: LandingCueInfo = { visible: false, agl: 0, ready: false, failure: null };
  private pose = createBirdPose();
  private dustBurst: WaterBurstEffect;
  private boostInput = false;
  // Set when flight begins with the boost input still held (from a hold-to-take-off): no boost
  // until it's released.
  private boostSuppressed = false;
  private takeoffHold = false;
  // Feet above the surface under the bird (the envelope's AGL).
  private agl = 0;
  private surfaceY = 0;
  private goAroundTime = 0;
  private floorClearance = FLIGHT_FLOOR_CLEARANCE;
  private flareStartAgl = 0;
  private flareStartSpeed = 0;
  private flareWhooshed = false;
  private takeoffLaunched = false;
  private takeoffVelocityY = 0;
  private takeoffFlapPhase = 0;
  private splashClock = 0;
  private readonly takeoffForward = new THREE.Vector3();
  private readonly touchdownPoint = new THREE.Vector3();
  // Attitude while landing, standing, floating and taking off (radians), and the surface tilt.
  private visualPitch = 0;
  private visualRoll = 0;
  private surfacePitch = 0;
  private surfaceRoll = 0;
  private cameraPitchTarget = 0;
  // Idle animation timers.
  private idleClock = 0;
  private headTimer = 0;
  private headTarget = 0;
  private headYaw = 0;
  private ruffleTimer = 6;
  private tailTimer = 3;

  // Ground locomotion (Part C).
  private walker: GroundWalker;
  private walkInput = 0;
  private readonly groundInput: GroundInput = { walk: 0, turn: 0, sensitivity: 1 };
  // The backflip input while standing (the ground backflip), consumed by the next state step.
  private backflipQueued = false;
  // What the walker reported this frame, for the state machine.
  private groundEvent: GroundEvent | null = null;
  private gaitPhase = 0;
  private stepHop = 0;
  private landSquash = 0;
  private rippleClock = 0;
  private rippleBurst: WaterBurstEffect | null = null;
  // Seconds standing or floating without any input (the camera drifts to a 3/4 view after a while).
  private stillTime = 0;
  // The idle camera's angle around from behind the bird.
  private cameraIdleOffset = createSpring();
  private readonly cameraSurface = createSurfaceSample();
  // Engine clock for animation (seconds of unpaused simulation).
  private time = 0;

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
    this.state.reducedMotion = this.reducedMotion;
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

    // What the bird can land and stand on: the ground as drawn (its tile grid's triangles), plus on
    // the ocean map the water surface as drawn and the rock tops.
    const ocean = this.ocean;
    const terrain = this.environment;
    this.surfaces = ocean
      ? heightFieldSurfaces({
          ground: (x, z) => ocean.groundHeightAt(x, z),
          gridSpacing: ocean.groundGridSpacing,
          water: (x, z) => ocean.floatHeightAt(x, z),
          perches: (x, z) => ocean.perchesNear(x, z),
        })
      : heightFieldSurfaces({
          ground: (x, z) => terrain.heightAtWorld(x, z),
          gridSpacing: (terrain as TerrainManager).groundGridSpacing,
        });
    this.envelopeInput = {
      braking: false,
      underwater: false,
      trick: false,
      speed: BASE_SPEED,
      brakeSpeed: BASE_SPEED,
      pathAngle: 0,
      agl: Infinity,
      footprint: this.footprint,
    };
    this.landingCue = new LandingCue(this.scene);
    this.walker = new GroundWalker(this.surfaces);
    if (this.ocean) {
      // Paddling ripples: small, flat, short-lived rings of droplets.
      this.rippleBurst = new WaterBurstEffect(this.scene, {
        color: '#e6f8ff',
        count: 9,
        lifetime: 0.7,
        gravity: -1.5,
        speedMin: 0.5,
        speedMax: 1.1,
        upward: 0.12,
        size: 0.35,
      });
    }
    this.dustBurst = new WaterBurstEffect(this.scene, {
      color: '#d8c49a',
      count: 22,
      lifetime: 0.9,
      gravity: -2.5,
      speedMin: 1.2,
      speedMax: 3,
      upward: 0.35,
      size: 0.9,
      additive: false,
    });

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
    this.state.reducedMotion = reducedMotion;
  }

  /** Called by the active input (hand tracker or keyboard) whenever a new control reading is available. */
  applyControls(state: HandControlState) {
    // Paused: input must not steer, boost or start a trick behind the pause menu. The next
    // reading after resuming sets the targets again.
    if (this.paused) return;
    const flying = this.state.allowsFlightTricks();

    // The backflip gesture's "hand left frame" fallback reports handDetected: false (the
    // flick often carries the hand out of the webcam view), so this check must run before
    // the guard below or that fallback path would silently do nothing. Flying only: on the
    // ground and on water the flying tricks are blocked.
    if (flying && state.backflip && this.flipProgress === null && this.backflipProgress === null) {
      this.backflipProgress = 0;
      this.backflipStartPitch = this.pitchSpring.value * maxPitchAngle(this.steering.sensitivity);
      this.options.onBackflip?.();
    }

    // Hand lost: ease back to level flight at cruise speed instead of latching the last steering,
    // boost and brake input (the pitch/bank ease comes from their springs in `update`). Standing or
    // floating, the bird simply stays put and idles.
    // Standing, the backflip input is the ground backflip (the state machine applies its cooldown).
    if (!flying && state.backflip) this.backflipQueued = true;

    if (!state.handDetected) {
      this.targetPitch = 0;
      this.targetRoll = 0;
      this.walkInput = 0;
      this.boostInput = false;
      this.boosting = false;
      this.brakeInput = false;
      this.takeoffHold = false;
      return;
    }

    this.targetPitch = this.steering.invertPitch ? -state.pitch : state.pitch;
    this.targetRoll = state.roll;
    this.walkInput = state.walk;
    this.brakeInput = state.brake;
    this.takeoffHold = state.takeoffHold;
    this.boostInput = state.boost;
    // A boost input still held from a hold-to-take-off doesn't boost (or roll) until it's let go.
    if (!state.boost) this.boostSuppressed = false;

    const wasBoosting = this.boosting;
    this.boosting = flying && state.boost && !this.boostSuppressed;

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
    this.time += dt;
    // The pitch input, smoothed by a critically damped spring (no overshoot). The bank's spring
    // lives in the turn state (stepTurn).
    stepSpring(this.pitchSpring, this.flightPitchTarget(dt), PITCH_OMEGA, dt, true);

    const forward = this.state.isFlying() ? this.updateFlight(dt) : this.updateOnSurface(dt);
    const bird = this.bird.group;

    this.ocean?.animateWater(dt);
    this.environment.update(bird.position);
    // Standing and floating heights read the surface as drawn this frame (the water's uTime has
    // just advanced and its mesh has just followed the bird), so the bird never sinks into or
    // hovers over it.
    if (!this.state.isFlying()) this.settleOnSurface();

    if (!this.underwater) this.clouds.update(dt, bird.position, forward);
    this.underwaterEnv?.update(dt, bird.position, forward);
    if (!this.underwater) this.oceanLife?.update(dt, bird.position, forward);

    if (this.rings) {
      const collectedAt = this.rings.update(dt, bird.position, forward, (x, z) => this.environment.heightAtWorld(x, z));
      if (collectedAt) {
        this.score += 1;
        if (this.state.isFlying()) this.speedPulse = RING_SPEED_PULSE;
        this.sfx.playChime();
        this.ringBurst?.trigger(collectedAt);
        this.options.onScoreChange?.(this.score);
      }
      this.ringGuide?.update(dt, bird.position, forward, this.rings.getNextRingPosition());
    }
    this.ringBurst?.update(dt);
    this.waterBurst?.update(dt);
    this.dustBurst.update(dt);
    this.rippleBurst?.update(dt);

    if (this.splash && this.ocean) {
      // Skimming spray is for flying low over the waves, not for a bird landing or afloat.
      const skimming = this.state.isFlying() && this.ocean.isOverWater(bird.position.x, bird.position.z);
      const waterSurfaceY = this.ocean.waterHeightAt(bird.position.x, bird.position.z);
      this.splash.update(dt, bird.position, forward, waterSurfaceY, skimming);
    }

    this.updateLandingCue();
    this.updateCamera(dt, this.state.isFlying() ? this.cameraPitchTarget : 0, this.lastVisualBank);

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
    const baseSpeed = this.underwater ? UNDERWATER_BASE_SPEED : BASE_SPEED;
    const boostSpeed = this.underwater ? UNDERWATER_BOOST_SPEED : BOOST_SPEED;
    const speedRatio = Math.max(-0.15, (this.speed - baseSpeed) / (boostSpeed - baseSpeed));
    this.wind.setIntensity((0.3 + speedRatio) * (1 - BRAKE_WIND_DIP * this.brakeBlend));
  }

  /** The pitch the flight spring chases: the input, or a gentle climb right after a go-around. */
  private flightPitchTarget(dt: number) {
    if (this.goAroundTime > 0) {
      this.goAroundTime = Math.max(0, this.goAroundTime - dt);
      // The player's own pitch input wins over the automatic climb.
      if (Math.abs(this.targetPitch) < 0.1) return GO_AROUND_CLIMB;
    }
    return this.state.isFlying() ? this.targetPitch : 0;
  }

  /** FLYING: the flight model (A), the brake, and the landing envelope check. Returns `forward`. */
  private updateFlight(dt: number) {
    const sensitivity = this.steering.sensitivity;
    const medium: Medium = this.underwater ? 'water' : 'air';

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
    this.cameraPitchTarget = steeringPitchAngle;
    let visualPitchAngle = steeringPitchAngle;

    // Visual bank: up to ~60° flying, ~40° swimming (the body yaws into the turn instead).
    const bankAngle = visualBank(this.turn.bank.value, medium, sensitivity);
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
    // progress, so boosting always continues straight ahead. (headingYaw grows to the left: a right
    // turn decreases it.)
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
      // Right after a takeoff or a go-around the bird is lower than the usual floor: the floor eases
      // back up to it instead of snapping the bird up.
      this.floorClearance += (FLIGHT_FLOOR_CLEARANCE - this.floorClearance) * damp(FLOOR_RELAX_RATE, dt);
      const minAltitude = this.environment.heightAtWorld(bird.position.x, bird.position.z) + this.floorClearance;
      if (bird.position.y < minAltitude) bird.position.y = minAltitude;
    }
    if (bird.position.y > 140) bird.position.y = 140;

    this.updateUnderwater(overWater);

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
    this.resetPose();
    this.pose.brake = this.brakeBlend;
    this.bird.update(dt, flapSpeed, this.underwater, this.pose);

    // Landing: intent (the brake) + a safe envelope, checked every frame while flying.
    this.measureSurfaceBelow();
    const env = this.envelopeInput;
    env.braking = braking;
    env.underwater = this.underwater;
    env.trick = this.flipProgress !== null || this.backflipProgress !== null;
    env.speed = this.speed;
    env.brakeSpeed = brakeSpeed('air', BASE_SPEED);
    env.pathAngle = Math.atan2(forward.y * this.speed - AIR_BRAKE_SINK * this.brakeBlend, Math.hypot(forward.x, forward.z) * this.speed);
    env.agl = this.agl;
    evaluateLandingEnvelope(env, this.envelope);
    this.stepState(dt);
    return forward;
  }

  /** Samples the surface footprint under the bird and its feet's height above it. */
  private measureSurfaceBelow() {
    const p = this.bird.group.position;
    sampleFootprint(this.surfaces, p.x, p.z, this.footprint);
    this.agl = p.y - this.bird.standHeight - this.footprint.center.height;
  }

  /** Runs the state machine one step and reacts to the transition it reports. */
  private stepState(dt: number) {
    const input = this.stateInput;
    input.brake = this.brakeInput && !this.boostInput;
    input.boost = this.boostInput;
    input.takeoffHold = this.takeoffHold;
    input.envelopeOk = this.envelope.ok;
    input.approachOk = this.approachOk();
    input.agl = Math.max(0, this.agl);
    input.surface = this.footprint.center.kind;
    input.walk = this.walkInput;
    input.turn = this.targetRoll;
    input.backflip = this.backflipQueued;
    input.ground = this.groundEvent;
    this.backflipQueued = false;
    this.groundEvent = null;
    const event = this.state.step(dt, input);
    if (event) this.onStateEvent(event);
  }

  /** FLARE: still braking, above water, over landable surface. Otherwise: go around. */
  private approachOk() {
    if (this.state.mode !== 'FLARE') return true;
    return this.brakeInput && !this.boostInput && !this.underwater && isLandable(this.footprint);
  }

  private onStateEvent(event: BirdEvent) {
    const bird = this.bird.group.position;
    switch (event) {
      case 'flare':
        // Measured to where the bird will rest: feet on the ground, or the body on the water.
        this.flareStartAgl = Math.max(0, bird.y - this.restHeight(this.footprint.center.kind) - this.footprint.center.height);
        this.flareStartSpeed = this.speed;
        this.flareWhooshed = false;
        this.flipProgress = null;
        this.backflipProgress = null;
        break;
      case 'go-around':
        // Back to flying with a gentle climb (the brake was let go, or the ground ran out).
        this.goAroundTime = GO_AROUND_DURATION;
        this.speed = Math.max(this.speed, MIN_FLYING_SPEED);
        this.lowerFloorToBird();
        break;
      case 'touchdown': {
        const center = this.footprint.center;
        const water = center.kind === 'water';
        const sand = !water && this.ocean !== null && center.height < BEACH_TOP && !center.perch;
        this.touchdownPoint.set(bird.x, center.height, bird.z);
        if (water) {
          this.waterBurst?.trigger(this.touchdownPoint, 0.6);
          this.sfx.playSplash('dive', 0.5);
        } else {
          this.dustBurst.setColor(sand ? SAND_COLOR : this.ocean ? GRASS_DUST_COLOR : DUST_COLOR);
          this.dustBurst.trigger(this.touchdownPoint);
          this.sfx.playThump(sand ? 'sand' : 'ground');
        }
        this.speed = TOUCHDOWN_SPEED;
        break;
      }
      case 'settled':
        this.idleClock = 0;
        this.stillTime = 0;
        this.walker.place(bird.x, bird.z, this.headingYaw);
        break;
      case 'takeoff': {
        const body = this.walker.body;
        this.takeoffFlapPhase = 0;
        if (this.state.airStart) {
          // The second press of a double jump: already in the air, straight into the strong strokes.
          this.takeoffLaunched = true;
          this.takeoffVelocityY = Math.max(body.vy, 1.5);
          this.speed = Math.max(Math.abs(body.speed), 2);
          this.sfx.playFlap(1.2);
        } else {
          this.takeoffLaunched = false;
          this.takeoffVelocityY = 0;
          this.speed = 0;
        }
        break;
      }
      case 'jump':
        this.walker.jump(JUMP_SPEED);
        this.sfx.playFlap(0.8);
        if (!this.reducedMotion) this.dustBurst.trigger(bird, 0.25);
        break;
      case 'ground-flip':
        this.walker.jump(GROUND_FLIP_SPEED);
        this.sfx.playFlap(1);
        this.options.onBackflip?.();
        break;
      case 'jump-landed':
        this.landSquash = 1;
        this.sfx.playThump(this.ocean && bird.y < BEACH_TOP + this.bird.standHeight ? 'sand' : 'ground');
        break;
      case 'glide':
        // Off a ledge (or down somewhere it can't stand): wings open into a glide, and it's flying.
        this.speed = Math.max(LEDGE_GLIDE_SPEED, Math.abs(this.walker.body.speed));
        this.pitchSpring.value = LEDGE_GLIDE_PITCH;
        this.pitchSpring.velocity = 0;
        this.boostSuppressed = this.boostInput;
        this.lowerFloorToBird();
        this.sfx.playFlap(0.7);
        break;
      case 'enter-water':
        this.touchdownPoint.set(bird.x, this.walker.body.feetY, bird.z);
        this.waterBurst?.trigger(this.touchdownPoint, 0.35);
        this.sfx.playSplash('dive', 0.3);
        break;
      case 'exit-water':
        break;
      case 'airborne':
        // Into normal flight: keep the climb the takeoff left off with, ease into cruise from here.
        this.speed = Math.max(this.speed, MIN_FLYING_SPEED);
        this.pitchSpring.value = deg(TAKEOFF_CLIMB_DEG) / maxPitchAngle(this.steering.sensitivity);
        this.pitchSpring.velocity = 0;
        this.boostSuppressed = this.boostInput;
        this.goAroundTime = 0;
        this.lowerFloorToBird();
        break;
    }
    this.options.onModeChange?.(this.state.mode);
  }

  /**
   * FLARE, TOUCHDOWN, GROUNDED, FLOATING and TAKEOFF: scripted motion over the surface and the
   * procedural animation for each. Returns `forward` (the horizontal heading, or the takeoff climb).
   */
  private updateOnSurface(dt: number) {
    const bird = this.bird.group;
    const state = this.state;
    const reduced = this.reducedMotion;
    this.brakeBlend += ((state.mode === 'FLARE' ? 1 : 0) - this.brakeBlend) * damp(BRAKE_BLEND_RATE, dt);
    this.speedPulse = 0;
    this.lastVisualBank += (0 - this.lastVisualBank) * damp(BRAKE_BLEND_RATE, dt);
    this.resetPose();
    const pose = this.pose;
    let flapSpeed = 0;
    let swimming = false;

    // Gentle steering stays available while landing and taking off (and, in Part C, on the ground).
    const steerScale = state.mode === 'FLARE' || state.mode === 'TAKEOFF' ? 0.45 : 0;
    const yawRate = stepTurn(this.turn, this.targetRoll * steerScale, Math.max(this.speed, TURN_MIN_SPEED), 'air', true, this.steering.sensitivity, dt);
    this.headingYaw -= yawRate * dt;
    const forward = this.forward.set(Math.sin(this.headingYaw), 0, Math.cos(this.headingYaw));

    switch (state.mode) {
      case 'FLARE': {
        // The final approach: horizontal speed bleeds off to a touchdown crawl, and the feet sink to
        // the surface along (1 − u)², so the vertical speed is zero at contact (the flare itself).
        const u = Math.min(1, state.time / state.duration);
        this.speed = THREE.MathUtils.lerp(this.flareStartSpeed, TOUCHDOWN_SPEED, smoothstep01(u));
        bird.position.addScaledVector(forward, this.speed * dt);
        this.measureSurfaceBelow();
        const targetAgl = this.flareStartAgl * (1 - u) * (1 - u);
        this.surfaceY = this.footprint.center.height;
        bird.position.y = this.surfaceY + this.restHeight(this.footprint.center.kind) + targetAgl;
        this.agl = targetAgl;
        // The flare pose in its last FLARE_MIN_DURATION: nose up, wings forward and cupped with a
        // few hard back-strokes, tail fanned down, legs swung forward.
        const flare = smoothstep01((state.time - (state.duration - FLARE_MIN_DURATION)) / FLARE_MIN_DURATION);
        if (flare > 0 && !this.flareWhooshed) {
          this.flareWhooshed = true;
          this.sfx.playWhoosh();
        }
        pose.brake = 1;
        pose.flare = flare;
        pose.legs = smoothstep01(flare * 1.6);
        pose.flapAmplitude = 1.25;
        flapSpeed = flare > 0.15 && flare < 0.9 ? 15 : 4;
        this.visualPitch = deg(FLARE_PITCH_DEG) * flare;
        this.visualRoll = this.lastVisualBank * (1 - flare);
        this.stepState(dt);
        break;
      }
      case 'TOUCHDOWN': {
        const u = Math.min(1, state.time / state.duration);
        this.speed *= Math.exp(-12 * dt);
        bird.position.addScaledVector(forward, this.speed * dt);
        this.measureSurfaceBelow();
        pose.legs = 1;
        pose.flare = 1 - u;
        pose.squash = reduced ? 0 : Math.sin(Math.min(1, u * 1.4) * Math.PI) * 0.85;
        pose.fold = this.foldAmount();
        this.visualPitch = THREE.MathUtils.lerp(deg(FLARE_PITCH_DEG), deg(STAND_PITCH_DEG), smoothstep01(u));
        this.visualRoll = 0;
        this.stepState(dt);
        break;
      }
      case 'GROUNDED':
      case 'FLOATING': {
        // Walking, turning, jumping (and paddling): the ground walker moves the bird over the
        // surfaces; the state machine turns what it reports into substates and mode changes.
        const water = state.mode === 'FLOATING';
        const body = this.walker.body;
        body.heading = this.headingYaw;
        const input = this.groundInput;
        input.walk = this.walkInput;
        input.turn = this.targetRoll;
        input.sensitivity = this.steering.sensitivity;
        this.groundEvent = this.walker.step(dt, input, water ? 'water' : 'ground');
        this.headingYaw = body.heading;
        bird.position.x = body.x;
        bird.position.z = body.z;
        if (body.airborne) bird.position.y = body.feetY + this.bird.standHeight;
        this.speed = Math.abs(body.speed);
        this.measureSurfaceBelow();
        const moving = Math.abs(this.walkInput) > 0.06 || Math.abs(this.targetRoll) > 0.06 || body.airborne;
        this.stillTime = moving ? 0 : this.stillTime + dt;
        flapSpeed = water ? this.floatPose(dt) : this.groundPose(dt);
        this.stepState(dt);
        break;
      }
      case 'TAKEOFF': {
        flapSpeed = this.updateTakeoff(dt, forward);
        break;
      }
      default:
        break;
    }

    this.cameraPitchTarget = 0;
    this.applySurfaceTransform(yawRate);
    this.bird.update(dt, flapSpeed, swimming, pose);
    this.updateUnderwater(false);
    if (state.mode === 'TAKEOFF') return this.takeoffForward;
    return forward.set(Math.sin(this.headingYaw), 0, Math.cos(this.headingYaw));
  }

  /**
   * TAKEOFF: a crouch, a jump up and forward, then strong full strokes while the legs tuck and the
   * bird climbs away into cruise. From water, a short run along the surface comes first (feet
   * pattering, little splashes). Returns the flap speed.
   */
  private updateTakeoff(dt: number, heading: THREE.Vector3) {
    const state = this.state;
    const bird = this.bird.group;
    const pose = this.pose;
    const fromWater = state.surface === 'water';
    const runTime = fromWater ? WATER_TAKEOFF_RUN : 0;
    const t = state.time;
    pose.fold = Math.max(0, 1 - t / 0.15);
    pose.legs = 1;
    pose.flapAmplitude = 1.45;
    let flapSpeed = TAKEOFF_FLAP_SPEED;

    if (fromWater && t < runTime) {
      // The run: pattering over the waves, accelerating.
      this.speed = Math.min(WATER_TAKEOFF_RUN_SPEED, this.speed + (WATER_TAKEOFF_RUN_SPEED / runTime) * dt);
      bird.position.addScaledVector(heading, this.speed * dt);
      this.measureSurfaceBelow();
      this.surfaceY = this.footprint.center.height;
      bird.position.y = this.surfaceY + FLOAT_BODY_LIFT + 0.15 * (t / runTime);
      pose.legSwing = Math.sin(t * 34) * 0.7;
      this.splashClock -= dt;
      if (this.splashClock <= 0) {
        this.splashClock = 0.12;
        this.touchdownPoint.set(bird.position.x, this.surfaceY, bird.position.z);
        this.waterBurst?.trigger(this.touchdownPoint, 0.22);
      }
      this.visualPitch = deg(12);
    } else if (!fromWater && t < TAKEOFF_CROUCH) {
      // The crouch.
      pose.crouch = this.reducedMotion ? 0 : t / TAKEOFF_CROUCH;
      pose.fold = 0.5;
      flapSpeed = 0;
      this.visualPitch = deg(STAND_PITCH_DEG);
    } else {
      if (!this.takeoffLaunched) {
        // The launch impulse.
        this.takeoffLaunched = true;
        this.takeoffVelocityY = fromWater ? TAKEOFF_JUMP_UP * 0.75 : TAKEOFF_JUMP_UP;
        this.speed = Math.max(this.speed, TAKEOFF_JUMP_FORWARD);
        if (!fromWater) {
          this.dustBurst.trigger(bird.position, 0.5);
        }
      }
      const climbStart = fromWater ? runTime : TAKEOFF_CROUCH;
      const u = Math.min(1, (t - climbStart) / (state.duration - climbStart));
      // Strong strokes carry it up (the jump's upward speed eases toward a steady climb) while the
      // airspeed builds toward the exit speed.
      const climbRate = TAKEOFF_EXIT_SPEED * Math.sin(deg(TAKEOFF_CLIMB_DEG));
      this.takeoffVelocityY += (climbRate - this.takeoffVelocityY) * damp(3, dt);
      this.speed += (TAKEOFF_EXIT_SPEED - this.speed) * damp(2.5, dt);
      bird.position.addScaledVector(heading, this.speed * dt);
      bird.position.y += this.takeoffVelocityY * dt;
      pose.legs = 1 - smoothstep01((u - 0.25) / 0.5);
      this.visualPitch = deg(TAKEOFF_CLIMB_DEG) * smoothstep01(u * 2);
      // A wing-stroke sound on every downstroke.
      const before = Math.floor(this.takeoffFlapPhase / (Math.PI * 2));
      this.takeoffFlapPhase += dt * flapSpeed;
      if (Math.floor(this.takeoffFlapPhase / (Math.PI * 2)) !== before) this.sfx.playFlap(1);
    }
    // Never below the surface it left from.
    this.measureSurfaceBelow();
    const floor = this.footprint.center.height + (this.footprint.center.kind === 'water' ? FLOAT_BODY_LIFT : this.bird.standHeight);
    if (bird.position.y < floor) bird.position.y = floor;
    this.visualRoll = this.lastVisualBank;
    const climb = this.takeoffLaunched ? Math.atan2(this.takeoffVelocityY, Math.max(this.speed, 0.1)) : 0;
    this.takeoffForward.set(Math.sin(this.headingYaw) * Math.cos(climb), Math.sin(climb), Math.cos(this.headingYaw) * Math.cos(climb));
    this.stepState(dt);
    return flapSpeed;
  }

  /**
   * Standing, walking, turning, jumping and the ground backflip. The gait: alternating leg swings,
   * a pigeon's head bob and a slight sway; turning on the spot takes small stepping hops; jumps
   * open the wings, flutter at the apex and settle softly. Returns the flap speed.
   */
  private groundPose(dt: number) {
    const pose = this.pose;
    const state = this.state;
    const body = this.walker.body;
    const reduced = this.reducedMotion;
    pose.legs = 1;
    pose.fold = this.foldAmount();
    this.visualPitch = deg(STAND_PITCH_DEG);
    this.visualRoll = 0;
    this.stepHop = 0;
    this.landSquash *= Math.exp(-10 * dt);
    pose.squash = reduced ? 0 : this.landSquash * 0.35;
    let flapSpeed = 0;
    switch (state.substate) {
      case 'WALK': {
        const amount = Math.min(1, Math.abs(body.speed) / WALK_SPEED);
        this.gaitPhase += amount * STEPS_PER_SECOND * Math.PI * dt * Math.sign(body.speed || 1);
        pose.legSwing = Math.sin(this.gaitPhase) * 0.5 * amount;
        if (!reduced) {
          pose.headBob = Math.cos(this.gaitPhase * 2) * 0.07 * amount;
          this.visualRoll = Math.sin(this.gaitPhase) * 0.06 * amount;
        }
        // Still curving: the body leans a touch into the turn.
        this.visualRoll -= body.turnRate * 0.04;
        break;
      }
      case 'TURN': {
        // Small stepping hops on the spot.
        this.gaitPhase += Math.abs(body.turnRate) * 2.4 * dt;
        pose.legSwing = Math.sin(this.gaitPhase) * 0.35;
        if (!reduced) this.stepHop = Math.abs(Math.sin(this.gaitPhase)) * 0.05;
        break;
      }
      case 'JUMP':
      case 'GROUND_FLIP': {
        // Wings half open, fluttering fast near the apex; legs dangling.
        const apex = Math.abs(body.vy) < JUMP_FLUTTER_SPEED;
        pose.fold = 0.3;
        pose.legs = 0.85;
        pose.flapAmplitude = apex ? 0.75 : 0.45;
        flapSpeed = apex ? 24 : 8;
        if (state.substate === 'GROUND_FLIP') {
          // A full 360° of pitch (nose up and over), done before it lands.
          const u = Math.min(1, state.substateTime / BACKFLIP_DURATION);
          this.visualPitch = deg(STAND_PITCH_DEG) + easeInOutCubic(u) * Math.PI * 2;
          pose.flapAmplitude = 1.1;
          flapSpeed = 16;
        }
        break;
      }
      default:
        this.idlePose(dt, false);
        break;
    }
    return flapSpeed;
  }

  /** Floating: bobbing, slow paddling at rest, quicker strokes and ripples while moving. */
  private floatPose(dt: number) {
    const pose = this.pose;
    const body = this.walker.body;
    const reduced = this.reducedMotion;
    pose.legs = 0.55;
    pose.fold = this.foldAmount();
    this.visualPitch = 0;
    this.visualRoll = 0;
    this.stepHop = 0;
    if (this.state.substate === 'PADDLE') {
      this.gaitPhase += dt * 7;
      pose.legSwing = Math.sin(this.gaitPhase) * 0.6;
      pose.breathe = 0.3;
      this.rippleClock -= dt;
      if (this.rippleClock <= 0 && Math.abs(body.speed) > 0.1 && this.rippleBurst) {
        this.rippleClock = PADDLE_RIPPLE_INTERVAL;
        this.touchdownPoint.set(body.x, body.feetY, body.z);
        this.rippleBurst.trigger(this.touchdownPoint);
      }
    } else {
      pose.legSwing = Math.sin(this.time * 2.4) * (reduced ? 0.1 : 0.35);
      this.idlePose(dt, true);
    }
    return 0;
  }

  /** Wing fold after touchdown: two stages over WING_FOLD_DURATION (from the moment of contact). */
  private foldAmount() {
    const state = this.state;
    const scale = this.reducedMotion ? 0.5 : 1;
    const since = state.mode === 'TOUCHDOWN' ? state.time : state.time + TOUCHDOWN_DURATION * scale;
    return Math.min(1, since / (WING_FOLD_DURATION * scale));
  }

  /**
   * Standing or floating idle: slow breathing, the head looking around now and then, an occasional
   * wing ruffle and tail flick. Reduced motion keeps only a little breathing.
   */
  private idlePose(dt: number, floating: boolean) {
    const pose = this.pose;
    this.idleClock += dt;
    pose.breathe = this.reducedMotion ? 0.3 : 1;
    if (this.reducedMotion) {
      this.headYaw += (0 - this.headYaw) * damp(4, dt);
      pose.headYaw = this.headYaw;
      return;
    }
    this.headTimer -= dt;
    if (this.headTimer <= 0) {
      this.headTimer = 1.4 + Math.random() * 2.6;
      this.headTarget = Math.random() < 0.3 ? 0 : (Math.random() * 2 - 1) * 0.9;
    }
    this.headYaw += (this.headTarget - this.headYaw) * damp(7, dt);
    pose.headYaw = this.headYaw;
    this.ruffleTimer -= dt;
    if (this.ruffleTimer <= -0.5) this.ruffleTimer = 6 + Math.random() * 6;
    pose.ruffle = this.ruffleTimer < 0 ? Math.sin((-this.ruffleTimer / 0.5) * Math.PI) : 0;
    this.tailTimer -= dt;
    if (this.tailTimer <= -0.25) this.tailTimer = 3 + Math.random() * 4;
    pose.tailLift = this.tailTimer < 0 ? Math.sin((-this.tailTimer / 0.25) * Math.PI) * 0.35 : 0;
    if (floating) pose.tailLift += 0.12;
  }

  /**
   * Places the bird on what it's standing on or floating in, after the world has updated for this
   * frame: feet on the drawn ground (standHeight above it), or the body resting on the drawn waves,
   * bobbing and rolling with them.
   */
  private settleOnSurface() {
    const state = this.state;
    if (state.mode !== 'GROUNDED' && state.mode !== 'FLOATING' && state.mode !== 'TOUCHDOWN') return;
    const bird = this.bird.group;
    if (this.walker.body.airborne && state.mode === 'GROUNDED') {
      // Mid-jump: the walker owns the height; hold the body upright.
      this.surfacePitch = 0;
      this.surfaceRoll = 0;
      this.applySurfaceTransform(0);
      return;
    }
    this.measureSurfaceBelow();
    const center = this.footprint.center;
    if (center.kind === 'water' && this.ocean) {
      const x = bird.position.x;
      const z = bird.position.z;
      const h = this.ocean.floatHeightAt(x, z);
      bird.position.y = h + FLOAT_BODY_LIFT;
      this.surfaceY = h;
      if (state.mode === 'FLOATING') this.walker.body.feetY = h;
      // Pitch and roll with the waves: the surface's slope along the body and across it.
      const sinH = Math.sin(this.headingYaw);
      const cosH = Math.cos(this.headingYaw);
      const ahead = this.ocean.floatHeightAt(x + sinH * FLOAT_PROBE, z + cosH * FLOAT_PROBE);
      const behind = this.ocean.floatHeightAt(x - sinH * FLOAT_PROBE, z - cosH * FLOAT_PROBE);
      const right = this.ocean.floatHeightAt(x - cosH * FLOAT_PROBE, z + sinH * FLOAT_PROBE);
      const left = this.ocean.floatHeightAt(x + cosH * FLOAT_PROBE, z - sinH * FLOAT_PROBE);
      this.surfacePitch = Math.atan2(ahead - behind, 2 * FLOAT_PROBE) * FLOAT_ALIGN;
      this.surfaceRoll = Math.atan2(left - right, 2 * FLOAT_PROBE) * FLOAT_ALIGN;
    } else {
      bird.position.y = center.height + this.bird.standHeight + this.stepHop;
      this.surfaceY = center.height;
      if (state.mode === 'GROUNDED') this.walker.body.feetY = center.height;
      // Partly aligned to the ground's normal (see SURFACE_ALIGN).
      const sinH = Math.sin(this.headingYaw);
      const cosH = Math.cos(this.headingYaw);
      const alongForward = center.normalX * sinH + center.normalZ * cosH;
      const alongRight = -center.normalX * cosH + center.normalZ * sinH;
      this.surfacePitch = Math.atan2(-alongForward, center.normalY) * SURFACE_ALIGN;
      this.surfaceRoll = Math.atan2(alongRight, center.normalY) * SURFACE_ALIGN;
    }
    this.agl = 0;
    this.applySurfaceTransform(0);
  }

  private applySurfaceTransform(yawRate: number) {
    const bird = this.bird.group;
    const onSurface = this.state.isOnSurface();
    bird.rotation.order = 'YXZ';
    bird.rotation.y = this.headingYaw + THREE.MathUtils.clamp(-yawRate * BODY_YAW_LEAD_AIR, -BODY_YAW_MAX, BODY_YAW_MAX);
    bird.rotation.x = -(this.visualPitch + (onSurface ? this.surfacePitch : 0));
    bird.rotation.z = this.visualRoll + (onSurface ? this.surfaceRoll : 0);
  }

  /** Underwater state from the bird's position, with a small hysteresis around the calm water level. */
  private updateUnderwater(overWater: boolean) {
    const bird = this.bird.group;
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
  }

  /** The touchdown reticle under the bird, and the numbers the HUD's LDG readout shows. */
  private updateLandingCue() {
    const cue = this.landingCueInfo;
    const mode = this.state.mode;
    const flying = mode === 'FLYING';
    const show =
      (flying && !this.underwater && this.agl <= LANDING_CUE_AGL && this.envelope.landable) || mode === 'FLARE';
    cue.visible = show;
    cue.agl = Math.max(0, this.agl);
    cue.ready = mode === 'FLARE' || this.envelope.ok;
    cue.failure = this.envelope.failure;
    if (!show) {
      this.landingCue.hide();
      return;
    }
    const c = this.footprint.center;
    const p = this.bird.group.position;
    this.landingCue.show(p.x, c.height, p.z, c.normalX, c.normalY, c.normalZ, cue.agl, cue.ready, this.time);
  }

  /** Lets the flight floor start at the bird's current height above the ground (see updateFlight). */
  private lowerFloorToBird() {
    const p = this.bird.group.position;
    const clearance = p.y - this.environment.heightAtWorld(p.x, p.z);
    this.floorClearance = THREE.MathUtils.clamp(clearance, this.bird.standHeight, FLIGHT_FLOOR_CLEARANCE);
  }

  /** Height of the bird's origin above the surface it rests on: standing on its feet, or afloat. */
  private restHeight(kind: SurfaceKind) {
    return kind === 'water' ? FLOAT_BODY_LIFT : this.bird.standHeight;
  }

  private resetPose() {
    const pose = this.pose;
    pose.brake = 0;
    pose.flare = 0;
    pose.fold = 0;
    pose.legs = 0;
    pose.legSwing = 0;
    pose.flapAmplitude = 1;
    pose.headYaw = 0;
    pose.headBob = 0;
    pose.tailFan = 0;
    pose.tailLift = 0;
    pose.squash = 0;
    pose.crouch = 0;
    pose.ruffle = 0;
    pose.bodyPitch = 0;
    pose.breathe = 0;
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
    const mode = this.state.mode;
    const resting = mode === 'GROUNDED' || mode === 'FLOATING';
    // Heading-space yaw rate (headingYaw grows to the left); on the ground the walker turns the bird.
    const headingRate = resting ? -this.walker.body.turnRate : -this.turn.yawRate.value;
    const lead = (reduced ? CAMERA_LEAD_REDUCED : CAMERA_LEAD) * headingRate;
    // Standing still for a while: drift slowly round to a 3/4 side view; any input brings it back
    // behind (quickly). Never under reduced motion.
    const idle = resting && !reduced && this.state.substate === 'IDLE' && this.stillTime > CAMERA_IDLE_DELAY;
    const idleOffset = this.cameraIdleOffset;
    if (idle) {
      idleOffset.value = Math.min(deg(CAMERA_IDLE_ANGLE_DEG), idleOffset.value + deg(CAMERA_IDLE_ORBIT_RATE) * dt);
      idleOffset.velocity = 0;
    } else {
      stepSpring(idleOffset, 0, CAMERA_IDLE_RETURN_OMEGA, dt, true);
    }
    stepAngleSpring(this.cameraYaw, this.headingYaw + lead + idleOffset.value, CAMERA_YAW_OMEGA, dt);
    const trail = wrapAngle(this.cameraYaw.value - this.headingYaw);
    if (idleOffset.value < 0.01 && Math.abs(trail) > CAMERA_MAX_ANGLE) {
      this.cameraYaw.value = this.headingYaw + Math.sign(trail) * CAMERA_MAX_ANGLE;
      this.cameraYaw.velocity = headingRate;
    }
    stepSpring(this.cameraPitch, pitchAngle, CAMERA_PITCH_OMEGA, dt);

    const underwater = this.underwater;
    const surface = !this.state.isFlying();
    const pullback = underwater ? 0 : Math.max(0, this.speed - BASE_SPEED) * CAMERA_SPEED_PULLBACK;
    const distance = surface ? CAMERA_DISTANCE_SURFACE : underwater ? CAMERA_DISTANCE_WATER : CAMERA_DISTANCE;
    const height = surface ? CAMERA_HEIGHT_SURFACE : underwater ? CAMERA_HEIGHT_WATER : CAMERA_HEIGHT;
    stepSpring(this.cameraDistance, distance + pullback, CAMERA_DISTANCE_OMEGA, dt);
    stepSpring(this.cameraHeight, height, CAMERA_DISTANCE_OMEGA, dt);

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
    if (surface) {
      // Close to the ground: stay above whatever is drawn under the camera (ground, water, a rock top).
      const under = this.surfaces.sample(position.x, position.z, this.cameraSurface);
      const floor = under.height + CAMERA_SURFACE_CLEARANCE;
      if (position.y < floor) position.y = floor;
    }
    this.camera.position.copy(position);
    const lookAhead = surface ? SURFACE_LOOK_AHEAD : LOOK_AHEAD_DISTANCE;
    this.camera.lookAt(this.desiredLookAt.copy(bird).addScaledVector(dir, lookAhead));
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

  /** True while the air brake is applied (held, and not cancelled by boost) in flight or a landing. */
  isBraking() {
    const mode = this.state.mode;
    return (mode === 'FLYING' || mode === 'FLARE') && this.brakeInput && !this.boostInput;
  }

  /** FLYING, FLARE, TOUCHDOWN, GROUNDED, FLOATING or TAKEOFF. */
  getMode(): BirdMode {
    return this.state.mode;
  }

  /** The LDG readout's numbers (a reused object; read it, don't keep it). */
  getLandingCue(): Readonly<LandingCueInfo> {
    return this.landingCueInfo;
  }

  /** Current turn rate in degrees per second (positive = turning right). */
  getYawRateDegrees() {
    return THREE.MathUtils.radToDeg(this.turn.yawRate.value);
  }

  /** Numbers for the ?debug=flight overlay. */
  getDebugInfo() {
    const mode = this.state.mode;
    const center = this.footprint.center;
    return {
      state: mode === 'FLYING' && this.underwater ? 'FLYING (underwater)' : mode,
      substate: this.state.substate ?? '',
      speed: this.speed,
      yawRate: this.getYawRateDegrees(),
      bank: THREE.MathUtils.radToDeg(this.lastVisualBank),
      agl: this.agl,
      brake: this.isBraking(),
      slope: center.kind === 'water' ? 0 : (center.slope as number | null),
      landable: (mode === 'FLYING' ? this.envelope.landable : isLandable(this.footprint)) as boolean | null,
      envelope: this.envelope.ok ? 'ok' : (this.envelope.failure ?? ''),
      surface: center.perch ? 'rock' : center.kind,
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
    this.dustBurst.dispose();
    this.rippleBurst?.dispose();
    this.landingCue.dispose();
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
