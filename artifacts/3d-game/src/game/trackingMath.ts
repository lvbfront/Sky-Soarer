// Pure steering/calibration math for the hand tracker. No MediaPipe, no DOM: HandTracker, the
// calibration UI, saved-calibration validation and the unit tests all share these.
import {
  DEFAULT_BOX,
  MIN_BOX_SIZE,
  MIN_CENTER_MARGIN,
  type CalibrationBox,
  type CalibrationCorner,
  type CalibrationPoint,
  type CalibrationProblem,
} from './trackingShared';

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Maps `value` onto -1..1 given its calibrated center and the positive/negative-side extents
 * of the calibration box on this axis (already in the same coordinate units as `value`). */
export function axisValue(value: number, center: number, positiveExtent: number, negativeExtent: number) {
  if (value >= center) {
    const span = positiveExtent - center;
    if (span <= 0.001) return 0;
    return clamp((value - center) / span, 0, 1);
  }
  const span = center - negativeExtent;
  if (span <= 0.001) return 0;
  return clamp((value - center) / span, -1, 0);
}

/** Zeroes out small values near 0, then rescales the remainder back up to +-1 so there's no
 * jump at the deadzone edge. */
export function applyDeadzone(value: number, deadzone: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const sign = Math.sign(value);
  return sign * ((magnitude - deadzone) / (1 - deadzone));
}

/**
 * Applies the steering sensitivity as a response curve rather than a plain gain:
 * `s·v / (1 + (s − 1)·|v|)`. It keeps both ends fixed (0 → 0, ±1 → ±1), so a corner of the box is
 * always full deflection, while the gain near the center is `s`: 2x is twitchier around the center
 * without saturating halfway to the edge (the middle of the box reads 0.67), and 0.5x is calmer
 * without losing full pitch/roll (the middle reads 0.33, the edge still 1). A plain multiply did
 * both of those wrong. Monotonic for every s > 0.
 */
export function applySensitivity(value: number, sensitivity: number) {
  const v = clamp(value, -1, 1);
  return (sensitivity * v) / (1 + (sensitivity - 1) * Math.abs(v));
}

/**
 * The steering box from the captured corners: each side is the average of the two corners that
 * share it (the left edge is the mean of topLeft.x and bottomLeft.x), and a side stays at its
 * default until both of its corners exist. See box-calibration-corner-averaging.md.
 */
export function computeBox(
  corners: Partial<Record<CalibrationCorner, CalibrationPoint>>,
  defaults: Readonly<CalibrationBox> = DEFAULT_BOX,
): CalibrationBox {
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;
  return {
    left: topLeft && bottomLeft ? (topLeft.x + bottomLeft.x) / 2 : defaults.left,
    right: topRight && bottomRight ? (topRight.x + bottomRight.x) / 2 : defaults.right,
    top: topLeft && topRight ? (topLeft.y + topRight.y) / 2 : defaults.top,
    bottom: bottomLeft && bottomRight ? (bottomLeft.y + bottomRight.y) / 2 : defaults.bottom,
  };
}

/**
 * Checks a finished calibration: the box must be at least MIN_BOX_SIZE of the frame on each axis
 * (a box captured "inside out", e.g. with left and right swapped, has a negative size and fails
 * too), and the center must sit inside it with MIN_CENTER_MARGIN of the box's span to spare on
 * every side. Returns the problems found, empty when the calibration is usable.
 */
export function validateCalibration(center: CalibrationPoint, box: CalibrationBox): CalibrationProblem[] {
  const problems: CalibrationProblem[] = [];
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width < MIN_BOX_SIZE) problems.push('box-too-narrow');
  if (height < MIN_BOX_SIZE) problems.push('box-too-short');
  if (width > 0 && height > 0) {
    const marginX = width * MIN_CENTER_MARGIN;
    const marginY = height * MIN_CENTER_MARGIN;
    const inside =
      center.x >= box.left + marginX &&
      center.x <= box.right - marginX &&
      center.y >= box.top + marginY &&
      center.y <= box.bottom - marginY;
    if (!inside) problems.push('center-outside');
  }
  return problems;
}
