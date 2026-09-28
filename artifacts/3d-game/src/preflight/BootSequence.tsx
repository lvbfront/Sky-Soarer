import { useEffect, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import { CornerBrackets, Wordmark } from '@/ui/hud';

export type BootTone = 'idle' | 'active' | 'ok' | 'fail';

export interface BootLine {
  key: string;
  label: string;
  /** The bracketed readout, e.g. "REQUESTING", "LOADING 42%", "READY". */
  status: string;
  tone: BootTone;
  /** 0..1 draws a progress hairline under the line; null hides it. */
  progress: number | null;
}

interface BootSequenceProps {
  lines: BootLine[];
  /** The line an error is reported under; null while the boot is healthy. */
  errorLineKey: string | null;
  errorMessage: string | null;
  errorDetail: string | null;
  /** `performance.now()` when this boot attempt began, for the T+ clock. */
  startedAt: number;
  /** False freezes the T+ clock (after a failure). */
  running: boolean;
  reducedMotion: boolean;
  onRetry: () => void;
  onBack: () => void;
}

// Typing speed and the stagger between lines. With three lines this finishes in about a second,
// which is also the shortest a boot is allowed to take (BOOT_MIN_DURATION_MS in App.tsx).
const TYPE_SECONDS_PER_CHAR = 0.022;
const LINE_STAGGER_SECONDS = 0.26;

const TONE_CLASS: Record<BootTone, string> = {
  idle: 'text-white/45',
  active: 'text-[color:var(--ascent-warm)]',
  ok: 'text-[color:var(--ascent-cyan)]',
  fail: 'text-[color:var(--ascent-fault)]',
};

/**
 * Pre-flight step 1: a full-screen boot HUD whose lines report the real startup events (camera
 * permission, model download, calibration), with any failure reported inline under its line.
 */
export function BootSequence({
  lines,
  errorLineKey,
  errorMessage,
  errorDetail,
  startedAt,
  running,
  reducedMotion,
  onRetry,
  onBack,
}: BootSequenceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const failed = errorLineKey !== null;

  // Type each line's label in, then reveal its leader and status. Labels are written straight to
  // the DOM (React renders those spans empty and never touches them) so typing never re-renders.
  // This runs once per mount: a Try Again keeps the lines on screen and only their statuses change.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const rows = gsap.utils.toArray<HTMLElement>('[data-boot-line]', root);
      const timeline = gsap.timeline({ delay: 0.12 });
      rows.forEach((row, index) => {
        const label = row.querySelector<HTMLElement>('[data-type]');
        const caret = row.querySelector<HTMLElement>('[data-caret]');
        const after = row.querySelectorAll('[data-after-type]');
        const text = label?.dataset.type ?? '';
        if (!label) return;
        if (reducedMotion) {
          label.textContent = text;
          if (caret) gsap.set(caret, { display: 'none' });
          return;
        }
        label.textContent = '';
        gsap.set(after, { opacity: 0 });
        if (caret) gsap.set(caret, { opacity: 0 });
        const typed = { chars: 0 };
        const start = index * LINE_STAGGER_SECONDS;
        if (caret) timeline.set(caret, { opacity: 1 }, start);
        timeline
          .to(
            typed,
            {
              chars: text.length,
              duration: text.length * TYPE_SECONDS_PER_CHAR,
              ease: 'none',
              onUpdate: () => {
                label.textContent = text.slice(0, Math.round(typed.chars));
              },
            },
            start,
          )
          .to(after, { opacity: 1, duration: 0.18, ease: 'none' }, '>');
        if (caret) timeline.set(caret, { display: 'none' }, '>');
      });
    }, root);
    return () => ctx.revert();
    // Typing is a one-shot on mount; status changes must not replay it.
  }, []);

  // The T+ clock shows real elapsed time since this boot attempt began.
  useEffect(() => {
    const el = clockRef.current;
    if (!el) return;
    const write = () => {
      el.textContent = ((performance.now() - startedAt) / 1000).toFixed(1).padStart(4, '0');
    };
    write();
    if (!running) return;
    let raf = 0;
    const tick = () => {
      write();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, running]);

  return (
    <div ref={rootRef} className="fixed inset-0 z-30 overflow-y-auto text-white">
      {/* Ink scrim over the frozen backdrop: heavier on the left where the readout sits. */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(6,16,31,0.78) 0%, rgba(6,16,31,0.6) 45%, rgba(6,16,31,0.35) 100%)',
        }}
      />
      <div className="ascent-grain pointer-events-none fixed inset-0" />
      <CornerBrackets size={22} inset={18} className="fixed text-white/35" />

      <header className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-8">
        <Wordmark suffix="Pre-flight" />
        <p className="ascent-hud text-white/75">
          {failed ? 'Halted' : 'Systems check'}
          <span className="mx-2 text-white/35">—</span>T+ <span ref={clockRef}>00.0</span> s
        </p>
      </header>

      <main className="relative flex min-h-full items-center py-24 pl-[clamp(1.5rem,9vw,9.5rem)] pr-6">
        <div className="w-full max-w-[40rem]">
          <p className="ascent-hud mb-5 flex items-center gap-3 text-[color:var(--ascent-cyan)]">
            <span>Pre-flight</span>
            <span className="h-px w-10 bg-current opacity-60" />
            <span>01 / 02</span>
            <span className="opacity-60">·</span>
            <span className="text-white/80">Systems check</span>
          </p>
          <h1 className="ascent-shadow font-display text-[clamp(2.75rem,5vw,4.5rem)] leading-[0.95] tracking-[-0.015em]">
            {failed ? 'Pre-flight halted' : 'Waking up the sky…'}
          </h1>
          <p className="ascent-shadow mt-4 max-w-md text-[15px] leading-relaxed text-white/80">
            {failed
              ? 'One of the systems below could not start. Fix it, then run the check again.'
              : 'Allow camera access, then hand tracking loads (about 13 MB the first time).'}
          </p>

          <ol className="mt-10 space-y-5 font-mono text-[13px] uppercase tracking-[0.1em] sm:text-sm">
            {lines.map((line, index) => (
              <li key={line.key} data-boot-line>
                <div className="flex items-baseline gap-3">
                  <span className="text-white/35">{String(index + 1).padStart(2, '0')}</span>
                  <span className="whitespace-nowrap text-white">
                    <span data-type={line.label} aria-hidden="true" />
                    <span data-caret aria-hidden="true" className="ascent-caret ml-0.5 inline-block text-white/80">
                      ▍
                    </span>
                    <span className="sr-only">{line.label}</span>
                  </span>
                  <span data-after-type aria-hidden="true" className="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-white/25" />
                  <span data-after-type className={`whitespace-nowrap ${TONE_CLASS[line.tone]}`}>
                    <span className="text-white/40">[ </span>
                    <span key={line.status} className={`ascent-blip inline-block ${line.tone === 'active' ? 'ascent-breathe' : ''}`}>
                      {line.status}
                    </span>
                    <span className="text-white/40"> ]</span>
                  </span>
                </div>

                {line.progress !== null && (
                  <div data-after-type className="ml-9 mt-2 h-px bg-white/15" aria-hidden="true">
                    <div
                      className="h-full origin-left bg-[color:var(--ascent-warm)] transition-transform duration-200 ease-out"
                      style={{ transform: `scaleX(${line.progress})` }}
                    />
                  </div>
                )}

                {line.key === errorLineKey && (
                  <div role="alert" className="ml-9 mt-4 border-l-2 border-[color:var(--ascent-fault)] bg-[#ff6b4a]/10 py-3 pl-4 pr-4 normal-case tracking-normal">
                    {errorMessage && <p className="font-sans text-sm leading-relaxed text-white">{errorMessage}</p>}
                    {errorDetail && <p className="mt-1.5 break-words font-mono text-[11px] text-white/55">{errorDetail}</p>}
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-4 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-sans text-sm font-semibold text-[color:var(--ascent-ink)] transition-colors hover:bg-[color:var(--ascent-warm)]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Try Again
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {/* Screen readers get the statuses as one polite summary instead of every typed character. */}
          <p className="sr-only" aria-live="polite">
            {lines.map((line) => `${line.label}: ${line.status}.`).join(' ')}
          </p>

          <div className="mt-12 flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={onBack}
              className="ascent-hud ascent-glass flex items-center gap-1.5 rounded-full px-4 py-2.5 text-white/90 transition-colors hover:bg-white/15"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
            {!failed && (
              <p className="ascent-hud text-[10px] text-white/50">Your camera feed never leaves this page.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
