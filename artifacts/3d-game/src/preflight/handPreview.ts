import type { NormalizedLandmark } from '@mediapipe/hands';
import type { CalibrationPoint } from '@/game/handControls';

// Everything here is type-only on the tracking side: the landmark connection list is passed in by
// App, which gets it from the lazily loaded handControls module.

export interface CalibrationPointsMap {
  center: CalibrationPoint | null;
  topLeft: CalibrationPoint | null;
  topRight: CalibrationPoint | null;
  bottomLeft: CalibrationPoint | null;
  bottomRight: CalibrationPoint | null;
}

export const EMPTY_CALIBRATION: CalibrationPointsMap = {
  center: null,
  topLeft: null,
  topRight: null,
  bottomLeft: null,
  bottomRight: null,
};

export type CalibrationStepKey = keyof CalibrationPointsMap;

export interface CalibrationStep {
  key: CalibrationStepKey;
  /** Short reticle label drawn on the sensor feed and shown in the step list. */
  code: string;
  name: string;
  instruction: string;
  buttonLabel: string;
  /**
   * Where the ghost reticle suggests going for this step, in the tracker's mirrored space. These are
   * the tracker's default box corners (handControls.ts), so they're only a hint: the player captures
   * wherever their own comfortable range actually is.
   */
  hint: CalibrationPoint;
}

export const CALIBRATION_STEPS: CalibrationStep[] = [
  {
    key: 'center',
    code: 'C',
    name: 'Neutral center',
    instruction:
      'Hold your hand comfortably in front of the camera, wherever feels natural. This is where "fly straight" will be.',
    buttonLabel: 'Set Center',
    hint: { x: 0.5, y: 0.5 },
  },
  {
    key: 'topLeft',
    code: 'TL',
    name: 'Top-left boundary',
    instruction: 'Move to the top-left edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Top-Left',
    hint: { x: 0.24, y: 0.28 },
  },
  {
    key: 'topRight',
    code: 'TR',
    name: 'Top-right boundary',
    instruction: 'Move to the top-right edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Top-Right',
    hint: { x: 0.76, y: 0.28 },
  },
  {
    key: 'bottomLeft',
    code: 'BL',
    name: 'Bottom-left boundary',
    instruction: 'Move to the bottom-left edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Bottom-Left',
    hint: { x: 0.24, y: 0.72 },
  },
  {
    key: 'bottomRight',
    code: 'BR',
    name: 'Bottom-right boundary',
    instruction: 'Move to the bottom-right edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Bottom-Right',
    hint: { x: 0.76, y: 0.72 },
  },
];

/** The calibration overlay drawn over the sensor feed; omitted for the small in-flight preview. */
export interface PreviewOverlay {
  points: CalibrationPointsMap;
  /** The step being captured, drawn as a pulsing ghost reticle at its hint position. */
  target: CalibrationStep | null;
  /** `performance.now()`, drives the ghost reticle's pulse. */
  time: number;
}

// Instrument palette, matching --ascent-cyan / --ascent-warm in index.css.
const CYAN = '159, 243, 228';
const WARM = '255, 179, 122';
const PALM_POINTS = [0, 5, 9, 13, 17];
const LABEL_FONT = '600 10px "JetBrains Mono", ui-monospace, Menlo, monospace';

/**
 * Draws `text` so it reads correctly after the canvas's CSS mirror (`scale-x-[-1]`): the text is
 * pre-flipped around its anchor. Inside the flipped frame +x is screen-right, so `dx` is a
 * screen-space offset.
 */
function drawMirroredLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dx: number, dy: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(text, dx, dy);
  ctx.restore();
}

/** Four L-shaped corner brackets around (x, y): the reticle shape used for every target. */
function strokeBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, half: number, arm: number) {
  ctx.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const cx = x + sx * half;
    const cy = y + sy * half;
    ctx.moveTo(cx - sx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - sy * arm);
  }
  ctx.stroke();
}

/**
 * Draws the webcam frame + hand skeleton onto a preview canvas, optionally with the calibration
 * overlay (captured center/corner reticles, the box, the live steering point and the current
 * step's ghost target). Shared by the calibration sensor feed and the small in-flight preview.
 */
