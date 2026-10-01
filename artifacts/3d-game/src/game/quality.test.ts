import { describe, expect, it } from 'vitest';
import { AUTO_WARMUP_SECONDS, AUTO_WINDOW_SECONDS, AutoQualityMonitor, QUALITY_PROFILES, levelFor } from './quality';

function run(monitor: AutoQualityMonitor, fps: number, seconds: number) {
  let dropped = false;
  for (let t = 0; t < seconds; t += 1 / fps) if (monitor.sample(1 / fps)) dropped = true;
  return dropped;
}

describe('AutoQualityMonitor', () => {
  it('never drops at a steady 60 FPS', () => {
    expect(run(new AutoQualityMonitor(), 60, 60)).toBe(false);
  });

  it('drops once the average stays under 50 FPS for the window', () => {
    const monitor = new AutoQualityMonitor();
    expect(run(monitor, 40, AUTO_WARMUP_SECONDS + AUTO_WINDOW_SECONDS - 0.5)).toBe(false);
    expect(run(monitor, 40, 1)).toBe(true);
    expect(monitor.hasDropped()).toBe(true);
    // Only once.
    expect(run(monitor, 20, 20)).toBe(false);
  });

  it('ignores the warm-up and single long hitches', () => {
    const monitor = new AutoQualityMonitor();
    // Slow during warm-up (shader compiles): not counted.
    expect(run(monitor, 10, AUTO_WARMUP_SECONDS - 0.2)).toBe(false);
    // Smooth, with a 0.5 s hitch every few seconds (tab switch, GC): not a slow frame rate.
    let dropped = false;
    for (let i = 0; i < 10; i += 1) {
      if (run(monitor, 60, 3)) dropped = true;
      if (monitor.sample(0.5)) dropped = true;
    }
    expect(dropped).toBe(false);
  });

  it('restarts its window after reset (e.g. resuming from pause)', () => {
    const monitor = new AutoQualityMonitor();
    run(monitor, 60, AUTO_WARMUP_SECONDS + 1);
    run(monitor, 30, AUTO_WINDOW_SECONDS - 1);
    monitor.reset(1);
    expect(run(monitor, 60, AUTO_WINDOW_SECONDS + 2)).toBe(false);
  });
});

describe('quality levels', () => {
  it('resolves the setting', () => {
    expect(levelFor('auto', 'high')).toBe('high');
    expect(levelFor('auto', 'low')).toBe('low');
    expect(levelFor('high', 'low')).toBe('high');
    expect(levelFor('low', 'high')).toBe('low');
  });

  it('Low is never heavier than High', () => {
    const { high, low } = QUALITY_PROFILES;
    expect(low.pixelRatioCap).toBeLessThanOrEqual(high.pixelRatioCap);
    expect(low.reefDensity).toBeLessThanOrEqual(high.reefDensity);
    expect(low.reefRadius).toBeLessThanOrEqual(high.reefRadius);
    expect(low.marineSnow).toBeLessThanOrEqual(high.marineSnow);
    expect(low.lightShafts).toBeLessThanOrEqual(high.lightShafts);
    expect(low.decorRadius).toBeLessThanOrEqual(high.decorRadius);
    expect(low.waterSegments).toBeLessThanOrEqual(high.waterSegments);
  });
});
