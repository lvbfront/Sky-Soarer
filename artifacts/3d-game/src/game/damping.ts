/**
 * Frame-rate independent smoothing. `value += (target - value) * damp(rate, dt)` closes the same
 * fraction of the gap per second whatever the frame rate, unlike a fixed per-frame factor, which
 * converges twice as fast at 120 Hz as at 60 Hz.
 */
export function damp(rate: number, dt: number) {
  return 1 - Math.exp(-rate * dt);
}

/**
 * The `damp` rate that behaves exactly like the per-frame factor `alpha` at `fps` frames per
 * second: `damp(perFrameRate(a, fps), 1 / fps) === a`. Used to convert the old per-frame lerp
 * constants without changing how they feel at their reference frame rate.
 */
export function perFrameRate(alpha: number, fps: number) {
  return -Math.log(1 - alpha) * fps;
}
