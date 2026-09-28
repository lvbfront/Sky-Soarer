import { useId, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { BookOpen, ChevronLeft, Play } from 'lucide-react';
import { CornerBrackets } from '@/ui/hud';

interface PauseMenuProps {
  /** "Pigeon · Mountain Valley · Sunny Morning" */
  summary: string;
  /** Ring Challenge score, or null when rings are off. */
  score: number | null;
  reducedMotion: boolean;
  onResume: () => void;
  onGuide: () => void;
  onExit: () => void;
}

/**
 * The pause menu, in the flight HUD's instrument style. The game loop is frozen while it's open
 * (App pauses the engine and the keyboard input). Esc is handled by App.
 */
export function PauseMenu({ summary, score, reducedMotion, onResume, onGuide, onExit }: PauseMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const resumeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    resumeRef.current?.focus({ preventScroll: true });
    const root = rootRef.current;
    if (!root || reducedMotion) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline()
        .fromTo('[data-pause-scrim]', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none' })
        .fromTo('[data-pause-panel]', { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' }, 0);
    }, root);
    return () => ctx.revert();
    // A one-shot entrance on mount.
  }, []);

  const secondary =
    'ascent-hud ascent-glass flex w-full items-center gap-3 rounded-full px-5 py-3 text-left text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[35] flex items-center justify-center px-4 text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div data-pause-scrim className="pointer-events-none fixed inset-0 bg-[#06101f]/50" />
      <div className="ascent-grain pointer-events-none fixed inset-0" />
      <section data-pause-panel className="ascent-glass-strong relative w-full max-w-sm rounded-[24px] p-6 shadow-2xl sm:p-7">
        <CornerBrackets size={14} inset={9} className="text-white/35" />
        <p className="ascent-hud flex items-center gap-2.5 text-[color:var(--ascent-cyan)]">
          <span className="ascent-breathe h-1.5 w-1.5 rounded-full bg-[color:var(--ascent-warm)]" aria-hidden="true" />
          Flight paused
        </p>
        <h2 id={titleId} className="mt-2 font-display text-5xl leading-none tracking-[-0.015em]">
          Holding pattern
        </h2>
        <p className="ascent-hud mt-3 text-[10px] leading-relaxed text-white/60">
          {summary}
          {score !== null && (
            <>
              <span className="mx-1.5 text-white/35">·</span>
              <span className="text-white/85">Rings {score}</span>
            </>
          )}
        </p>

        <div className="mt-6 space-y-2.5">
          <button
            ref={resumeRef}
            type="button"
            onClick={onResume}
            className="group flex w-full items-center justify-between rounded-full bg-white py-2 pl-5 pr-2 text-[color:var(--ascent-ink)] transition-colors hover:bg-[color:var(--ascent-warm)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <span className="flex items-center gap-3 text-base font-semibold">
              <Play className="h-4 w-4 fill-current" />
              Resume
            </span>
            <kbd className="ascent-hud rounded-full bg-[color:var(--ascent-ink)] px-3 py-2 text-[10px] text-white">Esc</kbd>
          </button>
          <button type="button" onClick={onGuide} className={secondary}>
            <BookOpen className="h-4 w-4 text-[color:var(--ascent-cyan)]" />
            How to fly
          </button>
          <button type="button" onClick={onExit} className={secondary}>
            <ChevronLeft className="h-4 w-4 text-white/70" />
            Back to landing
          </button>
        </div>
      </section>
    </div>
  );
}
