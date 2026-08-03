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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
      selfieMode: true,
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

    if (!this.hasSmoothed) {
      this.smoothedPalmX = px;
      this.smoothedPalmY = py;
      this.hasSmoothed = true;
    } else {
      this.smoothedPalmX = SMOOTHING_ALPHA * px + (1 - SMOOTHING_ALPHA) * this.smoothedPalmX;
      this.smoothedPalmY = SMOOTHING_ALPHA * py + (1 - SMOOTHING_ALPHA) * this.smoothedPalmY;
    }

    // selfieMode already mirrors landmarks horizontally, so hand-right maps to bird-right.
    const roll = clamp((this.smoothedPalmX - 0.5) * STEER_GAIN, -1, 1);
    const pitch = clamp((0.5 - this.smoothedPalmY) * STEER_GAIN, -1, 1);

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
