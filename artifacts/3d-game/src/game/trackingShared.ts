// The bits of the hand-tracking API the UI needs *before* MediaPipe is loaded: the startup error
// type (for classifying failures) and the sensitivity slider bounds. They live here, not in
// handControls.ts, so importing them doesn't pull @mediapipe/hands into the first-load bundle —
// handControls (and MediaPipe with it) is only loaded once the player clicks "Begin pre-flight".

// Sensitivity slider bounds exposed to the calibration UI.
export const MIN_SENSITIVITY = 0.5;
export const MAX_SENSITIVITY = 2.0;

// Small deadzone (in the box-normalized -1..1 output space) so tiny hand tremor / tracking jitter
// near the calibrated center doesn't cause constant steering drift.
export const STEERING_DEADZONE = 0.06;

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

// Backflip (upward flick) thresholds. They live here rather than in handControls.ts so the
// "How to fly" guide can quote the real numbers without loading MediaPipe; HandTracker uses these
// exact values.
//
// A backflip fires when, within a rolling FLICK_WINDOW_MS window of raw (un-smoothed) palm
// positions, the palm has moved up more than FLICK_MIN_DISTANCE (a fraction of the camera frame's
// height) at an average speed above FLICK_MIN_VELOCITY frame-heights per second.
export const FLICK_WINDOW_MS = 220;
export const FLICK_MIN_DISTANCE = 0.1;
export const FLICK_MIN_VELOCITY = 1.1;
export const BACKFLIP_COOLDOWN_MS = 1200;

/**
 * What the flick rule means in practice. The speed is measured from the oldest sample still in
 * the window, so once the palm has been in view for a moment it's `rise / ~FLICK_WINDOW_MS`, not
 * rise / (time the snap took). From a still hand, a backflip therefore needs the palm to rise
 * FLICK_MIN_VELOCITY × FLICK_WINDOW_MS (about 24% of the frame height) within one window;
 * FLICK_MIN_DISTANCE only decides right after the hand reappears. The guide quotes this, and
 * near-miss coaching measures against it.
 */
export const FLICK_STILL_HAND_DISTANCE = Math.max(FLICK_MIN_DISTANCE, (FLICK_MIN_VELOCITY * FLICK_WINDOW_MS) / 1000);

/**
 * An upward flick that came close to a backflip but missed: `too-short` rose less than
 * FLICK_STILL_HAND_DISTANCE in total (no speed would have been enough), `too-slow` rose that far
 * but took longer than one window to do it. Reported once per upward stroke, so the HUD can coach.
 */
export type FlickNearMiss = 'too-slow' | 'too-short';
