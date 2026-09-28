// The backflip gesture: a fast upward flick of the raw (un-smoothed) palm point, measured in heights
// of the player's calibrated box. Pure (no MediaPipe, no DOM) so it can be unit-tested with
// synthetic tracks at any frame rate. The thresholds live in trackingShared.ts (the guide quotes them).
import {
  BACKFLIP_COOLDOWN_MS,
  FLICK_MIN_RISE,
  FLICK_MIN_SPEED,
  FLICK_SPEED_SPAN_MS,
  FLICK_WINDOW_MS,
  type FlickNearMiss,
} from './trackingShared';

// Near-miss coaching. Each upward stroke of the raw palm point (from when it starts rising until it
// drops back or stalls) is scored once when it ends. A stroke that never fired a backflip but got
// this close to *both* thresholds counts as an attempted flick. The speed bar (~2.6 box/s) sits above
// ordinary steering: a brisk center-to-top move peaks around 2.2 box/s, and a full bottom-to-top
// sweep has to take under 0.57 s to reach it.
const NEAR_MISS_MIN_RISE = FLICK_MIN_RISE * 0.6;
const NEAR_MISS_MIN_SPEED = FLICK_MIN_SPEED * 0.75;
// A stroke starts once the point rises by more than this (box heights) between two frames, and
// ends when it falls back STROKE_END_DROP below its highest point or makes no new high for
// STROKE_STALL_MS.
const STROKE_START_EPSILON = 0.01;
const STROKE_END_DROP = 0.05;
const STROKE_STALL_MS = 120;
// At most one hint this often, so a player practising doesn't get a hint on every attempt.
const NEAR_MISS_INTERVAL_MS = 2500;

// Pitch-spike suppression. A flick is also a big, fast "climb" input for the steering path, which
// would jerk the bird's nose up just as the (purely cosmetic) backflip starts. Once a stroke is
// moving faster than steering normally does, the pitch output is held at its value from just before
// the stroke. A stroke that fires keeps the hold until FLICK_PITCH_RECOVERY_MS after it ends, which
// also covers the hand dropping back to where it was steering from. One that doesn't is released
// when it ends, or once it has run for FLICK_WINDOW_MS without firing (a real flick fires well within
// that), so even a very fast steering sweep is delayed by a fraction of a second at most.
const PITCH_HOLD_SPEED = NEAR_MISS_MIN_SPEED;
const FLICK_PITCH_RECOVERY_MS = 450;

// If the hand disappears shortly after a fast upward movement that had already risen this much
// (common when the flick carries the hand out of the frame), still fire the backflip once rather
// than losing the gesture.
const HAND_LOST_GRACE_MS = 300;
const HAND_LOST_MIN_RISE = FLICK_MIN_RISE * 0.5;

// Frames further apart than this are a tracking gap, not motion: the history restarts.
const MAX_FRAME_GAP_MS = 400;

interface Sample {
  y: number;
  t: number;
  /** Upward speed measured on this sample (see `update`), box heights per second. */
  speed: number;
}

interface Stroke {
  startMs: number;
  /** Highest point (smallest y) reached so far, and when it was last raised. */
  minY: number;
  lastRiseMs: number;
  /** A pitch hold this stroke started was released early (it ran too long to be a flick). */
  holdSpent: boolean;
  /** Largest window rise and peak speed seen during the stroke. */
  maxRise: number;
  peakSpeed: number;
  /** Met both thresholds (even if the cooldown swallowed the backflip): never a near miss. */
  fired: boolean;
}

export interface FlickFrame {
  /** One-shot: true on the frame a backflip fires. */
  backflip: boolean;
  /** One-shot: set on the frame a near-miss stroke ends. */
  nearMiss: FlickNearMiss | null;
  /** The pitch to output this frame: the input, or the held pre-flick value while suppressing. */
  pitch: number;
  /** Diagnostics for tests and tuning: the window's rise and peak speed, in box units. */
  rise: number;
  speed: number;
}

export class FlickDetector {
  private history: Sample[] = [];
  private stroke: Stroke | null = null;
  private lastY: number | null = null;
  private lastPitch = 0;
  private lastBackflipMs = -Infinity;
  private lastFastMs = -Infinity;
  private lastNearMissMs = -Infinity;
  // Pitch hold: the held value, and until when (Infinity while the stroke is still going).
  private heldPitch: number | null = null;
  private holdUntilMs = -Infinity;
  // The pitch from just before the current stroke started: what a suppressed flick holds.
  private strokeStartPitch = 0;

  /**
   * Feeds one tracked frame. `rawY` is the palm center's raw camera-frame Y (0 top .. 1 bottom),
   * `boxHeight` the calibrated box's height in the same units, `now` the frame time in ms, and
   * `pitch` the steering pitch computed for this frame (returned, or replaced while held).
   */
  update(rawY: number, boxHeight: number, now: number, pitch: number): FlickFrame {
    const y = rawY / Math.max(boxHeight, 0.05);
    const previous = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    if (previous && now - previous.t > MAX_FRAME_GAP_MS) this.resetMotion();

    // Speed: over the shortest step back that spans at least FLICK_SPEED_SPAN_MS (2 frames at
    // 30 FPS, 3 at 60), so it's steady against single-frame jitter but still a short-span speed.
    let speed = 0;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      const sample = this.history[i];
      const dt = now - sample.t;
      if (dt >= FLICK_SPEED_SPAN_MS) {
        speed = Math.max(0, (sample.y - y) / (dt / 1000));
        break;
      }
    }

