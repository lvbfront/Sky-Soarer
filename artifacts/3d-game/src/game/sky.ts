import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared sky-backdrop builders used by both GameEngine and LandingScene, so the landing page's
// sky is literally the same dome, starfield and horizon clouds the player later flies under.

const SKY_RADIUS = 900;
const STAR_COUNT = 900;
const STAR_RADIUS = 850;
const SKY_CLOUD_CLUSTERS = 24;

/** Writes a bottom→top vertex-color gradient onto a sky dome (safe to call again to recolor it). */
export function paintSkyGradient(sky: THREE.Mesh, top: THREE.ColorRepresentation, bottom: THREE.ColorRepresentation) {
  const geometry = sky.geometry as THREE.BufferGeometry;
  const position = geometry.attributes.position;
  const colorTop = new THREE.Color(top);
  const colorBottom = new THREE.Color(bottom);
  let colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) {
    colorAttr = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute('color', colorAttr);
  }
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const t = THREE.MathUtils.clamp((y + SKY_RADIUS) / (SKY_RADIUS * 2), 0, 1);
    c.copy(colorBottom).lerp(colorTop, t);
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  }
  colorAttr.needsUpdate = true;
}

/**
 * Soft gradient sky: a large inverted sphere with a vertex-colored gradient. Callers keep it
 * centered on the bird on XZ so the endless world never flies out of it.
 */
export function createSkyDome(top: THREE.ColorRepresentation, bottom: THREE.ColorRepresentation) {
  const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const skyMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  paintSkyGradient(sky, top, bottom);
  return sky;
}

/** Night-sky starfield, biased toward the upper hemisphere. */
export function createStarfield() {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    // Bias toward the upper hemisphere so stars sit mostly overhead/ahead, not underfoot.
    const phi = Math.acos(Math.random() * 2 - 1) * 0.55;
    positions[i * 3] = STAR_RADIUS * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(STAR_RADIUS * Math.cos(phi)) * 0.6 + 80;
    positions[i * 3 + 2] = STAR_RADIUS * Math.sin(phi) * Math.sin(theta);
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
  return stars;
}

/**
 * A handful of soft, distant background cloud puffs for horizon-level atmosphere — separate from
 * CloudManager's nearer, flyable clusters. Every puff is merged into one geometry (one draw call
 * instead of ~100), returned inside a group so the whole backdrop can follow the bird on XZ. All
 * puffs share the single returned material.
 */
export function createSkyClouds(opacity: number) {
  const skyClouds = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    transparent: true,
    opacity,
    flatShading: true,
    fog: true,
  });
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < SKY_CLOUD_CLUSTERS; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 120 + Math.random() * 500;
    const cx = Math.cos(angle) * radius;
    const cy = 40 + Math.random() * 60;
    const cz = Math.sin(angle) * radius;
    const puffCount = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffCount; p += 1) {
      const puff = new THREE.IcosahedronGeometry(3 + Math.random() * 2.5, 0);
      puff.translate(cx + (Math.random() - 0.5) * 8, cy + (Math.random() - 0.5) * 2, cz + (Math.random() - 0.5) * 8);
      puffs.push(puff);
    }
  }
  const merged = mergeGeometries(puffs, false)!;
  puffs.forEach((g) => g.dispose());
  skyClouds.add(new THREE.Mesh(merged, material));
  return { group: skyClouds, material };
}
