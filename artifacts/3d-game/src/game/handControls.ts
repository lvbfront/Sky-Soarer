import { Camera } from '@mediapipe/camera_utils';
import { Hands, type NormalizedLandmark, type Results } from '@mediapipe/hands';

export interface HandControlState {
  handDetected: boolean;
  /** -1 (dive) .. 1 (climb), smoothed */
  pitch: number;
  /** -1 (bank left) .. 1 (bank right), smoothed */
  roll: number;
  /** True while the hand is held in a closed fist / fingers folded into the palm (triggers boost + the barrel roll), in either control mode. */
  boost: boolean;
  /** One-shot pulse: true for exactly the frame a fast upward flick is detected. */
  backflip: boolean;
  landmarks: NormalizedLandmark[] | null;
}

/** Full Hand Steering tracks the palm center; Single Finger Steering tracks the index fingertip. */
export type ControlMode = 'hand' | 'finger';

export type CalibrationCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface CalibrationPoint {
  x: number;
  y: number;
}

const FINGER_TIPS = [4, 8, 12, 16, 20];
const PALM_POINTS = [0, 5, 9, 13, 17];
const INDEX_TIP = 8;

const FIST_CLOSE_RATIO = 0.62;
const FIST_OPEN_RATIO = 0.8;
const FIST_HOLD_FRAMES = 3;

const SMOOTHING_ALPHA = 0.35;

// Small deadzone (in the already-box-normalized -1..1 output space) so tiny hand tremor /
// tracking jitter near the calibrated center doesn't cause constant steering drift.
const NORMALIZED_DEADZONE = 0.06;

// Sensitivity slider bounds exposed to the calibration UI.
export const MIN_SENSITIVITY = 0.5;
export const MAX_SENSITIVITY = 2.0;

// A rapid upward flick of the raw (un-smoothed) tracked point triggers the backflip gesture.
// Detected over a short rolling time window (see `trackedYHistory`) rather than a single
// frame-to-frame delta, so one noisy MediaPipe frame can't mask (or falsely fabricate) the
// gesture, and detection stays consistent across different camera frame rates.
const FLICK_WINDOW_MS = 220;
// The tracked point must travel at least this far (in normalized 0..1 frame units) within the
// window for it to count as an intentional flick rather than ordinary steering motion/jitter.
const FLICK_MIN_DISTANCE = 0.1;
const UPWARD_FLICK_VELOCITY_THRESHOLD = 1.1;
const BACKFLIP_COOLDOWN_MS = 1200;
// If the hand disappears shortly after a fast upward flick (common when the flick carries
// the hand out of frame), still fire the backflip once rather than losing the gesture.
const HAND_LOST_GRACE_MS = 300;

// Default calibration box (mirrored-frame coordinates) used until the player completes the
// 4-corner calibration flow, so the tracker still produces sane output before that.
const DEFAULT_BOX_LEFT_X = 0.24;
const DEFAULT_BOX_RIGHT_X = 0.76;
const DEFAULT_BOX_TOP_Y = 0.28;
const DEFAULT_BOX_BOTTOM_Y = 0.72;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Maps `value` onto -1..1 given its calibrated center and the positive/negative-side extents
 * of the calibration box on this axis (already in the same coordinate units as `value`). */
function axisValue(value: number, center: number, positiveExtent: number, negativeExtent: number) {
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
function applyDeadzone(value: number, deadzone: number) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const sign = Math.sign(value);
  return sign * ((magnitude - deadzone) / (1 - deadzone));
}

export class HandTracker {
  private hands: Hands;
  private camera: Camera | null = null;
  private videoEl: HTMLVideoElement;
  private onUpdate: (state: HandControlState) => void;
  private onError: (error: unknown) => void;

  private controlMode: ControlMode = 'hand';

  // Smoothed position of whichever point is currently tracked (palm center in Hand mode,
  // index fingertip in Finger mode), in mirrored-frame coordinates.
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private hasSmoothed = false;

  private fistFrameCounter = 0;
  private fistActive = false;

  private stopped = false;

  // Calibrated neutral center — defaults to dead-center of frame, but the player sets it via
  // the calibration flow's "Set Center" step.
  private originX = 0.5;
  private originY = 0.5;

