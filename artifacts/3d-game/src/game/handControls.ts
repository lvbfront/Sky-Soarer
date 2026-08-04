import { Camera } from '@mediapipe/camera_utils';
import { Hands, type NormalizedLandmark, type Results } from '@mediapipe/hands';

export interface HandControlState {
  handDetected: boolean;
  /** -1 (dive) .. 1 (climb), smoothed */
  pitch: number;
  /** -1 (bank left) .. 1 (bank right), smoothed */
  roll: number;
  boost: boolean;
  flipTriggered: boolean;
  landmarks: NormalizedLandmark[] | null;
}

const FINGER_TIPS = [4, 8, 12, 16, 20];
const PALM_POINTS = [0, 5, 9, 13, 17];

const FIST_CLOSE_RATIO = 0.62;
const FIST_OPEN_RATIO = 0.8;
const FIST_HOLD_FRAMES = 3;

// Angular velocity of the hand's heading line (radians/sec) that counts as a "flick".
const FLIP_ANGULAR_VELOCITY_THRESHOLD = 8.5;
const FLIP_COOLDOWN_MS = 1400;

const SMOOTHING_ALPHA = 0.35;
const STEER_GAIN = 2.6;

// Neutral flight point: dead-center of the camera frame. Palm positions are measured as an
// offset from this point, so holding your hand here always means "fly straight".
const NEUTRAL_X = 0.5;
const NEUTRAL_Y = 0.5;
// Max possible offset from center (palm coordinates are normalized 0..1).
const MAX_OFFSET = 0.5;
// Offsets smaller than this (in the same 0..0.5 units as MAX_OFFSET) are treated as "centered"
// so small hand tremor / tracking jitter near the middle doesn't cause constant drift.
const CENTER_DEADZONE = 0.035;

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

  private lastHeadingAngle = 0;
  private lastHeadingTime = 0;
  private lastFlipTime = -Infinity;

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
          await this.hands.send({ image: this.videoEl });
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
    this.camera?.stop();
    void this.hands.close();
  }

  private handleResults(results: Results) {
    const hand = results.multiHandLandmarks?.[0];

    if (!hand) {
      this.fistFrameCounter = 0;
      this.onUpdate({
        handDetected: false,
        pitch: 0,
        roll: 0,
        boost: false,
        flipTriggered: false,
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

    // Offsets from the neutral center point (dead-center of frame = fly straight), with a
    // small deadzone so tiny jitter near center doesn't cause constant steering drift.
    const rawOffsetX = this.smoothedPalmX - NEUTRAL_X;
    const rawOffsetY = NEUTRAL_Y - this.smoothedPalmY;
    const offsetX = applyDeadzone(rawOffsetX, CENTER_DEADZONE, MAX_OFFSET);
    const offsetY = applyDeadzone(rawOffsetY, CENTER_DEADZONE, MAX_OFFSET);

    // Left/right moves the hand along X -> roll. Up/down moves the hand along Y -> pitch.
    const roll = clamp(offsetX * STEER_GAIN, -1, 1);
    const pitch = clamp(offsetY * STEER_GAIN, -1, 1);

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

    // Air flip: watch the angular velocity of the line across the knuckles (a fast wrist
    // twist spins this line quickly even though the smoothed steering signal stays calm).
    const indexMcp = hand[5];
    const pinkyMcp = hand[17];
    const headingAngle = Math.atan2(pinkyMcp.y - indexMcp.y, pinkyMcp.x - indexMcp.x);
    const now = performance.now();
    let flipTriggered = false;

    if (this.lastHeadingTime > 0) {
      const dt = (now - this.lastHeadingTime) / 1000;
      if (dt > 0.001) {
        let delta = headingAngle - this.lastHeadingAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const angularVelocity = Math.abs(delta / dt);
        if (
          angularVelocity > FLIP_ANGULAR_VELOCITY_THRESHOLD &&
          now - this.lastFlipTime > FLIP_COOLDOWN_MS
        ) {
          flipTriggered = true;
          this.lastFlipTime = now;
        }
      }
    }
    this.lastHeadingAngle = headingAngle;
    this.lastHeadingTime = now;

    this.onUpdate({
      handDetected: true,
      pitch,
      roll,
      boost: this.fistActive,
      flipTriggered,
      landmarks: hand,
    });
  }
}
