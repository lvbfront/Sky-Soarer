import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ShieldCheck, Trash2, X } from 'lucide-react';
import { CornerBrackets } from '@/ui/hud';
import { clearStoredData, readStoredData, type StoredDataSnapshot } from '@/game/storedData';

/** The privacy promise, word for word wherever the camera comes up. Keep it true (CLAUDE.md §12). */
export const CAMERA_PRIVACY_NOTE =
  'Your camera never leaves your device. Hand tracking runs entirely in your browser, nothing is recorded or uploaded.';

/**
 * The camera privacy note in the HUD style, with the small "Privacy" link that opens the panel.
 * `camera: false` (keyboard mode) drops the camera sentence and keeps the link.
 */
export function PrivacyNote({
  onOpenPrivacy,
  camera = true,
  className = '',
}: {
  onOpenPrivacy: () => void;
  camera?: boolean;
  className?: string;
}) {
  return (
    <p className={`flex items-start gap-2.5 text-xs leading-relaxed text-white/75 ${className}`}>
      <ShieldCheck className="mt-px h-4 w-4 flex-none text-[color:var(--ascent-cyan)]" aria-hidden="true" />
      <span>
        {camera ? CAMERA_PRIVACY_NOTE : 'No camera is used in keyboard mode. Nothing you do is uploaded.'}{' '}
        <button
          type="button"
          onClick={onOpenPrivacy}
          className="ascent-hud ml-0.5 whitespace-nowrap text-[color:var(--ascent-cyan)] underline decoration-dotted underline-offset-4 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          style={{ fontSize: 10 }}
        >
          Privacy
        </button>
      </span>
    </p>
  );
}

/**
 * The Privacy panel: what the game does with the camera, and exactly what it keeps in this browser
 * (each localStorage key with its raw value), with "Clear my data". Esc or the close button closes
 * it; `onCleared` lets App drop its in-memory copies (saved calibration, best score, …).
 */
export function PrivacyPanel({
  reducedMotion,
  onClose,
  onCleared,
}: {
  reducedMotion: boolean;
  onClose: () => void;
  onCleared: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const [entries, setEntries] = useState<StoredDataSnapshot[]>(() => readStoredData());
  const [cleared, setCleared] = useState<'idle' | 'done' | 'failed'>('idle');
  const storedCount = entries.filter((entry) => entry.value !== null).length;

  useLayoutEffect(() => {
    // Focus moves into the dialog, and back to whatever opened it (the Privacy link) on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const restoreFocus = () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const root = rootRef.current;
    if (!root || reducedMotion) return restoreFocus;
    const ctx = gsap.context(() => {
      gsap
        .timeline()
        .fromTo('[data-privacy-scrim]', { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'none' })
        .fromTo('[data-privacy-panel]', { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' }, 0);
    }, root);
    return () => {
      ctx.revert();
      restoreFocus();
    };
    // A one-shot entrance on mount.
  }, []);

  const handleClear = useCallback(() => {
    const ok = clearStoredData();
    setEntries(readStoredData());
    setCleared(ok ? 'done' : 'failed');
    onCleared();
    // The Clear button disables itself once nothing is stored; keep focus inside the dialog.
    closeRef.current?.focus({ preventScroll: true });
  }, [onCleared]);

  // Esc closes the panel, wherever focus is. Caught on the way down (capture) and stopped there, so
  // App's own window-level Esc handling (guide, pause) never sees it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] overflow-y-auto text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div data-privacy-scrim className="fixed inset-0 bg-[#06101f]/60" onClick={onClose} aria-hidden="true" />
      <div className="ascent-grain pointer-events-none fixed inset-0" />
      <div className="pointer-events-none relative flex min-h-full items-center justify-center px-4 py-10">
        <section
          data-privacy-panel
          className="ascent-glass-strong pointer-events-auto relative w-full max-w-lg rounded-[24px] p-6 shadow-2xl sm:p-7"
        >
          <CornerBrackets size={14} inset={9} className="text-white/35" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="ascent-hud flex items-center gap-2.5 text-[color:var(--ascent-cyan)]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Privacy
              </p>
              <h2 id={titleId} className="mt-2 font-display text-4xl leading-none tracking-[-0.015em] sm:text-5xl">
                Stays on your device
              </h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close privacy panel"
              className="ascent-glass flex h-9 w-9 flex-none items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="mt-5 space-y-2 text-sm leading-relaxed text-white/85">
            <li>{CAMERA_PRIVACY_NOTE}</li>
            <li>
              The camera only starts when you press <span className="text-white">Begin pre-flight</span> or{' '}
              <span className="text-white">Quick start</span> in hand mode, and it is switched off when you stop, go back,
              hit an error or close the tab. Keyboard mode never asks for it.
            </li>
            <li>
              No accounts, cookies, analytics or ads, and no third-party requests: every file, including the hand
              tracking model and the fonts, comes from this site.
            </li>
          </ul>

          <div className="mt-6 flex items-baseline justify-between">
            <p className="ascent-hud text-white/60">Stored in this browser</p>
            <p className="ascent-hud text-white/45" style={{ fontSize: 10 }}>
              localStorage · {storedCount} of {entries.length}
            </p>
          </div>
          <dl className="ascent-glass mt-2 divide-y divide-white/10 rounded-2xl">
            {entries.map((entry) => (
              <div key={entry.key} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm font-medium text-white">{entry.label}</dt>
                  <span
                    className={`ascent-hud flex-none ${entry.value === null ? 'text-white/40' : 'text-[color:var(--ascent-cyan)]'}`}
                    style={{ fontSize: 10 }}
                  >
                    {entry.value === null ? 'Not stored' : 'Stored'}
                  </span>
                </div>
                <dd className="mt-0.5 text-xs leading-relaxed text-white/65">{entry.contents}</dd>
                <dd className="mt-1 break-all font-mono text-[10px] leading-relaxed text-white/45">
                  {entry.key}
                  {entry.value !== null && <span className="text-white/60"> = {entry.value}</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleClear}
              disabled={storedCount === 0}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[color:var(--ascent-ink)] transition-colors hover:bg-[color:var(--ascent-warm)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              <Trash2 className="h-4 w-4" />
              Clear my data
            </button>
            <p className="ascent-hud text-white/60" style={{ fontSize: 10 }} role="status">
              {cleared === 'done'
                ? 'Cleared · nothing is stored now'
                : cleared === 'failed'
                  ? 'Storage is blocked in this browser · nothing to clear'
                  : storedCount === 0
                    ? 'Nothing is stored'
                    : ''}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
