// The hand's raise-and-hold takeoff gesture: the palm held in the top TAKEOFF_RAISE_ZONE of the
// calibrated box for TAKEOFF_RAISE_HOLD seconds. Pure, so it's unit-tested with synthetic tracks at
// low tracker rates. In flight the same pose is just a full climb: the engine only reads the flag
// while the bird is standing or floating.
import { TAKEOFF_RAISE_GAP, TAKEOFF_RAISE_HOLD, TAKEOFF_RAISE_ZONE } from './flightTuning';

export class RaiseHoldDetector {
  private since: number | null = null;
  private lostAt: number | null = null;

  /**
   * One tracked frame: `boxY` is the palm's height in the calibrated box (0 at its top edge, 1 at the
   * bottom; above the box is negative), `now` in ms. Returns true while the hold is complete.
   */
  update(boxY: number, now: number) {
    this.lostAt = null;
    if (boxY > TAKEOFF_RAISE_ZONE) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    return now - this.since >= TAKEOFF_RAISE_HOLD * 1000;
  }

  /**
   * A frame without a hand. A short dropout (a missed detection at a low tracker rate) keeps the
   * hold going; a longer one, TAKEOFF_RAISE_GAP or more, cancels it.
   */
  handLost(now: number) {
    this.lostAt ??= now;
    if (now - this.lostAt >= TAKEOFF_RAISE_GAP * 1000) this.since = null;
    return false;
  }
}
