import * as THREE from 'three';
import { gsap } from 'gsap';
import { Bird, type BirdType } from './bird';
import { TerrainManager } from './terrain';
import { OceanManager } from './ocean';
import { CloudManager } from './clouds';
import { WEATHER_LOOKS, type MapType, type WeatherLook, type WeatherPreset } from './presets';
import { createSkyClouds, createSkyDome, createStarfield, paintSkyGradient } from './sky';

/**
 * The landing page's persistent 3D backdrop ("The Ascent"). A scroll progress value in 0..1
 * drives the bird's altitude and the camera shot, from gliding just above the ground (hero) up
 * through a cloud layer to above the clouds (takeoff). It reuses the game's own bird, terrain,
 * ocean, cloud and sky code, but none of GameEngine's flight physics: nothing here reads hand
 * input, and GameEngine is untouched by it.
 *
 * Lifecycle matches the other managers: construct into a container, call the setters as the
 * page changes, and `dispose()` before the GameEngine starts, which frees every geometry,
 * material and texture and releases the WebGL context.
 */

export interface LandingTelemetry {
  /** Displayed altitude in meters (stylized: chapter stops read 0 / 300 / 1,200 / 3,000 / 5,000). */
  altitude: number;
  /** Vertical speed in m/s, derived from the displayed altitude. */
  verticalSpeed: number;
  speedKnots: number;
  headingDeg: number;
  lat: number;
  lon: number;
}

export interface LandingSceneOptions {
  bird: BirdType;
  map: MapType;
  weather: WeatherPreset;
  reducedMotion: boolean;
  /** Called once per rendered frame; throttle any DOM work on the receiving side. */
  onTelemetry?: (telemetry: LandingTelemetry) => void;
}

type Vec3Tuple = [number, number, number];

interface Shot {
  /** Bird altitude in world units (the bird also never drops below the ground-clearance floor). */
  y: number;
  /** Altitude shown on the page at this stop. */
  meters: number;
  /** Camera offset from the bird, world axes (the bird flies toward +Z, so screen-right is -X). */
  cam: Vec3Tuple;
  /** Look-at offset from the bird. */
  look: Vec3Tuple;
  /** Shifts the look target toward screen-left by this much, which frames the bird right of center. */
  shift: number;
  fov: number;
  /** Extra visual yaw so the showcase shot sees the bird three-quarter on. */
  yaw: number;
}

// One camera/altitude stop per chapter; scroll progress interpolates between neighbors.
const SHOTS: Shot[] = [
  // 0 Hero: a side-on tracking shot, low over the ground; the bird crosses the lower third and
  // the huge title sits over open sky.
  { y: 8, meters: 0, cam: [-8.6, 1.2, 5.4], look: [0, 1.5, 0.6], shift: 0, fov: 46, yaw: 0 },
  // 1 Bird: tight, telephoto three-quarter portrait, bird on the right of the screen.
  { y: 30, meters: 300, cam: [-7, 0.9, 3.8], look: [0, 0.2, 0], shift: 2.3, fov: 32, yaw: -0.32 },
  // 2 World: high and behind, looking down across the landscape. Positive X puts the camera on
  // the bird's screen-left, so the bird sits right of the text column.
  { y: 62, meters: 1200, cam: [8, 15, -22], look: [0, -6, 24], shift: 3, fov: 55, yaw: 0 },
  // 3 Sky: just above the cloud deck, low camera looking up into the sky.
  { y: 150, meters: 3000, cam: [3.4, -2.2, -9], look: [0, 6.5, 14], shift: 1.2, fov: 60, yaw: 0 },
  // 4 Takeoff: wide, over a sea of cloud.
  { y: 180, meters: 5000, cam: [5, 2.1, -9.5], look: [0, 0.6, 14], shift: 1.6, fov: 50, yaw: 0 },
];

