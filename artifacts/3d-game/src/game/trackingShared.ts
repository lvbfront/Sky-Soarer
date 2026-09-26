// The bits of the hand-tracking API the UI needs *before* MediaPipe is loaded: the startup error
// type (for classifying failures) and the sensitivity slider bounds. They live here, not in
// handControls.ts, so importing them doesn't pull @mediapipe/hands into the first-load bundle —
// handControls (and MediaPipe with it) is only loaded once the player clicks "Begin pre-flight".

// Sensitivity slider bounds exposed to the calibration UI.
export const MIN_SENSITIVITY = 0.5;
export const MAX_SENSITIVITY = 2.0;

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
