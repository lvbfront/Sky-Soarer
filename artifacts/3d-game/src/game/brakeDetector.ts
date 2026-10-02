// The hand air-brake gesture: the open palm pushed toward the camera. Pure (no MediaPipe, no DOM),
// so it's unit-tested with synthetic size tracks. The thresholds live in trackingShared.ts (the
// guide quotes them).
import {
  BRAKE_BASELINE_MIN_FRAMES,
  BRAKE_BASELINE_MS,
  BRAKE_ENGAGE_RATIO,
  BRAKE_HOLD_MS,
  BRAKE_RELEASE_RATIO,
} from './trackingShared';

export interface BrakeFrame {
  brake: boolean;
  /** Apparent palm size relative to the baseline (1 while no baseline is known yet). */
  ratio: number;
}

export class PalmBrakeDetector {
  private baseline: number | null = null;
  private samples: number[] = [];
  private firstSampleMs: number | null = null;
  private aboveSince: number | null = null;
  private active = false;

  constructor(baseline?: number | null) {
    this.setBaseline(baseline ?? null);
  }

  /** The palm size at calibration; null starts measuring one from the next frames instead. */
  setBaseline(size: number | null) {
    this.baseline = size !== null && Number.isFinite(size) && size > 0 ? size : null;
    this.samples = [];
    this.firstSampleMs = null;
    this.release();
  }

  getBaseline() {
    return this.baseline;
  }

  /** Feeds one tracked frame's palm size (see `palmSize`) at time `now` (ms). */
  update(size: number, now: number): BrakeFrame {
    if (!(size > 0)) return { brake: this.active, ratio: 1 };
    if (this.baseline === null) {
      // No calibrated size: the median of the first seconds of tracking is the player's normal
      // distance from the camera. No brake until then.
      this.firstSampleMs ??= now;
      this.samples.push(size);
      if (now - this.firstSampleMs >= BRAKE_BASELINE_MS && this.samples.length >= BRAKE_BASELINE_MIN_FRAMES) {
        const sorted = [...this.samples].sort((a, b) => a - b);
        this.baseline = sorted[Math.floor(sorted.length / 2)];
        this.samples = [];
      }
      return { brake: false, ratio: 1 };
    }
    const ratio = size / this.baseline;
    if (this.active) {
      if (ratio < BRAKE_RELEASE_RATIO) this.release();
    } else if (ratio >= BRAKE_ENGAGE_RATIO) {
      this.aboveSince ??= now;
      if (now - this.aboveSince >= BRAKE_HOLD_MS) this.active = true;
    } else {
      this.aboveSince = null;
    }
    return { brake: this.active, ratio };
  }

  /** The hand left the frame: the brake lets go (a lost hand must never stay braking). */
  release() {
    this.active = false;
    this.aboveSince = null;
  }
}