const FORWARD_SPEED = 11; // world units/s along +Z
// Displayed airspeed: a relaxed glide, nudged up while climbing between chapters.
const CRUISE_KNOTS = 34;
const WEAVE_AMPLITUDE = 9;
const WEAVE_FREQ = 0.11;
const GROUND_CLEARANCE = 5.5;
const CAMERA_GROUND_CLEARANCE = 1.6;
// Frame-rate independent chase rates (per second) for 1 - exp(-k * dt) smoothing.
const PROGRESS_CHASE = 5;
const POINTER_CHASE = 3;
const ALTITUDE_FLOOR_CHASE = 3;

// The cloud deck the bird climbs through between the World and Sky chapters.
const CLOUD_DECK_Y = 105;
const CLOUD_DECK_THICKNESS = 7;
const CLOUD_DECK_HALF_EXTENT = 420;
const CLOUD_DECK_PUFFS = 320;
// The deck only exists from the World chapter up; from the ground its underside would read as a
// flat grey ceiling. The game's flyable CloudManager clusters appear from the same point.
const CLOUDS_VISIBLE_FROM_CAMERA_Y = 55;

const FOG_DENSITY_LOW = 0.0068; // same as in-game
const FOG_DENSITY_HIGH = 0.0036;
const FOG_DENSITY_IN_CLOUD = 0.045;
const FOG_DENSITY_MAP_SWAP = 0.05;

const WEATHER_FADE_SECONDS = 1.4;
const MAP_FADE_IN_SECONDS = 0.45;
const MAP_FADE_OUT_SECONDS = 0.7;

// Fictional-but-plausible origins for the telemetry coordinates readout (1 world unit ~ 10 m).
const MAP_ORIGINS: Record<MapType, { lat: number; lon: number }> = {
  mountain: { lat: 46.5584, lon: 8.0261 },
  ocean: { lat: -17.6509, lon: -149.426 },
};
const METERS_PER_UNIT = 10;
const METERS_PER_DEGREE = 111_320;

function smootherstep(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function chase(k: number, dt: number) {
  return 1 - Math.exp(-k * dt);
}

function lerpTuple(out: THREE.Vector3, a: Vec3Tuple, b: Vec3Tuple, t: number) {
  return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/** Resolved, numeric version of a WeatherLook so two presets can be blended every frame. */
interface LookState {
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fogMountain: THREE.Color;
  fogOcean: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fillColor: THREE.Color;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  stars: number;
}

function resolveLook(look: WeatherLook): LookState {
  return {
    skyTop: new THREE.Color(look.skyTop),
    skyBottom: new THREE.Color(look.skyBottom),
    fogMountain: new THREE.Color(look.fogMountain),
    fogOcean: new THREE.Color(look.fogOcean),
    sunColor: new THREE.Color(look.sunColor),
    sunIntensity: look.sunIntensity,
    hemiSky: new THREE.Color(look.hemiSky),
    hemiGround: new THREE.Color(look.hemiGround),
    hemiIntensity: look.hemiIntensity,
    fillColor: new THREE.Color(look.fillColor),
    ambientColor: new THREE.Color(look.ambientColor),
    ambientIntensity: look.ambientIntensity,
    stars: look.stars ? 1 : 0,
  };
}

function copyLook(out: LookState, from: LookState) {
  out.skyTop.copy(from.skyTop);
  out.skyBottom.copy(from.skyBottom);
  out.fogMountain.copy(from.fogMountain);
  out.fogOcean.copy(from.fogOcean);
  out.sunColor.copy(from.sunColor);
  out.sunIntensity = from.sunIntensity;
  out.hemiSky.copy(from.hemiSky);
  out.hemiGround.copy(from.hemiGround);
  out.hemiIntensity = from.hemiIntensity;
  out.fillColor.copy(from.fillColor);
  out.ambientColor.copy(from.ambientColor);
  out.ambientIntensity = from.ambientIntensity;
  out.stars = from.stars;
}

function blendLook(out: LookState, a: LookState, b: LookState, t: number) {
  out.skyTop.lerpColors(a.skyTop, b.skyTop, t);
  out.skyBottom.lerpColors(a.skyBottom, b.skyBottom, t);
  out.fogMountain.lerpColors(a.fogMountain, b.fogMountain, t);
  out.fogOcean.lerpColors(a.fogOcean, b.fogOcean, t);
  out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
  out.sunIntensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, t);
  out.fillColor.lerpColors(a.fillColor, b.fillColor, t);
  out.ambientColor.lerpColors(a.ambientColor, b.ambientColor, t);
  out.ambientIntensity = THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, t);
  out.stars = THREE.MathUtils.lerp(a.stars, b.stars, t);
}

