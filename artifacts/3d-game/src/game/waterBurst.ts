import * as THREE from 'three';

const MAX_PARTICLES = 90;

/**
 * Tuning of one burst flavour. The defaults are the surfacing splash: water droplets, heavier than
 * the ring-burst's gravity so they arc and fall back quickly rather than hang in the air. The same
 * pooled effect, retuned, makes the touchdown dust and sand puffs and the paddling ripples.
 */
export interface BurstStyle {
  color: string;
  count: number;
  lifetime: number;
  gravity: number;
  speedMin: number;
  speedMax: number;
  /** 0..1: how much the burst is thrown up (1 = the upper hemisphere) vs. spread flat. */
  upward: number;
  size: number;
  /** Additive (glowing droplets) or normal blending (opaque dust). */
  additive: boolean;
}

export const SPLASH_BURST: BurstStyle = {
  color: '#dff3ff',
  count: 26,
  lifetime: 0.6,
  gravity: -14,
  speedMin: 2.5,
  speedMax: 6,
  upward: 0.9,
  size: 0.6,
  additive: true,
};

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
  private style: BurstStyle;
  private activeCount = 0;

  constructor(
    private scene: THREE.Scene,
    style: Partial<BurstStyle> = {},
  ) {
    this.style = { ...SPLASH_BURST, ...style };
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES).fill(this.style.lifetime + 1);
    this.lifetimes = new Float32Array(MAX_PARTICLES).fill(this.style.lifetime);
    this.alive = new Array(MAX_PARTICLES).fill(false);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES).fill(1), 1));

    this.texture = createDropletTexture();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        color: { value: new THREE.Color(this.style.color) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: this.style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** Retints the particles (e.g. dust on grass vs. sand on a beach). */
  setColor(color: THREE.Color) {
    ((this.points.material as THREE.ShaderMaterial).uniforms.color.value as THREE.Color).copy(color);
  }

  /** Spawn a burst at `position` (copied, not kept); `scale` scales its particle count. */
  trigger(position: THREE.Vector3, scale = 1) {
    const sizeAttr = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const { count, lifetime, speedMin, speedMax, upward, size } = this.style;
    const particles = Math.max(1, Math.round(count * scale));
    this.activeCount = MAX_PARTICLES;

    for (let n = 0; n < particles; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;

      const theta = Math.random() * Math.PI * 2;
      // Bias the cone upward (mostly the top hemisphere) — droplets thrown up by a bird
      // breaking the surface, not scattering in every direction like the ring burst.
      const phi = Math.acos(Math.random() * upward);
      const speed = speedMin + Math.random() * (speedMax - speedMin);

      this.positions[i * 3] = position.x;
      this.positions[i * 3 + 1] = position.y;
      this.positions[i * 3 + 2] = position.z;

      this.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      this.velocities[i * 3 + 1] = Math.cos(phi) * speed;
      this.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      this.ages[i] = 0;
      this.lifetimes[i] = lifetime * (0.7 + Math.random() * 0.5);
      this.alive[i] = true;
      sizeAttr.setX(i, size * (1 + Math.random()));
    }
    sizeAttr.needsUpdate = true;
  }

  update(dt: number) {
    // Nothing alive since the last update: skip the attribute uploads entirely.
    if (this.activeCount === 0) return;
    let alive = 0;
    const gravity = this.style.gravity;
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

      alive += 1;
      this.velocities[i * 3 + 1] += gravity * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      const lifeRatio = 1 - this.ages[i] / this.lifetimes[i];
      opacityAttr.setX(i, lifeRatio);
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    opacityAttr.needsUpdate = true;
    this.activeCount = alive;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
    this.texture.dispose();
  }
}
