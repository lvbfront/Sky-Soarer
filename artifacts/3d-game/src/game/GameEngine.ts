import * as THREE from 'three';
import { Bird, type BirdType } from './bird';
import { TerrainManager } from './terrain';
import { OceanManager } from './ocean';
import { RingManager } from './rings';
import { SplashEffect } from './splash';
import { WindAudio, SoundEffects } from './audio';
import type { HandControlState } from './handControls';

export type MapType = 'mountain' | 'ocean';

export const MAP_OPTIONS: { id: MapType; name: string; tagline: string }[] = [
  { id: 'mountain', name: 'Mountain Valley', tagline: 'Rolling procedural hills.' },
  { id: 'ocean', name: 'Tropical Ocean & Islands', tagline: 'Skim the waves between palm-dotted islands.' },
];

export interface GameEngineOptions {
  birdType: BirdType;
  mapType: MapType;
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

  private rings: RingManager | null;
  private splash: SplashEffect | null;
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

    this.scene = new THREE.Scene();
    const isOcean = options.mapType === 'ocean';
    this.scene.background = new THREE.Color(isOcean ? '#bfe6ef' : '#cfe8f0');
    this.scene.fog = new THREE.FogExp2(isOcean ? 0xbfe6ef : 0xdcefe6, 0.0068);

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
    container.appendChild(this.renderer.domElement);

    this.buildSky(isOcean);
    this.buildLighting();

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
    this.rings = options.ringChallenge ? new RingManager(this.scene) : null;

    this.bird = new Bird(options.birdType);
    this.bird.group.position.set(0, 26, 0);
    this.scene.add(this.bird.group);

    this.environment.update(this.bird.group.position);

    window.addEventListener('resize', this.handleResize);
  }

  private buildSky(isOcean: boolean) {
    // Soft pastel gradient sky using a large inverted sphere with a vertex-colored gradient.
    const skyGeometry = new THREE.SphereGeometry(900, 24, 16);
    const colorTop = new THREE.Color(isOcean ? '#7ec3e0' : '#a9d3e6');
    const colorBottom = new THREE.Color(isOcean ? '#fdeecb' : '#fbe3c9');
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

    // A handful of soft cloud puffs made of low-poly spheres drifting overhead.
    const cloudMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.85,
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

  private buildLighting() {
    const hemi = new THREE.HemisphereLight(0xfff3df, 0x9fcf9a, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffdfb0, 1.1);
    sun.position.set(-60, 90, -40);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.35);
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
    let rollAngle = this.currentRoll * MAX_ROLL_ANGLE;

    // Barrel roll: sweep a full 360 degrees on top of the steering roll over 0.8s.
    if (this.flipProgress !== null) {
      this.flipProgress += dt / FLIP_DURATION;
      if (this.flipProgress >= 1) {
        this.flipProgress = null;
      } else {
        const sweep = easeInOutCubic(this.flipProgress) * Math.PI * 2;
        rollAngle = this.flipStartRoll * MAX_ROLL_ANGLE + sweep;
      }
    }

    // Turning: bank angle steers yaw, like a real glider.
    this.headingYaw -= rollAngle * dt * 0.6;

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
    bird.rotation.z = rollAngle;

    const flapSpeed = this.boosting ? 16 : 7;
    this.bird.update(dt, flapSpeed);

    this.environment.update(bird.position);

    if (this.rings) {
      const collected = this.rings.update(dt, bird.position, forward, (x, z) => this.environment.heightAtWorld(x, z));
      if (collected) {
        this.score += 1;
        this.speedPulse = RING_SPEED_PULSE;
        this.sfx.playChime();
        this.options.onScoreChange?.(this.score);
      }
    }

    if (this.splash && this.ocean) {
      const waterSurfaceY = this.ocean.heightAtWorld(bird.position.x, bird.position.z);
      const isOverWater = this.ocean.isOverWater(bird.position.x, bird.position.z);
      this.splash.update(dt, bird.position, forward, waterSurfaceY, isOverWater);
    }

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
    this.rings?.dispose();
    this.splash?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
