import { Camera } from '@mediapipe/camera_utils';
import { Hands, type NormalizedLandmark, type Results } from '@mediapipe/hands';

export interface HandControlState {
  handDetected: boolean;
  /** -1 (dive) .. 1 (climb), smoothed */
  pitch: number;
  /** -1 (bank left) .. 1 (bank right), smoothed */
  roll: number;
  /** True while the hand is held in a closed fist (triggers boost + the barrel roll). */
  boost: boolean;
  /** One-shot pulse: true for exactly the frame a fast upward hand flick is detected. */
  backflip: boolean;
  landmarks: NormalizedLandmark[] | null;
}

const FINGER_TIPS = [4, 8, 12, 16, 20];
const PALM_POINTS = [0, 5, 9, 13, 17];

const FIST_CLOSE_RATIO = 0.62;
const FIST_OPEN_RATIO = 0.8;
const FIST_HOLD_FRAMES = 3;

const SMOOTHING_ALPHA = 0.35;
const STEER_GAIN = 2.6;

// Max possible offset from center (palm coordinates are normalized 0..1).
const MAX_OFFSET = 0.5;
// Offsets smaller than this (in the same 0..0.5 units as MAX_OFFSET) are treated as "centered"
// so small hand tremor / tracking jitter near the middle doesn't cause constant drift.
const CENTER_DEADZONE = 0.035;

// Sensitivity slider bounds exposed to the calibration UI.
export const MIN_SENSITIVITY = 0.5;
export const MAX_SENSITIVITY = 2.0;

// A rapid upward palm flick faster than this (normalized units/sec, using the un-smoothed,
// mirrored-frame Y velocity) triggers the automatic backflip gesture.
const UPWARD_FLICK_VELOCITY_THRESHOLD = 1.8;
const BACKFLIP_COOLDOWN_MS = 1200;
// If the hand disappears shortly after a fast upward flick (common when the flick carries
// the hand out of frame), still fire the backflip once rather than losing the gesture.
const HAND_LOST_GRACE_MS = 300;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Zeroes out small offsets near center, then rescales the remaining range so the
 * maximum offset still maps to the full output range (no jump at the deadzone edge). */
function applyDeadzone(offset: number, deadzone: number, max: number) {
  const magnitude = Math.abs(offset);
  if (magnitude <= deadzone) return 0;
  const sign = Math.sign(offset);
  return sign * ((magnitude - deadzone) / (max - deadzone)) * max;
}

export class HandTracker {
  private hands: Hands;
  private camera: Camera | null = null;
  private videoEl: HTMLVideoElement;
  private onUpdate: (state: HandControlState) => void;
  private onError: (error: unknown) => void;

  private smoothedPalmX = 0.5;
  private smoothedPalmY = 0.5;
  private hasSmoothed = false;

  private fistFrameCounter = 0;
  private fistActive = false;

  private stopped = false;

  // Calibrated neutral hand center — defaults to dead-center of frame, but the player can
  // set it to wherever is comfortable for them via `captureNeutralCenter()`.
  private originX = 0.5;
  private originY = 0.5;
  // Multiplier applied on top of STEER_GAIN, controlled by the calibration screen's slider.
  private sensitivity = 1;

  // Upward-flick backflip tracking: raw (un-smoothed, mirrored) palm Y + its timestamp from
  // the previous frame, used to compute a velocity estimate independent of the roll/pitch
  // smoothing (smoothing would blur out a fast, brief flick — see project memory).
  private lastRawPalmY: number | null = null;
  private lastFrameTimeMs: number | null = null;
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
      // We mirror the palm X coordinate ourselves below (in lockstep with the mirrored
      // webcam preview), so we want MediaPipe's raw, un-mirrored camera-frame coordinates.
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
            if (!this.stopped) throw error;
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

  /** Sets the (mirrored-frame) point that counts as "fly straight" for steering offsets. */
  setOrigin(x: number, y: number) {
    this.originX = clamp(x, 0, 1);
    this.originY = clamp(y, 0, 1);
  }

  getOrigin() {
    return { x: this.originX, y: this.originY };
  }

  /** Scales hand displacement from the origin; 1 = default gain, >1 = twitchier, <1 = calmer. */
  setSensitivity(multiplier: number) {
    this.sensitivity = clamp(multiplier, MIN_SENSITIVITY, MAX_SENSITIVITY);
  }

