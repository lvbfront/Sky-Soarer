import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Hand, Keyboard, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { BIRD_OPTIONS } from '@/game/bird';
import { MAP_OPTIONS, WEATHER_LOOKS, WEATHER_OPTIONS } from '@/game/presets';
import { WindAudio } from '@/game/audio';
import type { LandingScene, LandingTelemetry } from '@/game/LandingScene';
import type { FlightSettings } from '@/game/settings';
import {
  BIRD_PERSONALITY,
  CHAPTERS,
  CONTROL_MODE_OPTIONS,
  CONTROLS_BRIEFING,
  MAP_DETAILS,
  TAGLINE,
  WEATHER_DETAILS,
  formatAltitude,
  formatCoordinate,
} from './content';

gsap.registerPlugin(ScrollTrigger);

const TITLE = 'SKY SOARER';
// DOM telemetry writes are throttled to this interval; the scene itself renders every frame.
const TELEMETRY_INTERVAL_MS = 60;
const LAST_CHAPTER = CHAPTERS.length - 1;

interface LandingProps {
  /** The persistent WebGL backdrop; null while it's being created or if WebGL is unavailable. */
  scene: LandingScene | null;
  settings: FlightSettings;
  bestScore: number;
  /** Settings the Quick start button will use (the last ones saved in this browser). */
  quickStartSettings: FlightSettings;
  hasSavedSettings: boolean;
  /** A hand calibration is saved: hand-mode pre-flight skips the calibration screen. */
  calibrationSaved: boolean;
  reducedMotion: boolean;
  /** Plays the full intro timeline (first visit of the page load only). */
  playIntro: boolean;
  onChange: (patch: Partial<FlightSettings>) => void;
  onBegin: () => void;
  /** Begin pre-flight, but show the calibration screen even though one is saved. */
  onRecalibrate: () => void;
  onQuickStart: () => void;
  subscribeTelemetry: (listener: ((telemetry: LandingTelemetry) => void) | null) => void;
}

function birdName(id: FlightSettings['bird']) {
  return BIRD_OPTIONS.find((b) => b.id === id)?.name ?? id;
}
function mapName(id: FlightSettings['map']) {
  return MAP_OPTIONS.find((m) => m.id === id)?.name ?? id;
}
function weatherName(id: FlightSettings['weather']) {
  return WEATHER_OPTIONS.find((w) => w.id === id)?.name ?? id;
}

function Eyebrow({ index }: { index: number }) {
  const chapter = CHAPTERS[index];
  return (
    <p data-reveal className="ascent-hud mb-5 flex items-center gap-3 text-[color:var(--ascent-cyan)]">
      <span>{String(index).padStart(2, '0')}</span>
      <span className="h-px w-10 bg-current opacity-60" />
      <span>{formatAltitude(chapter.meters)} m</span>
      <span className="opacity-60">·</span>
      <span className="text-white/80">{chapter.label}</span>
    </p>
  );
}

