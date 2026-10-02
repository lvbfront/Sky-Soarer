// The bits of the hand-tracking API the UI needs *before* MediaPipe is loaded: the startup error
// type (for classifying failures), the sensitivity slider bounds, the calibration types and limits,
// and the gesture thresholds the "How to fly" guide quotes. They live here, not in
// handControls.ts, so importing them doesn't pull @mediapipe/hands into the first-load bundle —
// handControls (and MediaPipe with it) is only loaded once the player clicks "Begin pre-flight".

// Sensitivity slider bounds (the steering setting is shared by both control modes; see flightTuning).
export { MAX_SENSITIVITY, MIN_SENSITIVITY } from './flightTuning';

// Small deadzone (in the box-normalized -1..1 output space, i.e. 7% of the calibrated half-range)
// so tiny hand tremor / tracking jitter near the calibrated center doesn't cause steering drift.
export const STEERING_DEADZONE = 0.07;

// A fist has to hold (or release) for this many consecutive camera frames before boost changes.
export const FIST_HOLD_FRAMES = 3;

export type TrackingStartErrorKind = 'load-failed' | 'timeout';

/** Thrown by `HandTracker.start()` when MediaPipe can't load or doesn't finish loading in time. */
export class TrackingStartError extends Error {
  constructor(
    readonly kind: TrackingStartErrorKind,
    readonly cause?: unknown,
  ) {
    super(kind === 'timeout' ? 'Hand tracking timed out while loading' : 'Hand tracking failed to load');
    this.name = 'TrackingStartError';
  }
}

// ---- Calibration ------------------------------------------------------------------------------

export type CalibrationCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** A point in the tracker's mirrored camera-frame space (0..1 on both axes, y down). */
export interface CalibrationPoint {
  x: number;
  y: number;
}

/** The steering box, in mirrored camera-frame coordinates (left < right, top < bottom). */
export interface CalibrationBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Default box used until the player completes the 4-corner calibration flow (and whenever a side
// is missing a corner), so the tracker still produces sane output before that. The calibration
// screen's ghost reticles suggest these same corners.
export const DEFAULT_BOX: Readonly<CalibrationBox> = { left: 0.24, right: 0.76, top: 0.28, bottom: 0.72 };

// Calibration validity. The box must span at least MIN_BOX_SIZE of the camera frame on each axis,
// or steering (and the flick, which is measured in box heights) becomes hypersensitive; and the
// neutral center must sit inside the box with at least MIN_CENTER_MARGIN of the box's span on each
// side of it, or one direction would have almost no travel (at or beyond the edge, none at all).
export const MIN_BOX_SIZE = 0.15;
export const MIN_CENTER_MARGIN = 0.15;

export type CalibrationProblem = 'box-too-narrow' | 'box-too-short' | 'center-outside';

/** A complete calibration, as captured on the calibration screen or restored from storage. */
export interface CalibrationData {
  center: CalibrationPoint;
  corners: Record<CalibrationCorner, CalibrationPoint>;
  sensitivity: number;
  /**
   * Apparent palm size at the neutral center (see `palmSize`), the air brake's reference. Absent in
   * calibrations saved before the brake existed: the tracker then measures it in the first seconds.
   */
  handSize?: number;
}

// ---- Air brake (push the open palm toward the camera) ------------------------------------------
//
// Moving the hand toward the camera makes it look bigger. The palm's size (the wrist / index-knuckle
// / pinky-knuckle triangle, which doesn't change when the fingers curl, so a fist never reads as a
// push) is compared with the size recorded at calibration: the brake engages once it has stayed at
// least BRAKE_ENGAGE_RATIO times bigger for BRAKE_HOLD_MS, and releases below BRAKE_RELEASE_RATIO.
// Tilting the hand only ever makes it look smaller, so it can't trigger the brake.
export const BRAKE_ENGAGE_RATIO = 1.25;
export const BRAKE_RELEASE_RATIO = 1.15;
export const BRAKE_HOLD_MS = 150;
// A calibration saved before the brake existed has no palm size: the first BRAKE_BASELINE_MS of
// tracked flight (at least BRAKE_BASELINE_MIN_FRAMES frames) provide it instead (their median).
export const BRAKE_BASELINE_MS = 2500;
export const BRAKE_BASELINE_MIN_FRAMES = 15;

// ---- Backflip (upward flick) ------------------------------------------------------------------
//
// These live here rather than in the detector so the "How to fly" guide can quote the real numbers
// without loading MediaPipe; FlickDetector uses these exact values.
//
// Everything is measured in **heights of the player's calibrated box**, not of the camera frame, so
// the gesture scales with the range the player actually steers in. A backflip fires when, within
// the last FLICK_WINDOW_MS, the palm has risen at least FLICK_MIN_RISE box heights and its peak
// upward speed in that window (each speed measured over a step of at least FLICK_SPEED_SPAN_MS, not
// averaged over the whole window) reached FLICK_MIN_SPEED box heights per second.
//
// Tuning: a natural quick flick of about half the box in ~0.15 s peaks near 5 box/s and fires ~0.1 s
// in. Ordinary steering stays well under the speed: easing from the center to the box's top edge
// in a third of a second peaks around 2.2 box/s, and even a full bottom-to-top sweep in half a
// second peaks at 3 box/s. Closing a fist shifts the palm center by well under 0.1 box.
export const FLICK_WINDOW_MS = 250;
export const FLICK_MIN_RISE = 0.35;
export const FLICK_SPEED_SPAN_MS = 50;
export const FLICK_MIN_SPEED = 3.5;
export const BACKFLIP_COOLDOWN_MS = 1200;

/**
 * The flick the guide and the near-miss hints recommend: a comfortable rise that clears
 * FLICK_MIN_RISE with room to spare (half the box, or more if the minimum is ever raised past it),
 * done within FLICK_TIP_SECONDS. A smooth snap of distance d over T seconds peaks at about
 * 1.5·d/T, so this is the longest a FLICK_TIP_RISE snap may take to still reach FLICK_MIN_SPEED,
 * rounded down to a tenth of a second.
 */
export const FLICK_TIP_RISE = Math.max(0.5, Math.ceil(FLICK_MIN_RISE * 4) / 4);
export const FLICK_TIP_SECONDS = Math.floor(((1.5 * FLICK_TIP_RISE) / FLICK_MIN_SPEED) * 10) / 10;

/** "half", "three quarters" or a percentage, for copy like "about half your box". */
export function describeBoxFraction(fraction: number) {
  if (fraction === 0.5) return 'half';
  if (fraction === 0.75) return 'three quarters';
  return `${Math.round(fraction * 100)}%`;
}

/**
 * An upward flick that came close to a backflip but missed: `too-slow` rose far enough but its
 * peak speed fell short, `too-short` was fast but didn't rise far enough (when both fall short,
 * whichever is further off). Reported once per upward stroke, so the HUD can coach.
 */
export type FlickNearMiss = 'too-slow' | 'too-short';
