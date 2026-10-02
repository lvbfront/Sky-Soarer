import { useEffect, useRef, type RefObject } from 'react';
import type { GameEngine } from '@/game/GameEngine';

/** On only with `?debug=flight` in the URL: nothing is stored, and it's off by default. */
export function isFlightDebugEnabled() {
  try {
    return new URLSearchParams(window.location.search).get('debug') === 'flight';
  } catch {
    return false;
  }
}

const REFRESH_MS = 100;

const fixed = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

/**
 * The flight debug overlay (?debug=flight): state and substate, speed, yaw rate, bank, AGL, brake,
 * surface slope, landable, the steering settings, FPS and draw calls, written straight into a <pre>
 * ten times a second (no React renders). For precise feedback on a deployed preview.
 */
export function DebugOverlay({ engineRef }: { engineRef: RefObject<GameEngine | null> }) {
  const textRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();
    let fps = 0;
    let lastWrite = 0;
    const tick = (now: number) => {
      frames += 1;
      if (now - windowStart >= 1000) {
        fps = (frames * 1000) / (now - windowStart);
        frames = 0;
        windowStart = now;
      }
      const engine = engineRef.current;
      if (engine && textRef.current && now - lastWrite >= REFRESH_MS) {
        lastWrite = now;
        const d = engine.getDebugInfo();
        textRef.current.textContent = [
          `STATE    ${d.state}${d.substate ? ` / ${d.substate}` : ''}`,
          `SPEED    ${fixed(d.speed, 2)} m/s`,
          `YAW RATE ${fixed(d.yawRate, 1)} °/s`,
          `BANK     ${fixed(d.bank, 1)} °`,
          `AGL      ${fixed(d.agl, 2)} m`,
          `BRAKE    ${d.brake ? 'ON' : 'off'}`,
          `SLOPE    ${fixed(d.slope, 1)} °`,
          `LANDABLE ${d.landable === null ? '—' : d.landable ? 'yes' : 'no'}`,
          `STEERING sens ${d.steering.sensitivity.toFixed(1)}x · invert ${d.steering.invertPitch ? 'on' : 'off'}`,
          `FPS      ${fps.toFixed(0)} · ${d.drawCalls} draws`,
        ].join('\n');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineRef]);

  return (
    <pre
      ref={textRef}
      data-flight-debug
      className="pointer-events-none fixed left-6 top-44 z-20 rounded-md border border-white/20 bg-[#06101f]/75 px-3 py-2 font-mono text-[11px] leading-[1.45] text-[color:var(--ascent-cyan)] sm:left-8"
      aria-hidden="true"
    />
  );
}