export function Landing({
  scene,
  settings,
  bestScore,
  quickStartSettings,
  hasSavedSettings,
  calibrationSaved,
  reducedMotion,
  playIntro,
  onChange,
  onBegin,
  onRecalibrate,
  onQuickStart,
  subscribeTelemetry,
}: LandingProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const heroInnerRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const veilRef = useRef<HTMLDivElement | null>(null);
  const dipRef = useRef<HTMLDivElement | null>(null);
  const railMarkerRef = useRef<HTMLDivElement | null>(null);
  const birdNameRef = useRef<HTMLHeadingElement | null>(null);
  const altRef = useRef<HTMLSpanElement | null>(null);
  const spdRef = useRef<HTMLSpanElement | null>(null);
  const hdgRef = useRef<HTMLSpanElement | null>(null);
  const vsRef = useRef<HTMLSpanElement | null>(null);
  const latRef = useRef<HTMLSpanElement | null>(null);
  const lonRef = useRef<HTMLSpanElement | null>(null);
  const sceneRef = useRef<LandingScene | null>(scene);
  const activeChapterRef = useRef(0);
  const windRef = useRef<WindAudio | null>(null);
  const firstBirdRender = useRef(true);

  const [activeChapter, setActiveChapter] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  // Bumped (debounced) on resize so the scroll timeline is rebuilt from fresh section offsets.
  const [layoutKey, setLayoutKey] = useState(0);

  useEffect(() => {
    sceneRef.current = scene;
    // Start from the ground every time the landing mounts (the scene may still be at the
    // pre-flight pose, in which case it glides back down).
    scene?.setProgress(0, reducedMotion);
  }, [scene, reducedMotion]);

  useLayoutEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLayoutKey((k) => k + 1), 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const applyProgress = useCallback((progress: number, instant = false) => {
    sceneRef.current?.setProgress(progress, instant);
    if (railMarkerRef.current) railMarkerRef.current.style.top = `${(1 - progress) * 100}%`;
    const chapter = Math.round(progress * LAST_CHAPTER);
    if (chapter !== activeChapterRef.current) {
      activeChapterRef.current = chapter;
      setActiveChapter(chapter);
    }
  }, []);

  // --- Scroll choreography -----------------------------------------------------------------
  useLayoutEffect(() => {
    const root = rootRef.current;
    const main = mainRef.current;
    if (!root || !main) return;

    const ctx = gsap.context(() => {
      const sections = gsap.utils.toArray<HTMLElement>('[data-chapter]', main);
      const tops = sections.map((s) => s.offsetTop);

      if (reducedMotion) {
        // No scrub and no snapping: each chapter simply becomes active once it's centered, and
        // the backdrop cuts to its shot behind a quick fade.
        sections.forEach((section, index) => {
          ScrollTrigger.create({
            trigger: section,
            start: 'top center',
            end: 'bottom center',
            onToggle: (self) => {
              if (!self.isActive || activeChapterRef.current === index) return;
              applyProgress(index / LAST_CHAPTER, true);
              if (dipRef.current) gsap.fromTo(dipRef.current, { opacity: 0.7 }, { opacity: 0, duration: 0.6, ease: 'none' });
            },
          });
          const reveals = section.querySelectorAll('[data-reveal]');
          if (index > 0 && reveals.length) {
            gsap.fromTo(
              reveals,
              { opacity: 0 },
              {
                opacity: 1,
                duration: 0.4,
                ease: 'none',
                scrollTrigger: { trigger: section, start: 'top 70%', toggleActions: 'play none none reverse' },
              },
            );
          }
        });
        return;
      }

      // One scrubbed timeline across the whole page. Segment k spans the scroll distance from
      // section k's top to section k+1's, and moves chapter-space progress from k/N to (k+1)/N,
      // so chapter stops line up with section tops even if a section had to grow taller than
      // the viewport. Snap points are those same tops.
      const scrollRange = Math.max(1, main.offsetHeight - window.innerHeight);
      const proxy = { p: 0 };
      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        onUpdate: () => applyProgress(proxy.p),
      });
      const snapPoints: number[] = [0];
      let covered = 0;
      for (let k = 0; k < sections.length - 1; k += 1) {
        const length = Math.max(1, Math.min(tops[k + 1], scrollRange) - tops[k]);
        timeline.to(proxy, { p: (k + 1) / LAST_CHAPTER, duration: length });
        covered += length;
        snapPoints.push(Math.min(1, covered / scrollRange));
      }
      if (covered < scrollRange) timeline.to({}, { duration: scrollRange - covered });

      ScrollTrigger.create({
        trigger: main,
        start: 'top top',
        end: 'bottom bottom',
        animation: timeline,
        scrub: 0.8,
        // Array snap points are directional (a small scroll moves on to the next chapter);
        // inertia is off so a fast fling can't carry past several chapters at once.
        snap: {
          snapTo: snapPoints,
          inertia: false,
          duration: { min: 0.35, max: 1.1 },
          delay: 0.08,
          ease: 'power2.inOut',
        },
      });

      // Hero drifts up and fades as the climb starts.
      if (heroInnerRef.current) {
        gsap.to(heroInnerRef.current, {
          yPercent: -18,
          opacity: 0,
          ease: 'none',
          scrollTrigger: { trigger: sections[0], start: 'top top', end: 'bottom 35%', scrub: true },
        });
      }

      // Chapter content rises in on arrival and falls away on departure, both directions.
      sections.slice(1).forEach((section) => {
        const reveals = section.querySelectorAll('[data-reveal]');
        if (!reveals.length) return;
        gsap.fromTo(
          reveals,
          { y: 46, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.9,
            stagger: 0.06,
            ease: 'power3.out',
            scrollTrigger: { trigger: section, start: 'top 62%', end: 'bottom 38%', toggleActions: 'play reverse play reverse' },
          },
        );
      });
    }, root);

    return () => ctx.revert();
  }, [reducedMotion, layoutKey, applyProgress]);

  // --- Intro timeline ----------------------------------------------------------------------
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const veil = veilRef.current;
      if (!playIntro || reducedMotion) {
        if (veil) gsap.fromTo(veil, { opacity: playIntro ? 1 : 0.6 }, { opacity: 0, duration: 0.5, ease: 'none' });
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
      if (veil) tl.fromTo(veil, { opacity: 1 }, { opacity: 0, duration: 1.8, ease: 'power2.inOut' }, 0);
      tl.from('[data-intro-char]', { yPercent: 45, opacity: 0, rotate: 3, duration: 1.6, stagger: 0.05 }, 0.35)
        .from('[data-intro="fade"]', { opacity: 0, y: 18, duration: 1.2, stagger: 0.12 }, 0.9)
        .from('[data-hud]', { opacity: 0, duration: 1.2, stagger: 0.08, ease: 'power1.out' }, 1.2);
    }, root);
    return () => ctx.revert();
    // Intro is a one-shot on mount; later prop changes must not replay it.
  }, []);

  // The 3D half of the intro (camera dolly-in). On a cold start the scene is created after
  // this component mounts, so this waits for it rather than running inside the effect above.
  const introPlayedRef = useRef(false);
  useEffect(() => {
    if (!scene || introPlayedRef.current || !playIntro || reducedMotion) return;
    introPlayedRef.current = true;
    scene.playIntro();
  }, [scene, playIntro, reducedMotion]);

  // --- Pointer parallax --------------------------------------------------------------------
  useEffect(() => {
    if (reducedMotion) return;
    const title = titleRef.current;
    const moveX = title ? gsap.quickTo(title, 'x', { duration: 1.2, ease: 'power3.out' }) : null;
    const moveY = title ? gsap.quickTo(title, 'y', { duration: 1.2, ease: 'power3.out' }) : null;
    const onMove = (event: PointerEvent) => {
      const nx = (event.clientX / window.innerWidth) * 2 - 1;
      const ny = -((event.clientY / window.innerHeight) * 2 - 1);
      sceneRef.current?.setPointer(nx, ny);
      moveX?.(-nx * 14);
      moveY?.(ny * 8);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reducedMotion]);

  // --- Telemetry HUD (direct DOM writes, never React state) ---------------------------------
  useEffect(() => {
    let last = 0;
    subscribeTelemetry((t) => {
      windRef.current?.setIntensity(0.22 + Math.min(Math.abs(t.verticalSpeed) / 700, 1.1));
      const now = performance.now();
      if (now - last < TELEMETRY_INTERVAL_MS) return;
      last = now;
      if (altRef.current) altRef.current.textContent = formatAltitude(t.altitude);
      if (spdRef.current) spdRef.current.textContent = `${Math.round(t.speedKnots).toString().padStart(3, '0')} kt`;
      if (hdgRef.current) hdgRef.current.textContent = `${Math.round(t.headingDeg).toString().padStart(3, '0')}°`;
      if (vsRef.current) {
        const vs = Math.round(t.verticalSpeed);
        vsRef.current.textContent = `${vs >= 0 ? '+' : '−'}${Math.abs(vs).toString().padStart(4, '0')} m/s`;
      }
      if (latRef.current) latRef.current.textContent = formatCoordinate(t.lat, 'N', 'S');
      if (lonRef.current) lonRef.current.textContent = formatCoordinate(t.lon, 'E', 'W');
    });
    return () => subscribeTelemetry(null);
  }, [subscribeTelemetry]);

  // --- Sound (off by default; started from the toggle click, which satisfies autoplay rules) --
  const toggleSound = useCallback(async () => {
    if (windRef.current) {
      windRef.current.stop();
      windRef.current = null;
      setSoundOn(false);
      return;
    }
    const wind = new WindAudio();
    windRef.current = wind;
    setSoundOn(true);
    wind.setIntensity(0.25);
    try {
      await wind.start();
    } catch (error) {
      console.warn('Ambient wind could not start', error);
      if (windRef.current === wind) windRef.current = null;
      setSoundOn(false);
    }
  }, []);
  useEffect(
    () => () => {
      windRef.current?.stop();
      windRef.current = null;
    },
    [],
  );

  // --- Bird selection ----------------------------------------------------------------------
  const birdIndex = Math.max(
    0,
    BIRD_OPTIONS.findIndex((b) => b.id === settings.bird),
  );
  const stepBird = useCallback(
    (direction: 1 | -1) => {
      const next = BIRD_OPTIONS[(birdIndex + direction + BIRD_OPTIONS.length) % BIRD_OPTIONS.length];
      onChange({ bird: next.id });
    },
    [birdIndex, onChange],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (activeChapterRef.current !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepBird(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepBird(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepBird]);

  useLayoutEffect(() => {
    if (firstBirdRender.current) {
      firstBirdRender.current = false;
      return;
    }
    const el = birdNameRef.current;
    if (!el) return;
    const tween = reducedMotion
      ? gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3 })
      : gsap.fromTo(el, { yPercent: 35, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out' });
    return () => {
      tween.kill();
    };
  }, [settings.bird, reducedMotion]);

  const scrollToChapter = useCallback(
    (index: number) => {
      const section = mainRef.current?.querySelectorAll<HTMLElement>('[data-chapter]')[index];
      if (!section) return;
      window.scrollTo({ top: section.offsetTop, behavior: reducedMotion ? 'auto' : 'smooth' });
    },
    [reducedMotion],
  );

  const quickStartSummary = [
    birdName(quickStartSettings.bird).split(' /')[0],
    quickStartSettings.map === 'ocean' ? 'Ocean' : 'Mountains',
    weatherName(quickStartSettings.weather),
    CONTROL_MODE_OPTIONS.find((option) => option.id === quickStartSettings.controls)?.short,
  ].join(' · ');
  const keyboardMode = settings.controls === 'keyboard';

  const optionBase =
    'group relative w-full rounded-2xl px-5 py-4 text-left transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
  const optionState = (selected: boolean) =>
    selected ? 'ascent-glass-strong ring-1 ring-white/70' : 'ascent-glass hover:bg-white/10';

  return (
    <div ref={rootRef} className="relative text-white">
      {/* Readability scrims over the WebGL sky: top bar, and a left-side wash once chapters start. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[1] h-40 bg-gradient-to-b from-[#06101f]/25 to-transparent" />
      <div
        className="pointer-events-none fixed inset-0 z-[1] transition-opacity duration-700"
        style={{
          opacity: activeChapter === 0 ? 0 : 1,
          background: 'linear-gradient(90deg, rgba(6,16,31,0.42) 0%, rgba(6,16,31,0.18) 38%, rgba(6,16,31,0) 60%)',
        }}
      />
      <div
        className="pointer-events-none fixed bottom-0 right-0 z-[1] h-80 w-[34rem] max-w-full"
        style={{ background: 'radial-gradient(ellipse at 100% 100%, rgba(6,16,31,0.42), rgba(6,16,31,0) 68%)' }}
      />
      <div className="ascent-grain pointer-events-none fixed inset-0 z-[2]" />
      <div ref={dipRef} className="pointer-events-none fixed inset-0 z-[3] bg-[#f4f7fb] opacity-0" />

      {/* ---- Fixed instrument chrome ---- */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 sm:px-8">
        <div data-hud className="ascent-hud flex items-center gap-3 text-white/90">
          <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
            <path d="M3 19 L16 11 L29 19 L16 15 Z" fill="currentColor" />
            <path d="M16 15 L16 24" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="font-medium text-white">Sky Soarer</span>
          <span className="hidden text-white/50 sm:inline">/ Bird Flight</span>
        </div>
        <div className="flex items-center gap-5">
          <p data-hud className="ascent-hud hidden text-white/80 md:block" aria-live="polite">
            CH {String(activeChapter).padStart(2, '0')} / {String(LAST_CHAPTER).padStart(2, '0')}
            <span className="mx-2 text-white/40">—</span>
            {CHAPTERS[activeChapter].label}
          </p>
          <button
            data-hud
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            className="ascent-hud ascent-glass pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-white/90 transition-colors hover:bg-white/15"
          >
            {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            Sound {soundOn ? 'on' : 'off'}
          </button>
        </div>
      </header>

      {/* Altimeter rail: one tick per chapter, clickable. */}
      <nav
        data-hud
        aria-label="Chapters"
        className="pointer-events-none fixed left-6 top-1/2 z-20 hidden h-[52vh] -translate-y-1/2 sm:left-8 md:block"
      >
        <div className="relative h-full w-px bg-white/30">
          {Array.from({ length: 21 }, (_, i) => (
            <span
              key={i}
              className="absolute left-0 h-px bg-white/35"
              style={{ top: `${(i / 20) * 100}%`, width: i % 5 === 0 ? 0 : 5 }}
            />
          ))}
          {CHAPTERS.map((chapter, index) => {
            const top = `${(1 - index / LAST_CHAPTER) * 100}%`;
            const active = index === activeChapter;
            return (
              <button
                key={chapter.id}
                type="button"
                onClick={() => scrollToChapter(index)}
                aria-label={`${chapter.label}, ${chapter.meters} meters`}
                aria-current={active ? 'step' : undefined}
                className="ascent-hud group pointer-events-auto absolute left-0 flex -translate-y-1/2 items-center gap-2.5 py-1.5 pr-2"
                style={{ top }}
              >
                <span className={`h-px transition-all duration-500 ${active ? 'w-5 bg-white' : 'w-3 bg-white/60 group-hover:w-4'}`} />
                <span className={`transition-colors ${active ? 'text-white' : 'text-white/55 group-hover:text-white/85'}`}>
                  {chapter.meters.toLocaleString('en-US')}
                </span>
              </button>
            );
          })}
          <div
            ref={railMarkerRef}
            className="absolute h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent border-l-[color:var(--ascent-warm)]"
            style={{ top: '100%', left: -9 }}
          />
        </div>
      </nav>

      {/* Telemetry + altitude counter. */}
      <div data-hud className="ascent-shadow pointer-events-none fixed bottom-6 right-6 z-20 text-right sm:bottom-8 sm:right-8" aria-hidden="true">
        <dl className="ascent-hud mb-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-1 text-white/85">
          <dt className="text-white/70">Spd</dt>
          <dd ref={spdRef}>034 kt</dd>
          <dt className="text-white/70">Hdg</dt>
          <dd ref={hdgRef}>000°</dd>
          <dt className="text-white/70">V/S</dt>
          <dd ref={vsRef}>+0000 m/s</dd>
          <dt className="text-white/70">Lat</dt>
          <dd ref={latRef}>—</dd>
          <dt className="text-white/70">Lon</dt>
          <dd ref={lonRef}>—</dd>
        </dl>
        <div className="flex items-baseline justify-end gap-2">
          <span className="ascent-hud text-[color:var(--ascent-cyan)]">Alt</span>
          <span ref={altRef} className="ascent-shadow font-mono text-4xl font-medium tabular-nums tracking-tight text-white lg:text-5xl">
            00 000
          </span>
          <span className="ascent-hud text-white/70">m</span>
        </div>
      </div>

      {/* ---- Chapters ---- */}
      <main ref={mainRef} className="relative z-10">
        {/* 0 · Hero */}
        <section data-chapter="hero" className="relative flex min-h-svh flex-col items-center px-6">
          <div ref={heroInnerRef} className="flex flex-1 flex-col items-center pt-[max(6.5rem,15vh)] text-center">
            <p data-intro="fade" className="ascent-hud mb-6 text-white/85">
              Bird Flight <span className="mx-2 text-white/40">·</span> a hand-tracked glide
            </p>
            <h1
              ref={titleRef}
              aria-label={TITLE}
              className="ascent-shadow font-display text-[clamp(4.5rem,12.5vw,14rem)] font-normal leading-[0.8] tracking-[-0.02em] will-change-transform"
            >
              {TITLE.split(' ').map((word, w) => (
                <span key={word} className="inline-block align-top" aria-hidden="true">
                  {word.split('').map((char, c) => (
                    <span key={c} data-intro-char className="inline-block">
                      {char}
                    </span>
                  ))}
                  {w === 0 && <span className="inline-block w-[0.22em]" />}
                </span>
              ))}
            </h1>
            <p data-intro="fade" className="ascent-shadow mt-6 max-w-xl text-lg font-medium text-white/95 sm:text-xl">
              {TAGLINE}
            </p>
            <div data-intro="fade" className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onQuickStart}
                className="ascent-glass group pointer-events-auto flex items-center gap-3 rounded-full py-2.5 pl-5 pr-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Quick start
                <span className="ascent-hud hidden text-[10px] text-white/70 sm:inline">
                  {hasSavedSettings ? quickStartSummary : 'Default setup'}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[color:var(--ascent-ink)] transition group-hover:translate-x-0.5">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          </div>
          <button
            data-intro="fade"
            type="button"
            onClick={() => scrollToChapter(1)}
            className="ascent-hud mb-8 flex flex-col items-center gap-3 text-white/85 transition-colors hover:text-white"
          >
            Scroll to ascend
            <span className="relative block h-12 w-px overflow-hidden bg-white/25">
              <span className="ascent-hint-line absolute inset-0 bg-white" />
            </span>
          </button>
        </section>

        {/* 1 · Bird */}
        <section data-chapter="bird" className="relative flex min-h-svh items-center py-24 pl-[clamp(1.5rem,9vw,9.5rem)] pr-6">
          <div className="max-w-[34rem]">
            <Eyebrow index={1} />
            <div data-reveal>
              <h2
                ref={birdNameRef}
                className="ascent-shadow font-display text-[clamp(3.5rem,7vw,7rem)] leading-[0.9] tracking-[-0.015em]"
              >
                {birdName(settings.bird)}
              </h2>
            </div>
            <p data-reveal className="ascent-shadow mt-4 max-w-md text-lg leading-relaxed text-white/90">
              {BIRD_PERSONALITY[settings.bird]}
            </p>

            <div data-reveal className="mt-8 flex items-center gap-4">
              <button
                type="button"
                onClick={() => stepBird(-1)}
                aria-label="Previous bird"
                className="ascent-glass flex h-12 w-12 items-center justify-center rounded-full transition hover:bg-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="ascent-hud w-16 text-center text-white/85">
                {String(birdIndex + 1).padStart(2, '0')} / {String(BIRD_OPTIONS.length).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={() => stepBird(1)}
                aria-label="Next bird"
                className="ascent-glass flex h-12 w-12 items-center justify-center rounded-full transition hover:bg-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <span className="ascent-hud ml-2 hidden text-white/55 lg:inline">or ← → keys</span>
            </div>

            <div data-reveal role="radiogroup" aria-label="Bird" className="mt-8 flex flex-wrap gap-2">
              {BIRD_OPTIONS.map((bird) => {
                const selected = bird.id === settings.bird;
                return (
                  <button
                    key={bird.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ bird: bird.id })}
                    className={`ascent-hud rounded-full px-3.5 py-2 transition ${
                      selected ? 'bg-white text-[color:var(--ascent-ink)]' : 'ascent-glass text-white/85 hover:bg-white/15'
                    }`}
                  >
                    {bird.name.split(' /')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 2 · World */}
        <section data-chapter="world" className="relative flex min-h-svh items-center py-24 pl-[clamp(1.5rem,9vw,9.5rem)] pr-6">
          <div className="w-full max-w-[36rem]">
            <Eyebrow index={2} />
            <h2 data-reveal className="ascent-shadow font-display text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.015em]">
              Choose your world
            </h2>
            <div data-reveal role="radiogroup" aria-label="World" className="mt-8 grid gap-3 sm:grid-cols-2">
              {MAP_OPTIONS.map((map, i) => {
                const selected = map.id === settings.map;
                return (
                  <button
                    key={map.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ map: map.id })}
                    className={`${optionBase} ${optionState(selected)}`}
                  >
                    <span className="ascent-hud flex items-center justify-between text-white/60">
                      <span>{String.fromCharCode(65 + i)}</span>
                      {selected && <Check className="h-4 w-4 text-white" />}
                    </span>
                    <span className="mt-3 block font-display text-3xl leading-tight">{map.name}</span>
                    <span className="mt-2 block text-sm leading-snug text-white/80">{MAP_DETAILS[map.id].blurb}</span>
                    <span className="ascent-hud mt-4 block space-y-0.5 text-[10px] text-white/55">
                      {MAP_DETAILS[map.id].meta.map((line) => (
                        <span key={line} className="block">
                          {line}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3 · Sky */}
        <section data-chapter="sky" className="relative flex min-h-svh items-center py-24 pl-[clamp(1.5rem,9vw,9.5rem)] pr-6">
          <div className="w-full max-w-[32rem]">
            <Eyebrow index={3} />
            <h2 data-reveal className="ascent-shadow font-display text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.015em]">
              Choose the sky
            </h2>
            <div data-reveal role="radiogroup" aria-label="Sky" className="mt-8 flex flex-col gap-3">
              {WEATHER_OPTIONS.map((weather) => {
                const selected = weather.id === settings.weather;
                const look = WEATHER_LOOKS[weather.id];
                return (
                  <button
                    key={weather.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ weather: weather.id })}
                    className={`${optionBase} ${optionState(selected)} flex items-center gap-4`}
                  >
                    <span
                      className="h-11 w-11 flex-none rounded-full ring-1 ring-white/40"
                      style={{ background: `linear-gradient(${look.skyTop}, ${look.skyBottom})` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-display text-2xl leading-tight">{weather.name}</span>
                        <span className="ascent-hud text-white/60">{WEATHER_DETAILS[weather.id].time}</span>
                      </span>
                      <span className="mt-0.5 block text-sm text-white/80">{WEATHER_DETAILS[weather.id].blurb}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 flex-none" />}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 4 · Takeoff */}
        <section data-chapter="takeoff" className="relative flex min-h-svh items-center py-20 pl-[clamp(1.5rem,9vw,9.5rem)] pr-6">
          <div className="w-full max-w-[34rem]">
            <Eyebrow index={4} />
            <h2 data-reveal className="ascent-shadow font-display text-[clamp(2.75rem,5vw,4.75rem)] leading-[0.95] tracking-[-0.015em]">
              Ready when you are.
            </h2>

            <div data-reveal className="ascent-glass mt-6 rounded-2xl p-2">
              <dl className="divide-y divide-white/10">
                {[
                  { label: 'Bird', value: birdName(settings.bird), chapter: 1 },
                  { label: 'World', value: mapName(settings.map), chapter: 2 },
                  { label: 'Sky', value: weatherName(settings.weather), chapter: 3 },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-4 px-3 py-2.5">
                    <dt className="ascent-hud w-14 text-white/55">{row.label}</dt>
                    <dd className="flex-1 truncate text-[15px] font-medium">{row.value}</dd>
                    <button
                      type="button"
                      onClick={() => scrollToChapter(row.chapter)}
                      className="ascent-hud rounded-full px-2.5 py-1 text-[10px] text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      Change
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-4 px-3 py-2.5">
                  <dt className="ascent-hud w-14 text-white/55">Input</dt>
                  <dd className="flex-1">
                    <div role="radiogroup" aria-label="Controls" className="grid grid-cols-2 gap-1 rounded-full bg-white/10 p-1">
                      {CONTROL_MODE_OPTIONS.map((option) => {
                        const selected = option.id === settings.controls;
                        const Icon = option.id === 'hand' ? Hand : Keyboard;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => onChange({ controls: option.id })}
                            className={`flex items-center justify-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                              selected ? 'bg-white text-[color:var(--ascent-ink)]' : 'text-white/80 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {option.name}
                          </button>
                        );
                      })}
                    </div>
                  </dd>
                </div>
                <div className="flex items-center gap-4 px-3 py-2.5">
                  <dt className="ascent-hud w-14 text-white/55">Rings</dt>
                  <dd className="flex-1">
                    <span className="block text-[15px] font-medium">Ring Challenge</span>
                    <span className="block text-xs text-white/70">
                      Fly through glowing rings to score.
                      {bestScore > 0 && <span className="ml-1 font-semibold text-white">Best: {bestScore}</span>}
                    </span>
                  </dd>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.ringChallenge}
                    aria-label="Ring Challenge"
                    onClick={() => onChange({ ringChallenge: !settings.ringChallenge })}
                    className={`relative h-7 w-12 flex-none rounded-full transition-colors ${
                      settings.ringChallenge ? 'bg-[color:var(--ascent-warm)]' : 'bg-white/25'
                    }`}
                  >
                    <span
                      className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        settings.ringChallenge ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              </dl>
            </div>

            <ul data-reveal className="mt-4 grid grid-cols-3 gap-2" aria-label="Controls">
              {CONTROLS_BRIEFING[settings.controls].map((item) => (
                <li key={item.key} className="rounded-xl border border-white/15 px-3 py-2.5" title={item.detail}>
                  <span className="ascent-hud block text-[10px] text-[color:var(--ascent-cyan)]">{item.key}</span>
                  <span className="mt-0.5 block text-sm font-medium">{item.action}</span>
                </li>
              ))}
            </ul>

            <div data-reveal className="mt-6">
              <button
                type="button"
                onClick={onBegin}
                className="group flex w-full items-center justify-between rounded-full bg-white py-2.5 pl-7 pr-2.5 text-left text-[color:var(--ascent-ink)] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] transition hover:bg-[color:var(--ascent-warm)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                <span>
                  <span className="block text-lg font-semibold">Begin pre-flight</span>
                  <span className="ascent-hud block text-[10px] opacity-60">
                    {keyboardMode
                      ? 'Keyboard · no camera needed'
                      : calibrationSaved
                        ? 'Camera · saved calibration'
                        : 'Camera + hand calibration'}
                  </span>
                </span>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--ascent-ink)] text-white transition group-hover:translate-x-1">
                  <ArrowRight className="h-5 w-5" />
                </span>
              </button>
              <p className="mt-3 text-xs text-white/70">
                {keyboardMode
                  ? 'No camera or download needed. Esc pauses the flight at any time.'
                  : 'Your camera feed stays on this page and is only used to read your hand position.'}
              </p>
              {!keyboardMode && calibrationSaved && (
                <button
                  type="button"
                  onClick={onRecalibrate}
                  className="ascent-hud mt-3 flex items-center gap-1.5 text-white/75 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Recalibrate hand controls
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Intro veil: the page fades in from a pale sky. */}
      <div
        ref={veilRef}
        className="pointer-events-none fixed inset-0 z-50 bg-gradient-to-b from-[#dff0f6] to-[#fdf3e0]"
        style={{ opacity: playIntro ? 1 : 0 }}
      />
    </div>
  );
}