export function drawHandPreview(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[] | null,
  connections: readonly (readonly [number, number])[],
  width: number,
  height: number,
  overlay?: PreviewOverlay | null,
) {
  // Sizes below are tuned for a 360 px wide canvas and scale with it.
  const u = width / 360;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);

  if (overlay) {
    // A light ink wash so the overlay reads over any room lighting.
    ctx.fillStyle = 'rgba(6, 16, 31, 0.22)';
    ctx.fillRect(0, 0, width, height);
  }

  if (landmarks) {
    ctx.strokeStyle = `rgba(${CYAN}, 0.85)`;
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath();
    for (const [start, end] of connections) {
      const a = landmarks[start];
      const b = landmarks[end];
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
    }
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 2.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!overlay) {
    ctx.restore();
    return;
  }

  // Calibration points come from HandTracker in its mirrored-frame coordinate space (X is
  // already flipped to match the mirrored steering math), but this canvas draws the raw
  // video and raw landmarks un-mirrored — the whole canvas gets flipped horizontally
  // afterward via CSS (`scale-x-[-1]`) for display. So every point here must be un-mirrored
  // back to raw canvas space, or it would land on the wrong side once the CSS flip applies.
  const toCanvas = (p: CalibrationPoint) => ({ x: (1 - p.x) * width, y: p.y * height });
  const { points, target, time } = overlay;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';

  const corners = [points.topLeft, points.topRight, points.bottomRight, points.bottomLeft];
  if (corners.every((c): c is CalibrationPoint => c !== null)) {
    ctx.beginPath();
    corners.forEach((p, i) => {
      const c = toCanvas(p);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(${CYAN}, 0.07)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${CYAN}, 0.75)`;
    ctx.lineWidth = 1.4 * u;
    ctx.setLineDash([6 * u, 4 * u]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Ghost reticle for the step being captured: a pulsing hint, not a requirement.
  if (target) {
    const c = toCanvas(target.hint);
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + 0.35 * pulse})`;
    ctx.lineWidth = 1.2 * u;
    strokeBrackets(ctx, c.x, c.y, (15 + 3 * pulse) * u, 6 * u);
    ctx.setLineDash([2 * u, 3 * u]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.55 + 0.3 * pulse})`;
    drawMirroredLabel(ctx, target.code, c.x, c.y, 22 * u, -14 * u);
  }

  // Captured corners: warm bracket reticles (these are the draggable handles).
  for (const step of CALIBRATION_STEPS) {
    const point = points[step.key];
    if (!point || step.key === 'center') continue;
    const c = toCanvas(point);
    ctx.strokeStyle = `rgba(${WARM}, 0.95)`;
    ctx.lineWidth = 1.8 * u;
    strokeBrackets(ctx, c.x, c.y, 9 * u, 5 * u);
    ctx.fillStyle = `rgba(${WARM}, 0.95)`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2.6 * u, 0, Math.PI * 2);
    ctx.fill();
    drawMirroredLabel(ctx, step.code, c.x, c.y, 13 * u, -12 * u);
  }

  // Captured neutral center: a cyan crosshair with a center gap.
  if (points.center) {
    const c = toCanvas(points.center);
    ctx.strokeStyle = `rgba(${CYAN}, 0.95)`;
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      ctx.moveTo(c.x + dx * 5 * u, c.y + dy * 5 * u);
      ctx.lineTo(c.x + dx * 15 * u, c.y + dy * 15 * u);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${CYAN}, 0.95)`;
    drawMirroredLabel(ctx, 'C', c.x, c.y, 17 * u, -13 * u);
  }

  // The live steering point (the palm center the tracker follows), drawn from the raw landmarks,
  // so it's already in canvas space.
  if (landmarks) {
    let x = 0;
    let y = 0;
    for (const index of PALM_POINTS) {
      x += landmarks[index].x;
      y += landmarks[index].y;
    }
    x = (x / PALM_POINTS.length) * width;
    y = (y / PALM_POINTS.length) * height;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    ctx.arc(x, y, 7 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(${WARM}, 1)`;
    ctx.beginPath();
    ctx.arc(x, y, 2.4 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
