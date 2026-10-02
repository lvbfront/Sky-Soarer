import { Hands, type NormalizedLandmark, type Results } from '@mediapipe/hands';
import { MEDIAPIPE_FILE_SIZES } from 'virtual:mediapipe-hands-assets';
import { damp, perFrameRate } from './damping';
import { meterDownloads } from './downloadMeter';
import { FlickDetector } from './flickDetector';
import { PalmBrakeDetector } from './brakeDetector';
import { RaiseHoldDetector } from './takeoffGesture';
import { expoCurve } from './flightModel';
import { applyDeadzone, axisValue, clamp, computeBox, depthCorrected, palmSize, validateCalibration } from './trackingMath';
import {
  DEFAULT_BOX,
  FIST_HOLD_FRAMES,
  STEERING_DEADZONE,
  TrackingStartError,
  type CalibrationBox,
  type CalibrationCorner,
  type CalibrationData,
  type CalibrationPoint,
  type CalibrationProblem,
  type FlickNearMiss,
} from './trackingShared';

// Re-exported so existing imports of these from handControls keep working. HAND_CONNECTIONS is
// re-exported for the webcam preview, which gets it from this lazily loaded module.
export { HAND_CONNECTIONS } from '@mediapipe/hands';
export {
  MAX_SENSITIVITY,
  MIN_SENSITIVITY,
  TrackingStartError,
  type CalibrationBox,
  type CalibrationCorner,
  type CalibrationData,
  type CalibrationPoint,
  type CalibrationProblem,
  type FlickNearMiss,
  type TrackingStartErrorKind,
} from './trackingShared';

export interface HandControlState {
  handDetected: boolean;
  /** -1 (dive) .. 1 (climb), smoothed */
  pitch: number;
  /** -1 (bank left) .. 1 (bank right), smoothed */
  roll: number;
  /**
   * On the ground or water: −1..1, walk (or paddle) forward (+) or back (−). Keyboard: W/S. Hand: the
   * palm in the lower half of the box (the "dive" direction) walks forward, faster the lower it is.
   * Not affected by the invert setting (it's not a pitch control).
   */
  walk: number;
  /** True while the hand is held in a closed fist / fingers folded into the palm (triggers boost + the barrel roll). */
  boost: boolean;
  /** One-shot pulse: true for exactly the frame a fast upward flick is detected. */
  backflip: boolean;
  /** True while the air brake is held (keyboard: Shift; hand: the open palm pushed toward the camera). */
  brake: boolean;
  /**
   * True once the input's own hold-to-take-off gesture is complete (keyboard: Space held 0.4 s; hand:
   * the palm held in the top of the box for 0.5 s). Only read while standing or floating.
   */
  takeoffHold: boolean;
  /**
   * One-shot: set on the frame an upward flick ends that came close to a backflip but missed
   * (too slow, or too short), so the HUD can coach the player. Null on every other frame.
   */
  flickNearMiss: FlickNearMiss | null;
  landmarks: NormalizedLandmark[] | null;
}

const FINGER_TIPS = [4, 8, 12, 16, 20];
const PALM_POINTS = [0, 5, 9, 13, 17];

const FIST_CLOSE_RATIO = 0.62;
const FIST_OPEN_RATIO = 0.8;

// Steering EMA on the palm point, per second: the old per-frame 0.35 at a webcam's 30 FPS, now
// independent of the camera's actual frame rate.
const SMOOTHING_RATE = perFrameRate(0.35, 30);
// Longest gap between two tracked frames the smoothing treats as continuous motion.
const MAX_SMOOTHING_DT = 0.1;

