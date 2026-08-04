import * as THREE from 'three';

const MAX_PARTICLES = 90;
const PARTICLES_PER_BURST = 26;
const BURST_LIFETIME = 0.6;
// Heavier than the ring-burst's gravity — these are water droplets, not glowing sparks, so
// they should arc and fall back down quickly rather than hang in the air.
const GRAVITY = -14;
const BURST_SPEED_MIN = 2.5;
const BURST_SPEED_MAX = 6;

/** Builds a small soft droplet sprite texture at runtime (no image asset needed). */
function createDropletTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.45, 'rgba(200,235,255,0.75)');
  gradient.addColorStop(1, 'rgba(140,200,240,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aOpacity;
  attribute float aSize;
  varying float vOpacity;
  void main() {
    vOpacity = aOpacity;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / max(-mvPosition.z, 0.001));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 color;
  varying float vOpacity;
  void main() {
    vec4 tex = texture2D(map, gl_PointCoord);
    float alpha = tex.a * vOpacity;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(color * tex.rgb, alpha);
  }
`;

/**
 * One-shot water-droplet burst, triggered the moment the bird surfaces from underwater
 * swimming back into the air. Structurally the same custom-shader fading-particle approach
 * as `RingBurstEffect`, just retuned for blue/white droplets with stronger gravity.
 */
export class WaterBurstEffect {
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private velocities: Float32Array;
  private ages: Float32Array;
  private lifetimes: Float32Array;
  private alive: boolean[];
  private cursor = 0;
  private texture: THREE.CanvasTexture;

  constructor(private scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES).fill(BURST_LIFETIME + 1);
    this.lifetimes = new Float32Array(MAX_PARTICLES).fill(BURST_LIFETIME);
    this.alive = new Array(MAX_PARTICLES).fill(false);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES).fill(1), 1));

    this.texture = createDropletTexture();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        color: { value: new THREE.Color('#dff3ff') },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** Spawn a droplet burst at `position` — call once when the bird breaks the surface. */
  trigger(position: THREE.Vector3) {
    const sizeAttr = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;

    for (let n = 0; n < PARTICLES_PER_BURST; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;

      const theta = Math.random() * Math.PI * 2;
      // Bias the cone upward (mostly the top hemisphere) — droplets thrown up by a bird
      // breaking the surface, not scattering in every direction like the ring burst.
      const phi = Math.acos(Math.random() * 0.9);
      const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);

      this.positions[i * 3] = position.x;
      this.positions[i * 3 + 1] = position.y;
      this.positions[i * 3 + 2] = position.z;

      this.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.velocities[i * 3 + 1] = Math.cos(phi) * speed;
      this.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      this.ages[i] = 0;
      this.lifetimes[i] = BURST_LIFETIME * (0.7 + Math.random() * 0.5);
      this.alive[i] = true;
      sizeAttr.setX(i, 0.6 + Math.random() * 0.6);
    }
    sizeAttr.needsUpdate = true;
  }

  update(dt: number) {
    const opacityAttr = this.geometry.getAttribute('aOpacity') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (!this.alive[i]) {
        opacityAttr.setX(i, 0);
        continue;
      }
      this.ages[i] += dt;
      if (this.ages[i] >= this.lifetimes[i]) {
        this.alive[i] = false;
        opacityAttr.setX(i, 0);
        continue;
      }

      this.velocities[i * 3 + 1] += GRAVITY * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      const lifeRatio = 1 - this.ages[i] / this.lifetimes[i];
      opacityAttr.setX(i, lifeRatio);
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    opacityAttr.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
    this.texture.dispose();
  }
}