/** Frees every geometry, material and material texture under `root`, each exactly once. */
function disposeObjectTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    const renderable = child as THREE.Mesh | THREE.Points;
    if (renderable.geometry) geometries.add(renderable.geometry);
    const material = (renderable as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => materials.add(m));
    else if (material) materials.add(material);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    m.dispose();
  });
}

export class LandingScene {
  private container: HTMLElement;
  private options: LandingSceneOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private sky: THREE.Mesh;
  private starfield: THREE.Points;
  private skyClouds: THREE.Group;
  private skyCloudMaterial: THREE.MeshStandardMaterial;
  private cloudDeck: THREE.InstancedMesh;
  private cloudDeckBase: Float32Array;
  private hemi: THREE.HemisphereLight;
  private ambient: THREE.AmbientLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private fog: THREE.FogExp2;

  // Each map lives in its own sub-scene so switching maps only flips visibility; the second map
  // is built lazily the first time it's chosen.
  private terrainRoot = new THREE.Scene();
  private oceanRoot = new THREE.Scene();
  private terrain: TerrainManager | null = null;
  private ocean: OceanManager | null = null;
  private map: MapType;
  private mapBlend: { value: number };
  private mapFade = { value: 0 };

  private clouds: CloudManager;
  private cloudRoot = new THREE.Scene();
  private cloudDeckMaterial: THREE.MeshStandardMaterial;

  private birdHolder = new THREE.Group();
  private bird: Bird;
  private birdType: BirdType;

  private weather: WeatherPreset;
  private lookFrom: LookState;
  private lookTo: LookState;
  private look: LookState;
  private lookTween = { t: 1 };
  private lookDirty = true;

  private targetProgress = 0;
  private progress = 0;
  private pointerTarget = new THREE.Vector2();
  private pointer = new THREE.Vector2();
  private intro = { t: 0 };

  private time = 0;
  private lastFrame = 0;
  private rafId: number | null = null;
  private paused = false;
  private disposed = false;
  private altitudeFloor = 0;
  private prevMeters = 0;
  private verticalSpeed = 0;
  private resetVerticalSpeed = true;

  // Scratch objects, reused every frame to avoid per-frame allocation.
  private readonly camOffset = new THREE.Vector3();
  private readonly camOffsetB = new THREE.Vector3();
  private readonly lookOffset = new THREE.Vector3();
  private readonly lookOffsetB = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly instanceQuat = new THREE.Quaternion();
  private readonly instancePos = new THREE.Vector3();
  private readonly instanceScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly whiteout = new THREE.Color('#f4f7fb');