// Fist steering guard. Curling the fingers moves the knuckles, so the palm center (wrist + MCPs)
// shifts slightly as a fist closes or opens, which used to nudge the steering every time the
// player boosted. While the fist ratio is changing fast (faster than FIST_RATE_THRESHOLD per second,
// measured over at least FIST_RATE_SPAN_MS), or the open/closed state is mid-hysteresis, the
// steering sample is held. When the hand settles (FIST_SETTLE_MS without that motion) the shift the
// closing caused is kept as an offset for as long as the fist stays closed (capped at
// FIST_OFFSET_MAX, so a real move during the close isn't swallowed), and dropped again on opening.
// A hold never lasts longer than FIST_HOLD_MAX_MS, so steering can't freeze.
const FIST_RATE_SPAN_MS = 60;
const FIST_RATE_THRESHOLD = 1.5;
const FIST_SETTLE_MS = 90;
const FIST_HOLD_MAX_MS = 450;
const FIST_OFFSET_MAX = 0.06;
const FIST_HISTORY_MS = 200;

// The MediaPipe wasm/model/graph files are self-hosted: vite-plugin-mediapipe-assets.ts copies
// them out of the installed @mediapipe/hands package (so the version lives only in package.json)
// and serves them under this path, in dev and in the production build alike.
const MEDIAPIPE_ASSET_DIR = `${import.meta.env.BASE_URL}mediapipe/hands/`;

// The large files `start()` downloads, weighted by size for the pre-flight loading percentage
// (the small loader scripts and graph file are left out). MediaPipe picks the SIMD or plain wasm at
// runtime; both are ~6 MB, so they share one slot weighted by the SIMD build. The model file must
// match `modelComplexity` below (0 = lite).
const MODEL_FILE = 'hand_landmark_lite.tflite';
const PACKED_ASSETS_FILE = 'hands_solution_packed_assets.data';
const DOWNLOAD_WEIGHTS: Record<string, number> = {
  wasm: MEDIAPIPE_FILE_SIZES['hands_solution_simd_wasm_bin.wasm'] ?? 0,
  [PACKED_ASSETS_FILE]: MEDIAPIPE_FILE_SIZES[PACKED_ASSETS_FILE] ?? 0,
  [MODEL_FILE]: MEDIAPIPE_FILE_SIZES[MODEL_FILE] ?? 0,
};

function downloadSlot(fileName: string) {
  if (fileName.endsWith('.wasm')) return 'wasm';
  return fileName in DOWNLOAD_WEIGHTS ? fileName : null;
}