  /**
   * Captures the current smoothed palm position as the new neutral center, so the player can
   * hold their hand wherever is comfortable and declare that "straight ahead". Returns the
   * captured point for the calibration UI to draw a crosshair over, or null if no hand is
   * currently visible to capture from.
   */
  captureNeutralCenter(): { x: number; y: number } | null {
    if (!this.hasSmoothed) return null;
    this.setOrigin(this.smoothedPalmX, this.smoothedPalmY);
    return this.getOrigin();
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
      this.lastRawPalmY = null;
      this.lastFrameTimeMs = null;
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

    let px = 0;
    let py = 0;
    for (const idx of PALM_POINTS) {
      px += hand[idx].x;
      py += hand[idx].y;
    }
    px /= PALM_POINTS.length;
    py /= PALM_POINTS.length;

    // Mirror horizontally (scaleX = -1), matching the mirrored webcam preview: this makes
    // moving your hand to your own left steer left and to your own right steer right, the
    // way a mirror (or any selfie camera app) naturally behaves.
    const mirroredPx = 1 - px;

    if (!this.hasSmoothed) {
      this.smoothedPalmX = mirroredPx;
      this.smoothedPalmY = py;
      this.hasSmoothed = true;
    } else {
      this.smoothedPalmX = SMOOTHING_ALPHA * mirroredPx + (1 - SMOOTHING_ALPHA) * this.smoothedPalmX;
      this.smoothedPalmY = SMOOTHING_ALPHA * py + (1 - SMOOTHING_ALPHA) * this.smoothedPalmY;
    }

    // Offsets from the calibrated neutral center point (holding the hand there = fly
    // straight), with a small deadzone so tiny jitter near center doesn't cause constant
    // steering drift.
    const rawOffsetX = this.smoothedPalmX - this.originX;
    const rawOffsetY = this.originY - this.smoothedPalmY;
    const offsetX = applyDeadzone(rawOffsetX, CENTER_DEADZONE, MAX_OFFSET);
    const offsetY = applyDeadzone(rawOffsetY, CENTER_DEADZONE, MAX_OFFSET);

    // Left/right moves the hand along X -> roll. Up/down moves the hand along Y -> pitch.
    const gain = STEER_GAIN * this.sensitivity;
    const roll = clamp(offsetX * gain, -1, 1);
    const pitch = clamp(offsetY * gain, -1, 1);

    // Backflip gesture: a fast upward flick of the raw (un-smoothed) palm position, tracked
    // independently of the smoothed steering signal so smoothing doesn't blur out the flick
    // (see project memory on gesture-control smoothing tradeoffs).
    let backflip = false;
    if (this.lastRawPalmY !== null && this.lastFrameTimeMs !== null) {
      const dtSec = (now - this.lastFrameTimeMs) / 1000;
      if (dtSec > 0) {
        // Palm Y decreases upward on screen; convert to a positive "upward velocity".
        const upwardVelocity = (this.lastRawPalmY - py) / dtSec;
        if (upwardVelocity > UPWARD_FLICK_VELOCITY_THRESHOLD) {
          this.lastFastUpwardFlickTimeMs = now;
          if (now - this.lastBackflipTimeMs > BACKFLIP_COOLDOWN_MS) {
            backflip = true;
            this.lastBackflipTimeMs = now;
          }
        }
      }
    }
    this.lastRawPalmY = py;
    this.lastFrameTimeMs = now;

    // Fist detection: average fingertip distance from palm center, normalized by hand size.
    const wrist = hand[0];
    const middleMcp = hand[9];
    const handScale = dist2D(wrist, middleMcp) || 0.001;
    let tipDistSum = 0;
    for (const idx of FINGER_TIPS) {
      tipDistSum += dist2D(hand[idx], { x: px, y: py });
    }
    const ratio = tipDistSum / FINGER_TIPS.length / handScale;

    if (this.fistActive) {
      if (ratio > FIST_OPEN_RATIO) {
        this.fistFrameCounter += 1;
        if (this.fistFrameCounter >= FIST_HOLD_FRAMES) {
          this.fistActive = false;
          this.fistFrameCounter = 0;
        }
      } else {
        this.fistFrameCounter = 0;
      }
    } else if (ratio < FIST_CLOSE_RATIO) {
      this.fistFrameCounter += 1;
      if (this.fistFrameCounter >= FIST_HOLD_FRAMES) {
        this.fistActive = true;
        this.fistFrameCounter = 0;
      }
    } else {
      this.fistFrameCounter = 0;
    }

    this.onUpdate({
      handDetected: true,
      pitch,
      roll,
      boost: this.fistActive,
      backflip,
      landmarks: hand,
    });
  }
}
