import * as THREE from 'three';
import { Bird, type BirdType } from './bird';
import { TerrainManager } from './terrain';
import { OceanManager } from './ocean';
import { RingManager } from './rings';
import { SplashEffect } from './splash';
import { CloudManager } from './clouds';
import { RingBurstEffect } from './ringBurst';
import { WindAudio, SoundEffects } from './audio';
import type { HandControlState } from './handControls';

export type MapType = 'mountain' | 'ocean';

export const MAP_OPTIONS: { id: MapType; name: string; tagline: string }[] = [
  { id: 'mountain', name: 'Mountain Valley', tagline: 'Rolling procedural hills.' },
  { id: 'ocean', name: 'Tropical Ocean & Islands', tagline: 'Skim the waves between palm-dotted islands.' },
];

export type WeatherPreset = 'sunny' | 'sunset' | 'night';

export const WEATHER_OPTIONS: { id: WeatherPreset; name: string; tagline: string }[] = [
  { id: 'sunny', name: 'Sunny Morning', tagline: 'Bright skies and warm light.' },
  { id: 'sunset', name: 'Sunset Gold', tagline: 'Golden hour glow across the horizon.' },
  { id: 'night', name: 'Starry Night', tagline: 'Cool moonlight under a field of stars.' },
];

interface WeatherLook {
  skyTop: string;
  skyBottom: string;
  fogMountain: string;
  fogOcean: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fillColor: string;
  ambientColor: string;
  ambientIntensity: number;
  stars: boolean;
}

const WEATHER_LOOKS: Record<WeatherPreset, WeatherLook> = {
  sunny: {
    skyTop: '#7ec3e0',
    skyBottom: '#fdeecb',
    fogMountain: '#dcefe6',
    fogOcean: '#bfe6ef',
    sunColor: '#ffdfb0',
    sunIntensity: 1.15,
    hemiSky: '#fff3df',
    hemiGround: '#9fcf9a',
    hemiIntensity: 0.9,
    fillColor: '#bcd8ff',
    ambientColor: '#ffffff',
    ambientIntensity: 0.15,
    stars: false,
  },
  sunset: {
    skyTop: '#5b6ea8',
    skyBottom: '#ff9f6b',
    fogMountain: '#ffcf9e',
    fogOcean: '#ffb98f',
    sunColor: '#ff7f4d',
    sunIntensity: 1.0,
    hemiSky: '#ffd9a0',
    hemiGround: '#7a5a4a',
    hemiIntensity: 0.7,
    fillColor: '#8a6bb0',
    ambientColor: '#ff9d6e',
    ambientIntensity: 0.18,
    stars: false,
  },
  night: {
    skyTop: '#050c24',
    skyBottom: '#182848',
    fogMountain: '#101a33',
    fogOcean: '#0b1830',
    sunColor: '#9fb4ff',
    sunIntensity: 0.55,
    hemiSky: '#4a5a8f',
    hemiGround: '#141d33',
    hemiIntensity: 0.35,
    fillColor: '#5c73b0',
    ambientColor: '#8fa5ff',
    ambientIntensity: 0.12,
    stars: true,
  },
};

export interface GameEngineOptions {
  birdType: BirdType;
  mapType: MapType;
  weather: WeatherPreset;
  ringChallenge: boolean;
  onScoreChange?: (score: number) => void;
  onBarrelRoll?: () => void;
}

const BASE_SPEED = 9;
const BOOST_SPEED = 20;
const SPEED_LERP = 0.04;
const RING_SPEED_PULSE = 7;
const SPEED_PULSE_DECAY_PER_SEC = 9;

const BASE_FOV = 58;
const BOOST_FOV = 72;
const FOV_LERP = 0.06;

const CAMERA_LERP = 0.05;
const CAMERA_BACK_DISTANCE = 6.5;
const CAMERA_HEIGHT = 2.2;
const LOOK_AHEAD_DISTANCE = 8;

const MAX_PITCH_ANGLE = THREE.MathUtils.degToRad(38);
const MAX_ROLL_ANGLE = THREE.MathUtils.degToRad(48);
const ORIENTATION_LERP = 0.06;

const FLIP_DURATION = 0.8; // seconds, per spec

const MIN_FLAP_SPEED = 3;
const MAX_FLAP_SPEED = 17;
const GLIDE_PITCH_THRESHOLD = -0.15; // diving hard enough (while not boosting) reads as a glide
const GLIDE_FLAP_MULTIPLIER = 0.55;