  constructor(container: HTMLElement, options: LandingSceneOptions) {
    this.container = container;
    this.options = options;
    this.map = options.map;
    this.birdType = options.bird;
    this.weather = options.weather;
    this.mapBlend = { value: options.map === 'ocean' ? 1 : 0 };

    // Throws when WebGL is unavailable; the caller falls back to a CSS sky.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Slightly below the game's cap of 2: the landing is mostly soft sky, and this keeps the
    // scroll smooth on high-DPI laptops.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in r185 and falls back to this anyway (CLAUDE.md §9 #17).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(SHOTS[0].fov, container.clientWidth / container.clientHeight, 0.1, 1400);

    const look = resolveLook(WEATHER_LOOKS[options.weather]);
    this.look = look;
    this.lookFrom = resolveLook(WEATHER_LOOKS[options.weather]);
    this.lookTo = resolveLook(WEATHER_LOOKS[options.weather]);

    this.fog = new THREE.FogExp2(look.fogMountain.getHex(), FOG_DENSITY_LOW);
    this.scene.fog = this.fog;
    this.scene.background = look.skyTop.clone();

    this.sky = createSkyDome(look.skyTop, look.skyBottom);
    this.scene.add(this.sky);
    this.starfield = createStarfield();
    this.scene.add(this.starfield);
    const skyClouds = createSkyClouds(0.85);
    this.skyClouds = skyClouds.group;
    this.skyCloudMaterial = skyClouds.material;
    this.scene.add(this.skyClouds);

    this.hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity);
    this.ambient = new THREE.AmbientLight(look.ambientColor, look.ambientIntensity);
    this.sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -60;
    this.sun.shadow.camera.right = 60;
    this.sun.shadow.camera.top = 60;
    this.sun.shadow.camera.bottom = -60;
    this.sun.shadow.bias = -0.0025;
    this.fill = new THREE.DirectionalLight(look.fillColor, 0.3);
    this.scene.add(this.hemi, this.ambient, this.sun, this.sun.target, this.fill);

    this.scene.add(this.terrainRoot, this.oceanRoot);
    this.ensureMap(this.map);
    this.terrainRoot.visible = this.map === 'mountain';
    this.oceanRoot.visible = this.map === 'ocean';

    this.scene.add(this.cloudRoot);
    this.clouds = new CloudManager(this.cloudRoot);

    const deck = this.buildCloudDeck();
    this.cloudDeck = deck.mesh;
    this.cloudDeckBase = deck.base;
    this.cloudDeckMaterial = deck.material;
    this.cloudRoot.add(this.cloudDeck);

    this.bird = new Bird(options.bird);
    this.birdHolder.add(this.bird.group);
    this.birdHolder.position.set(0, SHOTS[0].y + 12, 0);
    this.scene.add(this.birdHolder);

    this.altitudeFloor = this.groundClearanceAt(0, 0);

