/**
 * Frame-rate independent smoothing. `value += (target - value) * damp(rate, dt)` closes the same
 * fraction of the gap per second whatever the frame rate, unlike a fixed per-frame factor, which
 * converges twice as fast at 120 Hz as at 60 Hz.
 */
export function damp(rate: number, dt: number) {
  return 1 - Math.exp(-rate * dt);
}