/** Smoothly ease in/out — used for the barrel roll sweep. */
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

  private sun!: THREE.DirectionalLight;
  private starfield: THREE.Points | null = null;

  private clouds: CloudManager;
  private rings: RingManager | null;
  private splash: SplashEffect | null;
  private ringBurst: RingBurstEffect | null;
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

  private flipProgress: number | null = null; // null when not flipping
  private flipStartRoll = 0;

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
    } else {
      this.environment = new TerrainManager(this.scene);
      this.ocean = null;
      this.splash = null;
    }
    this.clouds = new CloudManager(this.scene);
    this.rings = options.ringChallenge ? new RingManager(this.scene) : null;
    this.ringBurst = options.ringChallenge ? new RingBurstEffect(this.scene) : null;

    this.bird = new Bird(options.birdType);
    this.bird.group.position.set(0, 26, 0);
    this.scene.add(this.bird.group);

    this.environment.update(this.bird.group.position);

    window.addEventListener('resize', this.handleResize);
  }

  private buildSky(look: WeatherLook) {
    // Soft gradient sky using a large inverted sphere with a vertex-colored gradient,
    // tinted per the selected day/night/weather preset.
    const skyGeometry = new THREE.SphereGeometry(900, 24, 16);
    const colorTop = new THREE.Color(look.skyTop);
    const colorBottom = new THREE.Color(look.skyBottom);
    const position = skyGeometry.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i);
      const t = THREE.MathUtils.clamp((y + 900) / 1800, 0, 1);
      const c = colorBottom.clone().lerp(colorTop, t);
      colors.push(c.r, c.g, c.b);
    }
    skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const skyMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(sky);

    if (look.stars) {
      this.buildStarfield();
    }

    // A handful of soft, distant background cloud puffs for horizon-level atmosphere —
    // separate from CloudManager's nearer, flyable clusters.
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: look.stars ? 0.18 : 0.85,
      flatShading: true,
      fog: true,
    });
    for (let i = 0; i < 24; i += 1) {
      const cluster = new THREE.Group();
      const puffCount = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffCount; p += 1) {
        const puff = new THREE.Mesh(
          new THREE.IcosahedronGeometry(3 + Math.random() * 2.5, 0),
          cloudMaterial,
        );
        puff.position.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8);
        cluster.add(puff);
      }
      const angle = Math.random() * Math.PI * 2;
      const radius = 120 + Math.random() * 500;
      cluster.position.set(
        Math.cos(angle) * radius,
        40 + Math.random() * 60,
        Math.sin(angle) * radius,
      );
      this.scene.add(cluster);
    }
  }

  private buildStarfield() {
    const starCount = 900;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const radius = 850;
      const theta = Math.random() * Math.PI * 2;
      // Bias toward the upper hemisphere so stars sit mostly overhead/ahead, not underfoot.
      const phi = Math.acos(Math.random() * 2 - 1) * 0.55;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) * 0.6 + 80;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: '#ffffff',
      size: 2.2,
      sizeAttenuation: false,
      fog: false,
      transparent: true,
      opacity: 0.9,
    });
    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;
    this.scene.add(stars);
    this.starfield = stars;
  }

  private buildLighting(look: WeatherLook) {
    const hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(look.ambientColor, look.ambientIntensity);
    this.scene.add(ambient);

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
    if (!state.handDetected) return;

    this.targetPitch = state.pitch;
    this.targetRoll = state.roll;

    const wasBoosting = this.boosting;
    this.boosting = state.boost;

    // The barrel roll now fires automatically the instant a fist closes (boost starts),
    // instead of needing a separate fast wrist-flick gesture.
    if (!wasBoosting && this.boosting && this.flipProgress === null) {
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

    const pitchAngle = this.currentPitch * MAX_PITCH_ANGLE;
    // `steeringRollAngle` is the player's actual steering input and is the ONLY thing
    // allowed to change heading/yaw. `visualRollAngle` is what actually gets applied to
    // the bird's mesh/camera roll, which during a barrel roll sweeps a full 360 degrees —
    // previously that sweep was fed into the turn-rate calculation too, so every barrel
    // roll also spun the bird's heading wildly off course. Keeping them separate fixes it.
    const steeringRollAngle = this.currentRoll * MAX_ROLL_ANGLE;
    let visualRollAngle = steeringRollAngle;

    // Barrel roll: sweep a full 360 degrees on top of the steering roll over 0.8s.
    if (this.flipProgress !== null) {
      this.flipProgress += dt / FLIP_DURATION;
      if (this.flipProgress >= 1) {
        this.flipProgress = null;
      } else {
        const sweep = easeInOutCubic(this.flipProgress) * Math.PI * 2;
        visualRollAngle = this.flipStartRoll * MAX_ROLL_ANGLE + sweep;
      }
    }

    // Turning: bank angle steers yaw, like a real glider — but heading is locked while a
    // barrel roll is in progress, so boosting always continues straight ahead.
    if (this.flipProgress === null) {
      this.headingYaw -= steeringRollAngle * dt * 0.6;
    }

    this.speedPulse = Math.max(0, this.speedPulse - SPEED_PULSE_DECAY_PER_SEC * dt);
    const targetSpeed = (this.boosting ? BOOST_SPEED : BASE_SPEED) + this.speedPulse;
    this.speed += (targetSpeed - this.speed) * SPEED_LERP;

    const forward = new THREE.Vector3(
      Math.sin(this.headingYaw) * Math.cos(pitchAngle),
      Math.sin(pitchAngle),
      Math.cos(this.headingYaw) * Math.cos(pitchAngle),
    ).normalize();

    const bird = this.bird.group;
    bird.position.addScaledVector(forward, this.speed * dt);

    const minAltitude = this.environment.heightAtWorld(bird.position.x, bird.position.z) + 3.5;
    if (bird.position.y < minAltitude) bird.position.y = minAltitude;
    if (bird.position.y > 140) bird.position.y = 140;

    // The bird mesh's beak/head faces local +Z, which is the same axis `forward` above is
    // built from — so setting yaw to headingYaw directly (no extra 180deg offset) makes the
    // beak point the way the bird is actually flying, away from the chase camera, instead of
    // staring back at it.
    bird.rotation.order = 'YXZ';
    bird.rotation.y = this.headingYaw;
    bird.rotation.x = -pitchAngle;
    bird.rotation.z = visualRollAngle;

    // Wing-flap speed now tracks actual flight speed continuously (fast during boost,
    // slower cruising otherwise) instead of a binary boosting/not-boosting switch, and
    // eases further when diving un-boosted for a proper "gliding" look.
    let flapSpeed = THREE.MathUtils.mapLinear(this.speed, BASE_SPEED, BOOST_SPEED, 7, MAX_FLAP_SPEED);
    if (!this.boosting && pitchAngle < GLIDE_PITCH_THRESHOLD) {
      flapSpeed *= GLIDE_FLAP_MULTIPLIER;
    }
    flapSpeed = THREE.MathUtils.clamp(flapSpeed, MIN_FLAP_SPEED, MAX_FLAP_SPEED);
    this.bird.update(dt, flapSpeed);

    this.environment.update(bird.position);
    this.clouds.update(dt, bird.position, forward);

    if (this.rings) {
      const collectedAt = this.rings.update(dt, bird.position, forward, (x, z) => this.environment.heightAtWorld(x, z));
      if (collectedAt) {
        this.score += 1;
        this.speedPulse = RING_SPEED_PULSE;
        this.sfx.playChime();
        this.ringBurst?.trigger(collectedAt);
        this.options.onScoreChange?.(this.score);
      }
    }
    this.ringBurst?.update(dt);

    if (this.splash && this.ocean) {
      const waterSurfaceY = this.ocean.heightAtWorld(bird.position.x, bird.position.z);
      const isOverWater = this.ocean.isOverWater(bird.position.x, bird.position.z);
      this.splash.update(dt, bird.position, forward, waterSurfaceY, isOverWater);
    }
    this.ocean?.animateWater(dt);

    // Camera follow: heavy lerp for a floaty, relaxed feel.
    const behind = forward.clone().multiplyScalar(-CAMERA_BACK_DISTANCE);
    const desiredCameraPos = bird.position.clone().add(behind).add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
    this.cameraTarget.lerp(desiredCameraPos, CAMERA_LERP);
    this.camera.position.copy(this.cameraTarget);

    const desiredLookAt = bird.position.clone().addScaledVector(forward, LOOK_AHEAD_DISTANCE);
    this.cameraLookAt.lerp(desiredLookAt, CAMERA_LERP);
    this.camera.lookAt(this.cameraLookAt);

    const targetFov = this.boosting ? BOOST_FOV : BASE_FOV;
    this.camera.fov += (targetFov - this.camera.fov) * FOV_LERP;
    this.camera.updateProjectionMatrix();

    // Keep the sun's shadow frustum centered near the bird as it travels the endless map.
    this.sun.position.set(bird.position.x - 55, bird.position.y + 85, bird.position.z - 38);
    this.sun.target.position.copy(bird.position);
    this.sun.target.updateMatrixWorld();

    if (this.starfield) {
      this.starfield.position.set(bird.position.x, 0, bird.position.z);
    }

    const speedRatio = (this.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED);
    this.wind.setIntensity(0.3 + speedRatio);
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
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