    window.addEventListener('resize', this.handleResize);
  }

  /** A deck of flat-shaded puffs, drawn as one instanced mesh and wrapped around the bird on XZ. */
  private buildCloudDeck() {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    // A sky-tinted emissive lifts the shaded faces, so the deck reads as soft cloud rather than rock.
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      flatShading: true,
      roughness: 1,
      metalness: 0,
      emissive: '#ffffff',
      emissiveIntensity: 0.35,
      fog: true,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, CLOUD_DECK_PUFFS);
    mesh.frustumCulled = false;
    // Per puff: base x, base z, y offset, horizontal scale, vertical scale, yaw.
    const base = new Float32Array(CLOUD_DECK_PUFFS * 6);
    for (let i = 0; i < CLOUD_DECK_PUFFS; i += 1) {
      const scale = 9 + Math.random() * 16;
      base[i * 6] = (Math.random() * 2 - 1) * CLOUD_DECK_HALF_EXTENT;
      base[i * 6 + 1] = (Math.random() * 2 - 1) * CLOUD_DECK_HALF_EXTENT;
      base[i * 6 + 2] = (Math.random() * 2 - 1) * CLOUD_DECK_THICKNESS;
      base[i * 6 + 3] = scale;
      base[i * 6 + 4] = scale * (0.4 + Math.random() * 0.25);
      base[i * 6 + 5] = Math.random() * Math.PI;
    }
    return { mesh, base, material };
  }

  private ensureMap(map: MapType) {
    if (map === 'mountain' && !this.terrain) this.terrain = new TerrainManager(this.terrainRoot);
    if (map === 'ocean' && !this.ocean) this.ocean = new OceanManager(this.oceanRoot);
  }

  private get environment() {
    return this.map === 'ocean' ? this.ocean! : this.terrain!;
  }

  /** Lowest safe bird altitude around (x, z), looking a little ahead so hills are cleared early. */
  private groundClearanceAt(x: number, z: number) {
    const env = this.environment;
    const h = Math.max(env.heightAtWorld(x, z), env.heightAtWorld(x, z + 12), env.heightAtWorld(x, z + 26));
    return Math.max(h, 0) + GROUND_CLEARANCE;
  }

  private handleResize = () => {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    // setSize clears the canvas; while paused, redraw the held frame at the new size.
    if (this.paused && !this.disposed) this.renderer.render(this.scene, this.camera);
  };

  start() {
    if (this.rafId !== null || this.disposed || this.paused) return;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Pausing stops the frame loop entirely (no update, no render), so the backdrop costs nothing
   * while MediaPipe is tracking on the same main thread during calibration. The canvas keeps
   * showing the last rendered frame. Resuming restarts the loop without a time jump.
   */
  setPaused(paused: boolean) {
    if (paused === this.paused || this.disposed) return;
    this.paused = paused;
    if (paused) {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    } else {
      this.start();
    }
  }

  /** Cinematic dolly-in from high and far back; skipped under prefers-reduced-motion. */
  playIntro() {
    if (this.options.reducedMotion) return;
    gsap.killTweensOf(this.intro);
    this.intro.t = 1;
    gsap.to(this.intro, { t: 0, duration: 3.2, ease: 'power3.out' });
  }

  /** Scroll progress 0 (hero) .. 1 (takeoff). `instant` jumps there (used for reduced motion). */
  setProgress(progress: number, instant = false) {
    this.targetProgress = THREE.MathUtils.clamp(progress, 0, 1);
    if (instant) {
      this.progress = this.targetProgress;
      // A cut is not a climb: don't let it spike the vertical-speed readout.
      this.resetVerticalSpeed = true;
    }
  }

  /** Normalized pointer position, -1..1 on both axes (y up). Ignored under reduced motion. */
  setPointer(x: number, y: number) {
    if (this.options.reducedMotion) return;
    this.pointerTarget.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  setBird(type: BirdType) {
    if (type === this.birdType) return;
    this.birdType = type;
    const outgoing = this.bird;
    const incoming = new Bird(type);
    this.bird = incoming;
    this.birdHolder.add(incoming.group);

    const removeOutgoing = () => {
      this.birdHolder.remove(outgoing.group);
      disposeObjectTree(outgoing.group);
    };
    gsap.killTweensOf([outgoing.group.scale, outgoing.group.rotation]);

    if (this.options.reducedMotion) {
      removeOutgoing();
      return;
    }
    gsap.to(outgoing.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, ease: 'power2.in', onComplete: removeOutgoing });
    gsap.to(outgoing.group.rotation, { y: outgoing.group.rotation.y + Math.PI * 0.8, duration: 0.35, ease: 'power2.in' });
    incoming.group.scale.setScalar(0.001);
    incoming.group.rotation.y = -Math.PI * 0.8;
    gsap.to(incoming.group.scale, { x: 1, y: 1, z: 1, duration: 0.9, delay: 0.18, ease: 'back.out(1.5)' });
    gsap.to(incoming.group.rotation, { y: 0, duration: 1.1, delay: 0.18, ease: 'power3.out' });
  }

  /** Switches the world under the bird, hidden inside a brief fog dip. */
  setMap(map: MapType) {
    if (map === this.map) return;
    gsap.killTweensOf([this.mapFade, this.mapBlend]);
    const swap = () => {
      this.map = map;
      this.ensureMap(map);
      this.terrainRoot.visible = map === 'mountain';
      this.oceanRoot.visible = map === 'ocean';
      this.environment.update(this.birdHolder.position);
      this.altitudeFloor = this.groundClearanceAt(this.birdHolder.position.x, this.birdHolder.position.z);
    };
    if (this.options.reducedMotion) {
      swap();
      this.mapBlend.value = map === 'ocean' ? 1 : 0;
      this.mapFade.value = 0;
      return;
    }
    gsap.to(this.mapBlend, { value: map === 'ocean' ? 1 : 0, duration: MAP_FADE_IN_SECONDS + MAP_FADE_OUT_SECONDS, ease: 'sine.inOut' });
    gsap
      .timeline()
      .to(this.mapFade, { value: 1, duration: MAP_FADE_IN_SECONDS, ease: 'power2.in', onComplete: swap })
      .to(this.mapFade, { value: 0, duration: MAP_FADE_OUT_SECONDS, ease: 'power2.out' });
  }

  /** Crossfades sky, fog, lights, stars and horizon clouds to another weather preset. */
  setWeather(weather: WeatherPreset) {
    if (weather === this.weather) return;
    this.weather = weather;
    copyLook(this.lookFrom, this.look);
    this.lookTo = resolveLook(WEATHER_LOOKS[weather]);
    gsap.killTweensOf(this.lookTween);
    this.lookTween.t = 0;
    if (this.options.reducedMotion) {
      this.lookTween.t = 1;
    } else {
      gsap.to(this.lookTween, { t: 1, duration: WEATHER_FADE_SECONDS, ease: 'sine.inOut' });
    }
    this.lookDirty = true;
  }

  private update(dt: number) {
    this.time += dt;

    // Progress and pointer chase their targets (frame-rate independent).
    this.progress += (this.targetProgress - this.progress) * chase(PROGRESS_CHASE, dt);
    this.pointer.lerp(this.pointerTarget, chase(POINTER_CHASE, dt));

    // Resolve which two shots we're between.
    const scaled = this.progress * (SHOTS.length - 1);
    const index = Math.min(Math.floor(scaled), SHOTS.length - 2);
    const t = smootherstep(THREE.MathUtils.clamp(scaled - index, 0, 1));
    const a = SHOTS[index];
    const b = SHOTS[index + 1];

    // --- Bird path: forward along +Z with a slow lateral weave; altitude from the shot. -------
    const holder = this.birdHolder;
    const prevX = holder.position.x;
    const prevY = holder.position.y;
    const motion = this.options.reducedMotion ? 0.35 : 1;
    const z = holder.position.z + FORWARD_SPEED * dt;
    const x = Math.sin(this.time * WEAVE_FREQ) * WEAVE_AMPLITUDE * motion;

    this.altitudeFloor += (this.groundClearanceAt(x, z) - this.altitudeFloor) * chase(ALTITUDE_FLOOR_CHASE, dt);
    const shotY = THREE.MathUtils.lerp(a.y, b.y, t);
    const bob = Math.sin(this.time * 0.9) * 0.35 * motion;
    const y = Math.max(shotY, this.altitudeFloor) + bob;
    holder.position.set(x, y, z);

    // Heading follows the weave; bank into it like a glider; pitch with the climb.
    const vx = dt > 0 ? (x - prevX) / dt : 0;
    const vy = dt > 0 ? (y - prevY) / dt : 0;
    const heading = Math.atan2(vx, FORWARD_SPEED);
    const climbPitch = THREE.MathUtils.clamp(Math.atan2(vy, FORWARD_SPEED), -0.35, 0.5);
    holder.rotation.order = 'YXZ';
    holder.rotation.y = heading + THREE.MathUtils.lerp(a.yaw, b.yaw, t) + this.pointer.x * 0.28;
    holder.rotation.x = -(climbPitch * 0.8 + this.pointer.y * 0.12);
    holder.rotation.z = -heading * 2.2 + Math.sin(this.time * 0.6) * 0.05 * motion - this.pointer.x * 0.22;

    // Faster wingbeats while climbing, slow lazy strokes while cruising.
    const flap = THREE.MathUtils.clamp(4.2 + Math.max(0, vy) * 0.55, 3, 15);
    this.bird.update(dt, flap);

    // --- World streaming ------------------------------------------------------------------
    this.environment.update(holder.position);
    if (this.map === 'ocean') this.ocean?.animateWater(dt);
    this.cloudRoot.visible = this.camera.position.y > CLOUDS_VISIBLE_FROM_CAMERA_Y;
    if (this.cloudRoot.visible) {
      this.clouds.update(dt, holder.position, this.forward);
      this.updateCloudDeck();
    }

    // --- Camera ---------------------------------------------------------------------------
    lerpTuple(this.camOffset, a.cam, b.cam, t);
    lerpTuple(this.lookOffset, a.look, b.look, t);
    const shift = THREE.MathUtils.lerp(a.shift, b.shift, t);
    const fov = THREE.MathUtils.lerp(a.fov, b.fov, t);

    // Intro: start further back, higher and wider, then dolly in.
    const intro = this.intro.t;
    this.camOffsetB.copy(this.camOffset).multiplyScalar(1 + intro * 2.4);
    this.camOffsetB.y += intro * 9;
    this.lookOffsetB.copy(this.lookOffset);

    this.camPos.copy(holder.position).add(this.camOffsetB);
    this.lookAt.copy(holder.position).add(this.lookOffsetB);

    // Frame the bird right of center by sliding the look target toward screen-left.
    this.right.subVectors(this.lookAt, this.camPos).normalize().cross(this.up).normalize();
    this.lookAt.addScaledVector(this.right, -shift);

    // Cursor parallax: the camera drifts opposite to the pointer, a few tenths of a unit.
    this.camPos.addScaledVector(this.right, -this.pointer.x * 0.9);
    this.camPos.y += -this.pointer.y * 0.55;

    const camGround = Math.max(this.environment.heightAtWorld(this.camPos.x, this.camPos.z), 0);
    if (this.camPos.y < camGround + CAMERA_GROUND_CLEARANCE) this.camPos.y = camGround + CAMERA_GROUND_CLEARANCE;

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookAt);
    const targetFov = fov + intro * 10;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    // --- Sky, fog, light ------------------------------------------------------------------
    this.applyLook();
    this.applyFog();

    this.sun.position.set(holder.position.x - 55, holder.position.y + 85, holder.position.z - 38);
    this.sun.target.position.copy(holder.position);
    this.sun.target.updateMatrixWorld();
    this.sky.position.set(this.camPos.x, 0, this.camPos.z);
    this.skyClouds.position.set(this.camPos.x, 0, this.camPos.z);
    this.starfield.position.set(this.camPos.x, 0, this.camPos.z);

    // --- Telemetry ------------------------------------------------------------------------
    if (this.options.onTelemetry) {
      const meters = THREE.MathUtils.lerp(a.meters, b.meters, t) + (y - Math.max(shotY, this.altitudeFloor)) * METERS_PER_UNIT;
      const rawVs = dt > 0 && !this.resetVerticalSpeed ? (meters - this.prevMeters) / dt : 0;
      if (this.resetVerticalSpeed) {
        this.verticalSpeed = 0;
        this.resetVerticalSpeed = false;
      }
      this.verticalSpeed += (rawVs - this.verticalSpeed) * chase(4, dt);
      this.prevMeters = meters;
      const origin = MAP_ORIGINS[this.map];
      const headingDeg = (((-holder.rotation.y * 180) / Math.PI) % 360 + 360) % 360;
      this.options.onTelemetry({
        altitude: Math.max(0, meters),
        verticalSpeed: this.verticalSpeed,
        speedKnots: CRUISE_KNOTS + Math.sin(this.time * 0.37) * 1.2 + Math.min(Math.max(0, this.verticalSpeed) * 0.012, 14),
        headingDeg,
        lat: origin.lat + (z * METERS_PER_UNIT) / METERS_PER_DEGREE,
        lon: origin.lon + (x * METERS_PER_UNIT) / METERS_PER_DEGREE,
      });
    }
  }

  private updateCloudDeck() {
    const { x: bx, z: bz } = this.birdHolder.position;
    const span = CLOUD_DECK_HALF_EXTENT * 2;
    const base = this.cloudDeckBase;
    for (let i = 0; i < CLOUD_DECK_PUFFS; i += 1) {
      // Wrap each puff into a window centered on the bird, so the deck is endless but the bird
      // still visibly moves through it.
      const wx = ((((base[i * 6] - bx) % span) + span * 1.5) % span) - CLOUD_DECK_HALF_EXTENT + bx;
      const wz = ((((base[i * 6 + 1] - bz) % span) + span * 1.5) % span) - CLOUD_DECK_HALF_EXTENT + bz;
      this.instancePos.set(wx, CLOUD_DECK_Y + base[i * 6 + 2], wz);
      this.instanceScale.set(base[i * 6 + 3], base[i * 6 + 4], base[i * 6 + 3]);
      this.instanceQuat.setFromAxisAngle(this.up, base[i * 6 + 5]);
      this.instanceMatrix.compose(this.instancePos, this.instanceQuat, this.instanceScale);
      this.cloudDeck.setMatrixAt(i, this.instanceMatrix);
    }
    this.cloudDeck.instanceMatrix.needsUpdate = true;
  }

  private applyLook() {
    if (!this.lookDirty) return;
    blendLook(this.look, this.lookFrom, this.lookTo, this.lookTween.t);
    const look = this.look;
    paintSkyGradient(this.sky, look.skyTop, look.skyBottom);
    (this.scene.background as THREE.Color).copy(look.skyTop);
    this.hemi.color.copy(look.hemiSky);
    this.hemi.groundColor.copy(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.ambient.color.copy(look.ambientColor);
    this.ambient.intensity = look.ambientIntensity;
    this.sun.color.copy(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.fill.color.copy(look.fillColor);
    const stars = this.starfield.material as THREE.PointsMaterial;
    stars.opacity = 0.9 * look.stars;
    this.starfield.visible = look.stars > 0.01;
    // Same horizon-cloud opacities GameEngine picks: 0.85 by day, 0.18 under the stars.
    this.skyCloudMaterial.opacity = THREE.MathUtils.lerp(0.85, 0.18, look.stars);
    this.cloudDeckMaterial.emissive.copy(look.hemiSky).lerp(look.skyBottom, 0.5);
    this.cloudDeckMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.4, 0.12, look.stars);
    // Keep blending until the tween finishes, then stop repainting.
    this.lookDirty = this.lookTween.t < 1;
  }

  private applyFog() {
    const look = this.look;
    const camY = this.camera.position.y;
    // Base fog: the map's fog color, fading toward the horizon color and thinning as we climb.
    const altitudeT = THREE.MathUtils.smoothstep(camY, 40, 160);
    this.tmpColor.lerpColors(look.fogMountain, look.fogOcean, this.mapBlend.value).lerp(look.skyBottom, altitudeT * 0.6);
    let density = THREE.MathUtils.lerp(FOG_DENSITY_LOW, FOG_DENSITY_HIGH, altitudeT);

    // Inside the cloud deck: white-out.
    const inCloud = 1 - THREE.MathUtils.smoothstep(Math.abs(camY - CLOUD_DECK_Y), CLOUD_DECK_THICKNESS * 0.6, CLOUD_DECK_THICKNESS * 2.4);
    if (inCloud > 0) {
      this.tmpColor.lerp(this.whiteout, inCloud * (1 - look.stars * 0.75));
      density = THREE.MathUtils.lerp(density, FOG_DENSITY_IN_CLOUD, inCloud);
    }

    // Map swap: a brief dip into haze hides the world switching underneath.
    const fade = this.mapFade.value;
    if (fade > 0) {
      this.tmpColor.lerp(look.skyBottom, fade);
      density = THREE.MathUtils.lerp(density, FOG_DENSITY_MAP_SWAP, fade);
    }

    this.fog.color.copy(this.tmpColor);
    this.fog.density = density;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    window.removeEventListener('resize', this.handleResize);
    gsap.killTweensOf([this.intro, this.lookTween, this.mapFade, this.mapBlend]);
    this.birdHolder.children.forEach((child) => gsap.killTweensOf([child.scale, child.rotation]));

    // Everything (terrain/ocean tiles and their pools, clouds, deck, birds, sky) hangs off the
    // scene, so one traversal frees it all.
    disposeObjectTree(this.scene);
    this.clouds.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