// Upper bound on loading the wasm + model and running the first frame through the graph. The
// assets are ~15 MB, so this is generous for slow connections while still turning a stuck load
// into a clear on-screen error instead of an endless "Show your hand" wait.
const TRACKING_START_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new TrackingStartError('timeout')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function dist2D(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class HandTracker {
  private hands: Hands;
  private videoEl: HTMLVideoElement;
  private onUpdate: (state: HandControlState) => void;

  // Frame loop state: a new frame is sent to MediaPipe only when the video has actually advanced.
  private rafId: number | null = null;
  private lastVideoTime = -1;
  // When the frame being processed was picked up, before inference: the gesture timing (flick
  // speed, smoothing) uses this, so MediaPipe's variable inference time doesn't jitter it.
  private frameStartMs: number | null = null;

  // Smoothed palm-center position, in mirrored-frame coordinates.
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private hasSmoothed = false;
  private lastTrackedMs: number | null = null;

  private fistFrameCounter = 0;
  private fistActive = false;
  // Fist steering guard (see FIST_*): recent fist ratios, the transition being held (if any), and
  // the palm-center shift a closed fist caused, subtracted from the steering point while closed.
  private fistRatios: { r: number; t: number }[] = [];
  private fistTransition: { startMs: number; lastMovingMs: number; anchorX: number; anchorY: number; wasActive: boolean } | null =
    null;
  // Set when a hold hit FIST_HOLD_MAX_MS: no new hold until the fist motion stops.
  private fistGuardSpent = false;
  private fistOffsetX = 0;
  private fistOffsetY = 0;
  private previousPoint: { x: number; y: number } | null = null;

  private stopped = false;
  // Stops the download meter `start()` installs; also called from `stop()` so an abandoned load
  // doesn't keep reporting.
  private stopMeter: (() => void) | null = null;

  // Calibrated neutral center — defaults to dead-center of frame, but the player sets it via
  // the calibration flow's "Set Center" step.
  private originX = 0.5;
  private originY = 0.5;

  // The 4-corner calibration box: flight pitch/roll are mapped strictly within this box, so
  // steering feels fitted to the player's own natural range of motion instead of a fixed gain.
  private corners: Partial<Record<CalibrationCorner, CalibrationPoint>> = {};
  private box: CalibrationBox = { ...DEFAULT_BOX };

  // The air brake (palm pushed toward the camera): the palm's apparent size against the size at
  // calibration. `palmSizeSmoothed` follows the size so the center capture can record it.
  private brake = new PalmBrakeDetector();
  private raise = new RaiseHoldDetector();
  private palmSizeSmoothed = 0;
  private lastSizeMs: number | null = null;
  private calibratedHandSize: number | null = null;

  // The backflip gesture, measured in box heights on the raw (un-smoothed) palm Y, tracked
  // independently of the smoothed steering signal so smoothing doesn't blur out the flick (see
  // project memory on gesture-control smoothing tradeoffs). It also holds the pitch output while a
  // flick is under way, so the flick doesn't double as a sharp climb.
  private flick = new FlickDetector();

  /** `videoEl` must already be playing the webcam stream; the tracker never opens the camera itself. */
  constructor(videoEl: HTMLVideoElement, onUpdate: (state: HandControlState) => void) {
    this.videoEl = videoEl;
    this.onUpdate = onUpdate;

    this.hands = new Hands({
      locateFile: (file) => `${MEDIAPIPE_ASSET_DIR}${file}`,
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

  /**
   * Loads MediaPipe (wasm + model), runs one warm-up frame through the full graph, then starts
   * the per-frame loop. Rejects with a `TrackingStartError` if loading fails or takes longer than
   * `TRACKING_START_TIMEOUT_MS`, so the UI can show a clear error instead of waiting forever.
   * `onProgress` receives the real download fraction (0..1) of the wasm, graph data and model as
   * bytes arrive; after it reaches 1 the graph still has to build and run its warm-up frame.
   */
  async start(onProgress?: (fraction: number) => void) {
    if (onProgress) {
      this.stopMeter = meterDownloads(MEDIAPIPE_ASSET_DIR, DOWNLOAD_WEIGHTS, downloadSlot, (fraction) => {
        if (!this.stopped) onProgress(fraction);
      });
    }
    try {
      await withTimeout(
        (async () => {
          await this.hands.initialize();
          // The first send() is what actually fetches the model and builds the graph, so it's
          // part of the load that the timeout covers.
          if (!this.stopped) await this.hands.send({ image: this.videoEl });
        })(),
        TRACKING_START_TIMEOUT_MS,
      );
    } catch (error) {
      if (error instanceof TrackingStartError) throw error;
      throw new TrackingStartError('load-failed', error);
    } finally {
      this.stopMeter?.();
      this.stopMeter = null;
    }
    if (this.stopped) return;
    this.scheduleFrame();
  }

  private scheduleFrame() {
    if (this.stopped) return;
    this.rafId = requestAnimationFrame(this.processFrame);
  }

  private processFrame = async () => {
    this.rafId = null;
    // Guard against a frame still in flight right after `stop()` — sending into (or closing) a
    // Hands instance mid-flight is what triggers MediaPipe's "Cannot pass deleted object as a
    // pointer" wasm error.
    if (this.stopped) return;
    const video = this.videoEl;
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.frameStartMs = performance.now();
      try {
        await this.hands.send({ image: video });
      } catch (error) {
        // A single frame occasionally failing inside MediaPipe's internal WASM/WebGL pipeline
        // (e.g. a transient GL context hiccup) shouldn't take down the whole tracking session
        // with an uncaught rejection — log it and keep going, since the next frame usually
        // recovers on its own (see project memory on MediaPipe per-frame error handling).
        if (!this.stopped) {
          console.warn('HandTracker: a frame failed to process, skipping it', error);
        }
      }
    }
    this.scheduleFrame();
  };

  /** Stops the frame loop and releases MediaPipe. Does not touch the video's MediaStream — the caller owns it. */
  stop() {
    this.stopped = true;
    this.stopMeter?.();
    this.stopMeter = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
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

  /**
   * Captures the current smoothed tracked position as the new neutral center, so the player
   * can hold their hand wherever is comfortable and declare that "straight ahead".
   * Returns the captured point for the calibration UI to draw a crosshair over, or null if no
   * hand is currently visible to capture from.
   */
  captureNeutralCenter(): CalibrationPoint | null {
    if (!this.hasSmoothed) return null;
    this.setOrigin(this.smoothedX, this.smoothedY);
    // The palm's size here is the air brake's reference ("my hand at its normal distance").
    if (this.palmSizeSmoothed > 0) this.setHandSize(this.palmSizeSmoothed);
    return this.getOrigin();
  }

  /** The palm size recorded at the center capture (saved with the calibration), if any. */
  getHandSize() {
    return this.calibratedHandSize ?? this.brake.getBaseline();
  }

  private setHandSize(size: number | null) {
    this.calibratedHandSize = size;
    this.brake.setBaseline(size);
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
    this.box = computeBox(this.corners);
    return point;
  }

  /**
   * Directly sets one corner of the calibration box to an explicit point (rather than reading
   * the live tracked position, as `captureCorner` does) and recomputes the box immediately.
   * Used by the calibration screen's drag-to-fine-tune corner handles.
   */
  setCorner(corner: CalibrationCorner, point: CalibrationPoint) {
    this.corners[corner] = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    this.box = computeBox(this.corners);
  }

  /**
   * Restores a complete calibration (center, 4 corners, palm size), e.g. one saved last session.
   * Its sensitivity is a steering setting the engine applies (both control modes), not the tracker.
   * A calibration saved before the air brake existed has no palm size: the brake measures one from
   * the first seconds of tracking instead.
   */
  applyCalibration(calibration: CalibrationData) {
    this.setOrigin(calibration.center.x, calibration.center.y);
    this.corners = {};
    for (const [corner, point] of Object.entries(calibration.corners) as [CalibrationCorner, CalibrationPoint][]) {
      this.corners[corner] = { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
    }
    this.box = computeBox(this.corners);
    this.setHandSize(calibration.handSize ?? null);
  }

  /** What's wrong with the current center + box, if anything (see validateCalibration). */
  getCalibrationProblems(): CalibrationProblem[] {
    return validateCalibration(this.getOrigin(), this.box);
  }

  /** Clears the neutral center and all captured corners back to their defaults. */
  resetCalibration() {
    this.originX = 0.5;
    this.originY = 0.5;
    this.corners = {};
    this.box = { ...DEFAULT_BOX };
    this.setHandSize(null);
  }

  private handleResults(results: Results) {
    const hand = results.multiHandLandmarks?.[0];
    const now = this.frameStartMs ?? performance.now();
    this.frameStartMs = null;

    if (!hand) {
      // Release the fist state along with the hand, so boost can't resume latched when the hand
      // reappears (the engine also drops boost on hand loss).
      this.fistFrameCounter = 0;
      this.fistActive = false;
      this.resetFistGuard();
      this.brake.release();
      this.previousPoint = null;
      // If the hand vanished right after a fast upward flick (the flick often carries the hand out
      // of the webcam frame entirely), the detector still honors the gesture once here.
      const lost = this.flick.handLost(now);
      this.raise.handLost(now);
      this.onUpdate({
        handDetected: false,
        pitch: 0,
        roll: 0,
        walk: 0,
        boost: false,
        backflip: lost.backflip,
        brake: false,
        takeoffHold: false,
        flickNearMiss: lost.nearMiss,
        landmarks: null,
      });
      return;
    }

    // Palm center: the steering point, and the reference for fist detection.
    let palmX = 0;
    let palmY = 0;
    for (const idx of PALM_POINTS) {
      palmX += hand[idx].x;
      palmY += hand[idx].y;
    }
    palmX /= PALM_POINTS.length;
    palmY /= PALM_POINTS.length;

    // Air brake: the palm's apparent size against its size at calibration. Pushing the hand toward
    // the camera also moves its image away from the frame's center, so the steering point is
    // corrected back by the same ratio (pushing in brakes without steering).
    const video = this.videoEl;
    const aspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 4 / 3;
    const size = palmSize(hand, aspect);
    const sizeDt = this.lastSizeMs === null ? 0 : Math.min((now - this.lastSizeMs) / 1000, MAX_SMOOTHING_DT);
    this.lastSizeMs = now;
    this.palmSizeSmoothed =
      this.palmSizeSmoothed > 0 ? this.palmSizeSmoothed + (size - this.palmSizeSmoothed) * damp(SMOOTHING_RATE, sizeDt) : size;
    const brake = this.brake.update(size, now);
    const steerX = depthCorrected(palmX, brake.ratio);
    const steerY = depthCorrected(palmY, brake.ratio);

    // Raw camera-frame Y of the steering point (the flick detector's input), and the X mirrored
    // horizontally (scaleX = -1) to match the mirrored webcam preview: this makes moving your hand
    // to your own left steer left and to your own right steer right, the way a mirror (or any
    // selfie camera app) naturally behaves.
    const trackedRawY = steerY;
    const mirroredTrackedX = 1 - steerX;

    // Fist detection: average fingertip distance from palm center, normalized by hand size.
    const wrist = hand[0];
    const middleMcp = hand[9];
    const handScale = dist2D(wrist, middleMcp) || 0.001;
    let tipDistSum = 0;
    for (const idx of FINGER_TIPS) {
      tipDistSum += dist2D(hand[idx], { x: palmX, y: palmY });
    }
    const fistRatio = tipDistSum / FINGER_TIPS.length / handScale;
    const wasFistActive = this.fistActive;

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

    const holdSteering = this.updateFistGuard(fistRatio, wasFistActive, mirroredTrackedX, trackedRawY, now);
    this.previousPoint = { x: mirroredTrackedX, y: trackedRawY };

    // Steering point: the palm center minus a closed fist's shift, smoothed with a frame-rate
    // independent EMA, and held (not updated) while a fist is closing or opening.
    const targetX = mirroredTrackedX - this.fistOffsetX;
    const targetY = trackedRawY - this.fistOffsetY;
    const frameDt = this.lastTrackedMs === null ? 0 : Math.min((now - this.lastTrackedMs) / 1000, MAX_SMOOTHING_DT);
    this.lastTrackedMs = now;
    if (!this.hasSmoothed) {
      this.smoothedX = targetX;
      this.smoothedY = targetY;
      this.hasSmoothed = true;
    } else if (!holdSteering) {
      const alpha = damp(SMOOTHING_RATE, frameDt);
      this.smoothedX += (targetX - this.smoothedX) * alpha;
      this.smoothedY += (targetY - this.smoothedY) * alpha;
    }

    // Map the smoothed tracked point onto -1..1 strictly within the calibrated box: at the
    // neutral center both axes read 0, at a calibrated corner the relevant axis reads +-1 —
    // steering is fitted to the player's own natural range of motion, not a fixed gain.
    const box = this.box;
    const rollRaw = axisValue(this.smoothedX, this.originX, box.right, box.left);
    // Y grows downward on screen, so climbing (moving up) needs the sign flipped relative to
    // axisValue's "greater than center = positive" convention.
    const pitchRaw = axisValue(-this.smoothedY, -this.originY, -box.top, -box.bottom);

    // Deadzone, then the comfort expo (gentle near the center, sharp at the edge of the box). The
    // steering sensitivity is turn authority, applied by the engine for both control modes.
    const roll = expoCurve(applyDeadzone(rollRaw, STEERING_DEADZONE));
    const steeringPitch = expoCurve(applyDeadzone(pitchRaw, STEERING_DEADZONE));

    // Backflip gesture on the raw palm Y, in heights of the calibrated box. While a flick is under
    // way the detector hands back the pre-flick pitch instead of the spike the flick causes.
    const flick = this.flick.update(trackedRawY, box.bottom - box.top, now, steeringPitch);
    // Raise-and-hold takeoff, on the smoothed steering point's height within the box.
    const takeoffHold = this.raise.update((this.smoothedY - box.top) / Math.max(box.bottom - box.top, 0.05), now);

    this.onUpdate({
      handDetected: true,
      pitch: flick.pitch,
      roll,
      walk: Math.max(0, -steeringPitch),
      boost: this.fistActive,
      backflip: flick.backflip,
      brake: brake.brake,
      takeoffHold,
      flickNearMiss: flick.nearMiss,
      landmarks: hand,
    });
  }

  /**
   * Follows the fist ratio and decides whether the steering sample is held this frame (see
   * FIST_*). Updates the closed-fist offset when a transition settles.
   */
  private updateFistGuard(fistRatio: number, wasActive: boolean, x: number, y: number, now: number) {
    this.fistRatios.push({ r: fistRatio, t: now });
    while (this.fistRatios.length > 0 && now - this.fistRatios[0].t > FIST_HISTORY_MS) this.fistRatios.shift();
    let rate = 0;
    for (let i = this.fistRatios.length - 2; i >= 0; i -= 1) {
      const sample = this.fistRatios[i];
      if (now - sample.t >= FIST_RATE_SPAN_MS) {
        rate = Math.abs(fistRatio - sample.r) / ((now - sample.t) / 1000);
        break;
      }
    }
    const moving = rate > FIST_RATE_THRESHOLD || this.fistFrameCounter > 0 || this.fistActive !== wasActive;
    if (!moving) this.fistGuardSpent = false;

    let transition = this.fistTransition;
    if (moving && !transition && !this.fistGuardSpent) {
      // Anchor on the previous frame's point: the motion was already under way by this frame.
      const anchor = this.previousPoint ?? { x, y };
      transition = { startMs: now, lastMovingMs: now, anchorX: anchor.x, anchorY: anchor.y, wasActive };
      this.fistTransition = transition;
    } else if (moving && transition) {
      transition.lastMovingMs = now;
    }
    if (!transition) return false;

    const settled = now - transition.lastMovingMs > FIST_SETTLE_MS;
    const expired = now - transition.startMs > FIST_HOLD_MAX_MS;
    if (!settled && !expired) return true;

    // Settled (or held too long): keep a closing fist's shift as an offset while it stays closed.
    this.fistTransition = null;
    if (expired && !settled) this.fistGuardSpent = true;
    if (!this.fistActive) {
      this.fistOffsetX = 0;
      this.fistOffsetY = 0;
    } else if (!transition.wasActive) {
      const dx = x - transition.anchorX;
      const dy = y - transition.anchorY;
      const scale = Math.min(1, FIST_OFFSET_MAX / (Math.hypot(dx, dy) || 1));
      this.fistOffsetX = dx * scale;
      this.fistOffsetY = dy * scale;
    }
    return false;
  }

  private resetFistGuard() {
    this.fistRatios = [];
    this.fistTransition = null;
    this.fistGuardSpent = false;
    this.fistOffsetX = 0;
    this.fistOffsetY = 0;
  }
}