  // The 4-corner calibration box: flight pitch/roll are mapped strictly within this box, so
  // steering feels fitted to the player's own natural range of motion instead of a fixed gain.
  private corners: Partial<Record<CalibrationCorner, CalibrationPoint>> = {};
  private boxLeftX = DEFAULT_BOX_LEFT_X;
  private boxRightX = DEFAULT_BOX_RIGHT_X;
  private boxTopY = DEFAULT_BOX_TOP_Y;
  private boxBottomY = DEFAULT_BOX_BOTTOM_Y;

  // Multiplier applied on top of the box-normalized signal, controlled by the calibration
  // screen's slider; 1 = default, >1 = twitchier, <1 = calmer.
  private sensitivity = 1;

  // Upward-flick backflip tracking: a short rolling history of the raw (un-smoothed)
  // tracked-point Y + its timestamp, used to compute a velocity estimate independent of the
  // roll/pitch smoothing (smoothing would blur out a fast, brief flick — see project memory).
  private trackedYHistory: { y: number; t: number }[] = [];
  private lastBackflipTimeMs = -Infinity;
  private lastFastUpwardFlickTimeMs = -Infinity;

  constructor(
    videoEl: HTMLVideoElement,
    onUpdate: (state: HandControlState) => void,
    onError: (error: unknown) => void,
  ) {
    this.videoEl = videoEl;
    this.onUpdate = onUpdate;
    this.onError = onError;

    this.hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
    });
    this.hands.setOptions({
      // We mirror the tracked point's X coordinate ourselves below (in lockstep with the
      // mirrored webcam preview), so we want MediaPipe's raw, un-mirrored camera-frame
      // coordinates.
      selfieMode: false,
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    this.hands.onResults((results) => this.handleResults(results));
  }

  async start() {
    try {
      this.camera = new Camera(this.videoEl, {
        onFrame: async () => {
          // Guard against frames still in flight from `requestAnimationFrame` right after
          // `stop()` was called — sending into (or closing) a Hands instance mid-flight is
          // what triggers MediaPipe's "Cannot pass deleted object as a pointer" wasm error.
          if (this.stopped) return;
          try {
            await this.hands.send({ image: this.videoEl });
          } catch (error) {
            // A single frame occasionally failing inside MediaPipe's internal WASM/WebGL
            // pipeline (e.g. a transient GL context hiccup) shouldn't take down the whole
            // tracking session with an uncaught rejection — log it and keep going, since the
            // next frame usually recovers on its own. The narrower "deleted object" error from
            // a stop()-during-flight race is already avoided by the `this.stopped` check above.
            if (!this.stopped) {
              console.warn('HandTracker: a frame failed to process, skipping it', error);
            }
          }
        },
        width: 480,
        height: 360,
      });
      await this.camera.start();
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    this.camera?.stop();
    this.hands.close().catch(() => {
      // Benign during teardown if a send() was already in flight when stop() was called.
    });
  }

  /** Full Hand Steering tracks the palm center; Single Finger Steering tracks the index fingertip. */
  setControlMode(mode: ControlMode) {
    this.controlMode = mode;
    // Switching which point is tracked (palm vs fingertip) can jump the raw Y position
    // discontinuously — clear the flick-detection history so that jump can't be misread as a
    // real upward flick.
    this.trackedYHistory = [];
  }

  getControlMode() {
    return this.controlMode;
  }

  /** Sets the (mirrored-frame) point that counts as "fly straight" for steering offsets. */
  setOrigin(x: number, y: number) {
    this.originX = clamp(x, 0, 1);
    this.originY = clamp(y, 0, 1);
  }

  getOrigin() {
    return { x: this.originX, y: this.originY };
  }

  /** Scales the box-normalized signal; 1 = default gain, >1 = twitchier, <1 = calmer. */
  setSensitivity(multiplier: number) {
    this.sensitivity = clamp(multiplier, MIN_SENSITIVITY, MAX_SENSITIVITY);
  }

  /**
   * Captures the current smoothed tracked position as the new neutral center, so the player
   * can hold their hand/finger wherever is comfortable and declare that "straight ahead".
   * Returns the captured point for the calibration UI to draw a crosshair over, or null if no
   * hand is currently visible to capture from.
   */
  captureNeutralCenter(): CalibrationPoint | null {
    if (!this.hasSmoothed) return null;
    this.setOrigin(this.smoothedX, this.smoothedY);
    return this.getOrigin();
  }

  /**
   * Captures the current smoothed tracked position as one corner of the active control range.
   * Once a pair of corners on the same side is captured (e.g. topLeft + bottomLeft), that
   * side's box extent is recomputed — flight pitch/roll are mapped strictly within this box.
   */
  captureCorner(corner: CalibrationCorner): CalibrationPoint | null {
    if (!this.hasSmoothed) return null;
    const point = { x: this.smoothedX, y: this.smoothedY };
    this.corners[corner] = point;
    this.recomputeBox();
    return point;
  }

  /**
   * Directly sets one corner of the calibration box to an explicit point (rather than reading
   * the live tracked position, as `captureCorner` does) and recomputes the box immediately.
   * Used by the calibration screen's drag-to-fine-tune corner handles.
   */
  setCorner(corner: CalibrationCorner, point: CalibrationPoint) {
    this.corners[corner] = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    this.recomputeBox();
  }

  /** Clears the neutral center and all captured corners back to their defaults. */
  resetCalibration() {
    this.originX = 0.5;
    this.originY = 0.5;
    this.corners = {};
    this.boxLeftX = DEFAULT_BOX_LEFT_X;
    this.boxRightX = DEFAULT_BOX_RIGHT_X;
    this.boxTopY = DEFAULT_BOX_TOP_Y;
    this.boxBottomY = DEFAULT_BOX_BOTTOM_Y;
  }

  private recomputeBox() {
    const { topLeft, topRight, bottomLeft, bottomRight } = this.corners;
    if (topLeft && bottomLeft) this.boxLeftX = (topLeft.x + bottomLeft.x) / 2;
    if (topRight && bottomRight) this.boxRightX = (topRight.x + bottomRight.x) / 2;
    if (topLeft && topRight) this.boxTopY = (topLeft.y + topRight.y) / 2;
    if (bottomLeft && bottomRight) this.boxBottomY = (bottomLeft.y + bottomRight.y) / 2;
  }

  private handleResults(results: Results) {
    const hand = results.multiHandLandmarks?.[0];
    const now = performance.now();

    if (!hand) {
      this.fistFrameCounter = 0;
      // If the hand vanished shortly after a fast upward flick (the flick often carries the
      // hand out of the webcam frame entirely), still honor the gesture once here.
      const lostBackflip =
        now - this.lastFastUpwardFlickTimeMs <= HAND_LOST_GRACE_MS &&
        now - this.lastBackflipTimeMs > BACKFLIP_COOLDOWN_MS;
      if (lostBackflip) {
        this.lastBackflipTimeMs = now;
      }
      this.trackedYHistory = [];
      this.onUpdate({
        handDetected: false,
        pitch: 0,
        roll: 0,
        boost: false,
        backflip: lostBackflip,
        landmarks: null,
      });
      return;
    }

    // Palm center is always computed (used for fist detection + hand-scale reference)
    // regardless of control mode, since "folded hand" boost relies on it even in Finger mode.
    let palmX = 0;
    let palmY = 0;
    for (const idx of PALM_POINTS) {
      palmX += hand[idx].x;
      palmY += hand[idx].y;
    }
    palmX /= PALM_POINTS.length;
    palmY /= PALM_POINTS.length;

    // The point actually used for steering: the palm center in Hand mode, or the index
    // fingertip in Finger mode (raw camera-frame coordinates, not yet mirrored).
    const trackedRawX = this.controlMode === 'finger' ? hand[INDEX_TIP].x : palmX;
    const trackedRawY = this.controlMode === 'finger' ? hand[INDEX_TIP].y : palmY;

    // Mirror horizontally (scaleX = -1), matching the mirrored webcam preview: this makes
    // moving your hand/finger to your own left steer left and to your own right steer right,
    // the way a mirror (or any selfie camera app) naturally behaves.
    const mirroredTrackedX = 1 - trackedRawX;

    if (!this.hasSmoothed) {
      this.smoothedX = mirroredTrackedX;
      this.smoothedY = trackedRawY;
      this.hasSmoothed = true;
    } else {
      this.smoothedX = SMOOTHING_ALPHA * mirroredTrackedX + (1 - SMOOTHING_ALPHA) * this.smoothedX;
      this.smoothedY = SMOOTHING_ALPHA * trackedRawY + (1 - SMOOTHING_ALPHA) * this.smoothedY;
    }

    // Map the smoothed tracked point onto -1..1 strictly within the calibrated box: at the
    // neutral center both axes read 0, at a calibrated corner the relevant axis reads +-1 —
    // steering is fitted to the player's own natural range of motion, not a fixed gain.
    const rollRaw = axisValue(this.smoothedX, this.originX, this.boxRightX, this.boxLeftX);
    // Y grows downward on screen, so climbing (moving up) needs the sign flipped relative to
    // axisValue's "greater than center = positive" convention.
    const pitchRaw = axisValue(-this.smoothedY, -this.originY, -this.boxTopY, -this.boxBottomY);

    const roll = clamp(applyDeadzone(rollRaw, NORMALIZED_DEADZONE) * this.sensitivity, -1, 1);
    const pitch = clamp(applyDeadzone(pitchRaw, NORMALIZED_DEADZONE) * this.sensitivity, -1, 1);

    // Backflip gesture: a fast upward flick of the raw (un-smoothed) tracked point, tracked
    // independently of the smoothed steering signal so smoothing doesn't blur out the flick
    // (see project memory on gesture-control smoothing tradeoffs). Detected over a short
    // rolling window rather than a single frame-to-frame delta, so one noisy frame can't mask
    // (or falsely fabricate) the gesture.
    this.trackedYHistory.push({ y: trackedRawY, t: now });
    while (this.trackedYHistory.length > 0 && now - this.trackedYHistory[0].t > FLICK_WINDOW_MS) {
      this.trackedYHistory.shift();
    }
    let backflip = false;
    if (this.trackedYHistory.length >= 2) {
      const oldest = this.trackedYHistory[0];
      const dtSec = (now - oldest.t) / 1000;
      // Y decreases upward on screen, so a positive delta here means the point moved up.
      const upwardDistance = oldest.y - trackedRawY;
      if (dtSec > 0.03 && upwardDistance > FLICK_MIN_DISTANCE) {
        const upwardVelocity = upwardDistance / dtSec;
        if (upwardVelocity > UPWARD_FLICK_VELOCITY_THRESHOLD) {
          this.lastFastUpwardFlickTimeMs = now;
          if (now - this.lastBackflipTimeMs > BACKFLIP_COOLDOWN_MS) {
            backflip = true;
            this.lastBackflipTimeMs = now;
          }
        }
      }
    }

    // Fist detection: average fingertip distance from palm center, normalized by hand size.
    const wrist = hand[0];
    const middleMcp = hand[9];
    const handScale = dist2D(wrist, middleMcp) || 0.001;
    let tipDistSum = 0;
    for (const idx of FINGER_TIPS) {
      tipDistSum += dist2D(hand[idx], { x: palmX, y: palmY });
    }
    const fistRatio = tipDistSum / FINGER_TIPS.length / handScale;

    if (this.fistActive) {
      if (fistRatio > FIST_OPEN_RATIO) {
        this.fistFrameCounter += 1;
        if (this.fistFrameCounter >= FIST_HOLD_FRAMES) {
          this.fistActive = false;
          this.fistFrameCounter = 0;
        }
      } else {
        this.fistFrameCounter = 0;
      }
    } else if (fistRatio < FIST_CLOSE_RATIO) {
      this.fistFrameCounter += 1;
      if (this.fistFrameCounter >= FIST_HOLD_FRAMES) {
        this.fistActive = true;
        this.fistFrameCounter = 0;
      }
    } else {
      this.fistFrameCounter = 0;
    }

    // Boost is a closed fist / folded hand in both control modes — Finger mode only changes
    // which point steers, not the boost gesture.
    const boost = this.fistActive;

    this.onUpdate({
      handDetected: true,
      pitch,
      roll,
      boost,
      backflip,
      landmarks: hand,
    });
  }
}