    this.history.push({ y, t: now, speed });
    while (this.history.length > 0 && now - this.history[0].t > FLICK_WINDOW_MS) this.history.shift();

    // Over the window: the rise from its lowest point up to now (y grows downward), and the peak of
    // the short-span speeds. A flick's speed peaks mid-snap, before it has risen far enough, so the
    // two are judged over the window rather than on the same frame.
    let lowest = y;
    let peakSpeed = 0;
    for (const sample of this.history) {
      lowest = Math.max(lowest, sample.y);
      peakSpeed = Math.max(peakSpeed, sample.speed);
    }
    const rise = lowest - y;

    let backflip = false;
    if (speed >= FLICK_MIN_SPEED) this.lastFastMs = now;
    const flick = peakSpeed >= FLICK_MIN_SPEED && rise >= FLICK_MIN_RISE;
    if (flick && now - this.lastBackflipMs > BACKFLIP_COOLDOWN_MS) {
      backflip = true;
      this.lastBackflipMs = now;
    }

    const nearMiss = this.trackStroke(y, rise, speed, flick, now);
    const outPitch = this.holdPitch(pitch, now);
    this.lastPitch = pitch;
    return { backflip, nearMiss, pitch: outPitch, rise, speed: peakSpeed };
  }

  /** The hand left the frame: maybe honor a flick that carried it out, and score the open stroke. */
  handLost(now: number): { backflip: boolean; nearMiss: FlickNearMiss | null } {
    const stroke = this.stroke;
    const backflip =
      stroke !== null &&
      !stroke.fired &&
      stroke.maxRise >= HAND_LOST_MIN_RISE &&
      now - this.lastFastMs <= HAND_LOST_GRACE_MS &&
      now - this.lastBackflipMs > BACKFLIP_COOLDOWN_MS;
    if (backflip) {
      this.lastBackflipMs = now;
      stroke.fired = true;
    }
    // A stroke cut short by the hand leaving the frame is still scored.
    const nearMiss = stroke ? this.finishStroke(now) : null;
    this.resetMotion();
    this.heldPitch = null;
    this.holdUntilMs = -Infinity;
    return { backflip, nearMiss };
  }

  private resetMotion() {
    this.history = [];
    this.stroke = null;
    this.lastY = null;
  }

  /** Follows the current upward stroke and, on the frame it ends, returns whether it was a near miss. */
  private trackStroke(y: number, rise: number, speed: number, flick: boolean, now: number): FlickNearMiss | null {
    const previousY = this.lastY;
    this.lastY = y;
    if (!this.stroke) {
      if (!flick && (previousY === null || previousY - y <= STROKE_START_EPSILON)) return null;
      this.stroke = {
        startMs: now,
        minY: y,
        lastRiseMs: now,
        holdSpent: false,
        maxRise: 0,
        peakSpeed: 0,
        fired: false,
      };
      if (this.heldPitch === null) this.strokeStartPitch = this.lastPitch;
    } else if (y < this.stroke.minY) {
      this.stroke.minY = y;
      this.stroke.lastRiseMs = now;
    }
    const stroke = this.stroke;
    stroke.maxRise = Math.max(stroke.maxRise, rise);
    stroke.peakSpeed = Math.max(stroke.peakSpeed, speed);
    if (flick) stroke.fired = true;
    const flickLength = now - stroke.startMs <= FLICK_WINDOW_MS;
    if (stroke.peakSpeed >= PITCH_HOLD_SPEED && this.heldPitch === null && !stroke.holdSpent && (flickLength || stroke.fired)) {
      this.heldPitch = this.strokeStartPitch;
      this.holdUntilMs = Infinity;
    } else if (this.heldPitch !== null && this.holdUntilMs === Infinity && !stroke.fired && !flickLength) {
      // Still going without having fired: steering, not a flick. Let the pitch through.
      this.holdUntilMs = now;
      stroke.holdSpent = true;
    }
    const ended = y > stroke.minY + STROKE_END_DROP || now - stroke.lastRiseMs > STROKE_STALL_MS;
    return ended ? this.finishStroke(now) : null;
  }

  /** Ends the current stroke and scores it (see NEAR_MISS_*). */
  private finishStroke(now: number): FlickNearMiss | null {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return null;
    // Release a stroke's pitch hold: at once if it was only fast steering, after a short recovery
    // if it was a real flick.
    if (this.heldPitch !== null && this.holdUntilMs === Infinity) {
      this.holdUntilMs = stroke.fired ? now + FLICK_PITCH_RECOVERY_MS : now;
    }
    if (stroke.fired) return null;
    if (stroke.maxRise < NEAR_MISS_MIN_RISE || stroke.peakSpeed < NEAR_MISS_MIN_SPEED) return null;
    // Right after a backflip the player is recovering, not practising; and don't nag.
    if (now - this.lastBackflipMs < BACKFLIP_COOLDOWN_MS || now - this.lastNearMissMs < NEAR_MISS_INTERVAL_MS) {
      return null;
    }
    this.lastNearMissMs = now;
    // Whichever threshold it fell further short of (only one of them, if it met the other).
    const riseRatio = stroke.maxRise / FLICK_MIN_RISE;
    const speedRatio = stroke.peakSpeed / FLICK_MIN_SPEED;
    return speedRatio < riseRatio ? 'too-slow' : 'too-short';
  }

  private holdPitch(pitch: number, now: number) {
    if (this.heldPitch === null) return pitch;
    if (now >= this.holdUntilMs) {
      this.heldPitch = null;
      this.holdUntilMs = -Infinity;
      return pitch;
    }
    return this.heldPitch;
  }
}
