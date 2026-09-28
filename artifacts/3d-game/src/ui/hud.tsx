import type { CSSProperties } from 'react';

/**
 * Four L-shaped corner marks, the instrument-frame motif shared by the boot HUD, the sensor feeds
 * and the flight HUD. Absolutely positioned: place inside a `relative` parent. Colored by
 * `currentColor`.
 */
export function CornerBrackets({
  size = 14,
  thickness = 1.5,
  inset = 0,
  className = '',
  style,
}: {
  size?: number;
  thickness?: number;
  /** Distance from the parent's edges, in px. */
  inset?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const arm = { width: size, height: size, borderColor: 'currentColor' } as const;
  const edge = `${thickness}px`;
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute ${className}`} style={{ inset, ...style }}>
      <span className="absolute left-0 top-0" style={{ ...arm, borderTopWidth: edge, borderLeftWidth: edge }} />
      <span className="absolute right-0 top-0" style={{ ...arm, borderTopWidth: edge, borderRightWidth: edge }} />
      <span className="absolute bottom-0 left-0" style={{ ...arm, borderBottomWidth: edge, borderLeftWidth: edge }} />
      <span className="absolute bottom-0 right-0" style={{ ...arm, borderBottomWidth: edge, borderRightWidth: edge }} />
    </div>
  );
}

/** The small "Sky Soarer" wordmark used in the top-left of the landing chrome. */
export function Wordmark({ suffix }: { suffix?: string }) {
  return (
    <div className="ascent-hud flex items-center gap-3 text-white/90">
      <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
        <path d="M3 19 L16 11 L29 19 L16 15 Z" fill="currentColor" />
        <path d="M16 15 L16 24" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="font-medium text-white">Sky Soarer</span>
      {suffix && <span className="hidden text-white/50 sm:inline">/ {suffix}</span>}
    </div>
  );
}
