import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { gsap } from 'gsap';
import type { NormalizedLandmark } from '@mediapipe/hands';
import type { GameEngine } from '@/game/GameEngine';
import { BIRD_OPTIONS } from '@/game/bird';
import { LandingScene, type LandingTelemetry } from '@/game/LandingScene';
import { MAP_OPTIONS, WEATHER_OPTIONS } from '@/game/presets';
import { TrackingStartError } from '@/game/trackingShared';
import type { HandTracker, HandControlState, CalibrationPoint, CalibrationCorner } from '@/game/handControls';
import { getBestScore, saveBestScoreIfHigher } from '@/game/highscore';
import { hasSavedSettings, loadSettings, saveSettings, type FlightSettings } from '@/game/settings';
import { Landing } from '@/landing/Landing';
import { BootSequence, type BootLine } from '@/preflight/BootSequence';
import { CalibrationPanel } from '@/preflight/CalibrationPanel';
import {
  CALIBRATION_STEPS,
  EMPTY_CALIBRATION,
  drawHandPreview,
  type CalibrationPointsMap,
} from '@/preflight/handPreview';
import { FlightHud } from '@/flight/FlightHud';

// Hand tracking (handControls + the @mediapipe/hands runtime) and the full game engine are split
// out of the first-load bundle: the landing page only needs the bird/terrain/ocean/sky modules.
// Tracking is imported when the player clicks "Begin pre-flight" (or Quick start), and the engine
// chunk is prefetched at the same moment so it's ready by "Start Flying". A failed import clears
// its cache so "Try Again" retries it.
let handTrackingModule: Promise<typeof import('@/game/handControls')> | null = null;
let handConnections: readonly (readonly [number, number])[] = [];
function loadHandTracking() {
  handTrackingModule ??= import('@/game/handControls').then(
    (module) => {
      handConnections = module.HAND_CONNECTIONS;
      return module;
    },
    (error: unknown) => {
      handTrackingModule = null;
      throw new TrackingStartError('load-failed', error);
    },
  );
  return handTrackingModule;
}

let gameEngineModule: Promise<typeof import('@/game/GameEngine')> | null = null;
function loadGameEngine() {
  gameEngineModule ??= import('@/game/GameEngine').catch((error: unknown) => {
    gameEngineModule = null;
    throw error;
  });
  return gameEngineModule;
}

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

type FlightState = 'landing' | 'requesting' | 'calibrating' | 'flying' | 'error';

type StartupErrorKind =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'tracking-load-failed'
  | 'tracking-timeout'
  | 'engine-load-failed'
  | 'unknown';

/** The startup step a failure happened in; the boot HUD reports the error under that step's line. */
type BootPhase = 'camera' | 'model' | 'engine';

interface StartupError {
  kind: StartupErrorKind;
  /** Raw error text, shown small under the friendly message to help with debugging. */
  detail?: string;
  phase: BootPhase;
}

const STARTUP_ERROR_MESSAGES: Record<StartupErrorKind, string> = {
  'insecure-context':
    'Camera access needs a secure connection. Open the game over https:// (or on localhost) and try again.',
  unsupported: 'This browser does not support webcam access, so hand tracking cannot run here.',
  'permission-denied':
    'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.',
  'no-camera': 'No camera was found. Connect a webcam and try again.',
  'camera-in-use':
    'Your camera is busy or could not be started. Close other apps or tabs that are using it, then try again.',
  'tracking-load-failed':
    'Hand tracking failed to load. Check your internet connection and try again.',
  'tracking-timeout':
    'Hand tracking took too long to load. Check your internet connection and try again.',
  'engine-load-failed': 'The flight engine failed to load. Check your internet connection and try again.',
  unknown: 'Something went wrong while starting the camera. Please try again.',
};

/** Maps a getUserMedia / video.play() / HandTracker failure onto a specific, user-facing error. */
function classifyStartupError(error: unknown): Omit<StartupError, 'phase'> {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof TrackingStartError) {
    const cause = error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : undefined;
    return { kind: error.kind === 'timeout' ? 'tracking-timeout' : 'tracking-load-failed', detail: cause ?? detail };
  }
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { kind: 'permission-denied', detail };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { kind: 'no-camera', detail };
    case 'NotSupportedError':
    case 'TypeError':
      return { kind: 'unsupported', detail };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'camera-in-use', detail };
    default:
      return { kind: 'unknown', detail };
  }
}

// The small in-flight HUD preview stays compact; the calibration sensor feed is drawn at the
// camera's requested 480×360 so its reticles stay crisp at the larger display size.
const HUD_PREVIEW_WIDTH = 176;
const HUD_PREVIEW_HEIGHT = 132;
const CALIBRATION_PREVIEW_WIDTH = 480;
const CALIBRATION_PREVIEW_HEIGHT = 360;

// The boot HUD's lines finish typing about a second in. A load faster than that waits for them,
// and READY is always held briefly so it registers before calibration opens. Together these add
// at most ~1.1 s to a real load (and never the two added together).
const BOOT_MIN_DURATION_MS = 1100;
const BOOT_READY_HOLD_MS = 550;

interface BootStatus {
  camera: 'requesting' | 'online';
  /** The camera's actual resolution once it's online, e.g. "480×360". */
  cameraResolution: string | null;
  model: 'standby' | 'loading' | 'warming' | 'ready';
  /** Real download percentage of the MediaPipe files while the model loads. */
  modelPercent: number;
  calibration: 'pending' | 'done';
  /** `performance.now()` when this boot attempt began. */
  startedAt: number;
}

function freshBootStatus(): BootStatus {
  return {
    camera: 'requesting',
    cameraResolution: null,
    model: 'standby',
    modelPercent: 0,
    calibration: 'pending',
    startedAt: performance.now(),
  };
}

// The bracketed readout a failed line shows, per error kind.
const FAILURE_CODES: Record<StartupErrorKind, string> = {
  'insecure-context': 'Insecure',
  unsupported: 'Unsupported',
  'permission-denied': 'Denied',
  'no-camera': 'Not found',
  'camera-in-use': 'Busy',
  'tracking-load-failed': 'Failed',
  'tracking-timeout': 'Timeout',
  'engine-load-failed': 'Failed',
  unknown: 'Fault',
};

/** Turns the boot status (and any error) into the boot HUD's lines. */
function buildBootLines(boot: BootStatus, error: StartupError | null): BootLine[] {
  const failedAt = error?.phase ?? null;
  const failCode = error ? FAILURE_CODES[error.kind] : '';

  const camera: BootLine =
    failedAt === 'camera'
      ? { key: 'camera', label: 'Camera', status: failCode, tone: 'fail', progress: null }
      : boot.camera === 'online'
        ? {
            key: 'camera',
            label: 'Camera',
            status: boot.cameraResolution ? `Online · ${boot.cameraResolution}` : 'Online',
            tone: 'ok',
            progress: null,
          }
        : { key: 'camera', label: 'Camera', status: 'Requesting', tone: 'active', progress: null };

  const modelProgress = boot.modelPercent / 100;
  let model: BootLine;
  if (failedAt === 'model') {
    model = { key: 'model', label: 'Hand tracking model', status: failCode, tone: 'fail', progress: modelProgress };
  } else if (boot.model === 'ready') {
    model = { key: 'model', label: 'Hand tracking model', status: 'Ready', tone: 'ok', progress: 1 };
  } else if (boot.model === 'warming') {
    model = { key: 'model', label: 'Hand tracking model', status: 'Warming up', tone: 'active', progress: 1 };
  } else if (boot.model === 'loading' && !failedAt) {
    model = {
      key: 'model',
      label: 'Hand tracking model',
      status: `Loading ${String(boot.modelPercent).padStart(2, '0')}%`,
      tone: 'active',
      progress: modelProgress,
    };
  } else {
    model = { key: 'model', label: 'Hand tracking model', status: 'Standby', tone: 'idle', progress: null };
  }

  const calibration: BootLine =
    boot.calibration === 'done'
      ? { key: 'calibration', label: 'Calibration', status: 'Complete', tone: 'ok', progress: null }
      : { key: 'calibration', label: 'Calibration', status: 'Pending', tone: 'idle', progress: null };

  const lines = [camera, model, calibration];
  if (failedAt === 'engine') {
    lines.push({ key: 'engine', label: 'Flight engine', status: failCode, tone: 'fail', progress: null });
  }
  return lines;
}

function optionName(options: { id: string; name: string }[], id: string) {
  return options.find((option) => option.id === id)?.name.split(' /')[0] ?? id;
}

/** Small deadzone-aware label describing the current hand pose, shown under the in-flight sensor feed. */
function describeStatus(state: {
  handDetected: boolean;
  roll: number;
  pitch: number;
  boost: boolean;
  barrelRolling: boolean;
  backflipping: boolean;
}) {
  if (!state.handDetected) return 'No Hand Detected';
  if (state.boost) return 'Fist (Boost) Active';
  if (state.barrelRolling) return 'Barrel Roll Detected';
  if (state.backflipping) return 'Backflip!';
  if (state.roll > 0) return 'Steering Right';
  if (state.roll < 0) return 'Steering Left';
  if (state.pitch > 0) return 'Pitching Up';
  if (state.pitch < 0) return 'Pitching Down';
  return 'Flying Straight';
}

function App() {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const landingContainerRef = useRef<HTMLDivElement | null>(null);
  const landingSceneRef = useRef<LandingScene | null>(null);
  const telemetryListenerRef = useRef<((telemetry: LandingTelemetry) => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hudPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const calibrationPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const calibrationPointsRef = useRef<CalibrationPointsMap>({ ...EMPTY_CALIBRATION });
  const draggingCornerRef = useRef<CalibrationCorner | null>(null);
  const barrelRollingRef = useRef(false);
  const backflippingRef = useRef(false);
  // Incremented by every start attempt and by every teardown. An async startup step that
  // finishes after its session was superseded (e.g. the player pressed Back while the camera
  // permission prompt was still open) sees a stale id and cleans up after itself.
  const sessionIdRef = useRef(0);
  // True while "Start Flying" is building the engine, so a double click can't build two.
  const startingFlightRef = useRef(false);
  // The takeoff transition: a veil that covers calibration while the engine is built, then lifts
  // off the first flight frame. The veil stays mounted (hidden) so its ref is always set.
  const takeoffVeilRef = useRef<HTMLDivElement | null>(null);
  const takeoffTimelineRef = useRef<gsap.core.Timeline | null>(null);
  // Resolves the pending launch animation's promise; called on completion and on reset, so an
  // interrupted launch (Back, a load failure) never leaves handleStartFlying awaiting forever.
  const takeoffResolveRef = useRef<(() => void) | null>(null);

  const [flightState, setFlightState] = useState<FlightState>('landing');
  const [handDetected, setHandDetected] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [barrelRolling, setBarrelRolling] = useState(false);
  const [backflipping, setBackflipping] = useState(false);
  const [underwater, setUnderwater] = useState(false);
  const [surfaceSplash, setSurfaceSplash] = useState(false);
  const [statusText, setStatusText] = useState('No Hand Detected');
  const [startupError, setStartupError] = useState<StartupError | null>(null);
  const [boot, setBoot] = useState<BootStatus>(freshBootStatus);
  // True from the Start Flying click until the takeoff reveal finishes; locks calibration controls.
  const [launching, setLaunching] = useState(false);

  // The landing page starts from the last choices saved in this browser (or the defaults).
  const [settings, setSettings] = useState<FlightSettings>(() => loadSettings());
  const [quickStartSettings, setQuickStartSettings] = useState<FlightSettings>(() => loadSettings());
  const [hasSaved, setHasSaved] = useState(() => hasSavedSettings());
  const { bird: selectedBird, map: selectedMap, weather: selectedWeather, ringChallenge: ringChallengeEnabled } = settings;
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);

  const [sensitivity, setSensitivity] = useState(1);
  const [calibrationStep, setCalibrationStep] = useState(0);

  const calibrationStepRef = useRef(calibrationStep);
  calibrationStepRef.current = calibrationStep;

  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  // The landing intro timeline plays once per page load, not on every return from pre-flight.
  const [introPending, setIntroPending] = useState(true);
  // The landing's WebGL backdrop stays up through the landing and pre-flight screens, and is
  // disposed right before the game engine is built (see disposeLandingScene).
  const [landingBackdropOn, setLandingBackdropOn] = useState(true);
  const [landingScene, setLandingScene] = useState<LandingScene | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!landingBackdropOn) return;
    const container = landingContainerRef.current;
    if (!container) return;
    const current = settingsRef.current;
    let scene: LandingScene;
    try {
      scene = new LandingScene(container, {
        bird: current.bird,
        map: current.map,
        weather: current.weather,
        reducedMotion,
        onTelemetry: (telemetry) => telemetryListenerRef.current?.(telemetry),
      });
    } catch (error) {
      // No WebGL: the page still works over the CSS sky gradient on <html>.
      console.warn('Landing backdrop unavailable (WebGL could not start)', error);
      return;
    }
    scene.start();
    landingSceneRef.current = scene;
    setLandingScene(scene);
    return () => {
      scene.dispose();
      if (landingSceneRef.current === scene) landingSceneRef.current = null;
      setLandingScene(null);
    };
  }, [landingBackdropOn, reducedMotion]);

  // Keep the backdrop's bird/world/sky in sync with the choices (including a Quick start swap).
  useEffect(() => landingScene?.setBird(selectedBird), [landingScene, selectedBird]);
  useEffect(() => landingScene?.setMap(selectedMap), [landingScene, selectedMap]);
  useEffect(() => landingScene?.setWeather(selectedWeather), [landingScene, selectedWeather]);

  // Behind the pre-flight cards the backdrop holds the "above the clouds" shot. While hand tracking
  // loads ('requesting') and runs ('calibrating') on the main thread, it's paused on that frame
  // instead of competing with MediaPipe; setPaused cuts to the shot before it freezes. It resumes
  // on Back or the error screen, and is disposed outright (not just paused) once Start Flying
  // builds the engine.
  useEffect(() => {
    if (!landingScene) return;
    const preflight = flightState === 'requesting' || flightState === 'calibrating' || flightState === 'error';
    if (preflight) landingScene.setProgress(1);
    landingScene.setPaused(flightState === 'requesting' || flightState === 'calibrating');
  }, [flightState, landingScene]);

  const disposeLandingScene = useCallback(() => {
    landingSceneRef.current?.dispose();
    landingSceneRef.current = null;
    setLandingScene(null);
    setLandingBackdropOn(false);
  }, []);

  const subscribeTelemetry = useCallback((listener: ((telemetry: LandingTelemetry) => void) | null) => {
    telemetryListenerRef.current = listener;
  }, []);

  const handleSettingsChange = useCallback((patch: Partial<FlightSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    setBestScore(getBestScore());
  }, []);

  useEffect(() => {
    barrelRollingRef.current = barrelRolling;
  }, [barrelRolling]);

  useEffect(() => {
    backflippingRef.current = backflipping;
  }, [backflipping]);

  const stopEverything = useCallback(() => {
    sessionIdRef.current += 1;
    trackerRef.current?.stop();
    trackerRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
    if (previewRafRef.current !== null) cancelAnimationFrame(previewRafRef.current);
    previewRafRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    calibrationPointsRef.current = { ...EMPTY_CALIBRATION };
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  // Requests camera access and starts hand tracking, then hands control to the calibration
  // screen. The GameEngine itself isn't created until "Start Flying" — the tracker's output
  // is what carries the calibration (center + box + sensitivity), so the engine doesn't need
  // it directly.
  //
  // Every step also updates `boot`, which the boot HUD renders as its status lines: the camera
  // line follows getUserMedia + play(), and the model line follows the tracker's real download
  // progress and warm-up. Nothing here is simulated; the only added time is the short
  // BOOT_MIN_DURATION_MS / BOOT_READY_HOLD_MS gate before calibration opens.
  const handleContinueToCalibration = useCallback(async () => {
    const showError = (error: StartupError) => {
      setStartupError(error);
      setFlightState('error');
    };

    const bootStartedAt = performance.now();
    setBoot({ ...freshBootStatus(), startedAt: bootStartedAt });

    if (!window.isSecureContext) {
      showError({ kind: 'insecure-context', phase: 'camera' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showError({ kind: 'unsupported', phase: 'camera' });
      return;
    }

    const sessionId = ++sessionIdRef.current;
    const isCurrent = () => sessionId === sessionIdRef.current;

    // Start downloading hand tracking while the camera permission prompt is open, and prefetch
    // the engine chunk for "Start Flying". The no-op catch only silences an unhandled rejection
    // if this attempt is abandoned early; the awaited copy below still sees the error.
    const trackingModule = loadHandTracking();
    trackingModule.catch(() => undefined);
    loadGameEngine().catch(() => undefined);

    setStartupError(null);
    setFlightState('requesting');
    setScore(0);
    setCalibrationStep(0);
    calibrationPointsRef.current = { ...EMPTY_CALIBRATION };

    let stream: MediaStream | null = null;
    let tracker: HandTracker | null = null;
    let phase: BootPhase = 'camera';
    // Releases everything this attempt acquired. Safe to call after stopEverything() has already
    // stopped some of it (stopping a track or tracker twice is a no-op).
    const releaseLocal = () => {
      if (tracker) {
        tracker.stop();
        if (trackerRef.current === tracker) trackerRef.current = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      const video = videoRef.current;
      if (video && stream && video.srcObject === stream) video.srcObject = null;
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      });
      if (!isCurrent()) {
        releaseLocal();
        return;
      }

      const video = videoRef.current;
      if (!video) throw new Error('Missing video element');
      video.srcObject = stream;
      await video.play();
      if (!isCurrent()) {
        releaseLocal();
        return;
      }
      phase = 'model';
      const resolution = video.videoWidth > 0 ? `${video.videoWidth}×${video.videoHeight}` : null;
      setBoot((current) => ({ ...current, camera: 'online', cameraResolution: resolution, model: 'loading' }));

      // MediaPipe's JS is loaded here, on the first pre-flight, not with the landing page.
      const { HandTracker } = await trackingModule;
      if (!isCurrent()) {
        releaseLocal();
        return;
      }

      // Defined once and never recreated: it always forwards to whichever engine is
      // currently active (a no-op during calibration, since engineRef.current is still
      // null), and keeps the live preview/status state fresh on both the calibration and
      // flying screens.
      tracker = new HandTracker(video, (state: HandControlState) => {
        engineRef.current?.applyControls(state);
        latestLandmarksRef.current = state.landmarks;
        setHandDetected(state.handDetected);
        setBoosting(state.boost);
        setStatusText(
          describeStatus({
            handDetected: state.handDetected,
            roll: state.roll,
            pitch: state.pitch,
            boost: state.boost,
            barrelRolling: barrelRollingRef.current,
            backflipping: backflippingRef.current,
          }),
        );
      });
      // Registered before the (possibly slow) model load, so pressing Back mid-load stops it
      // right away via stopEverything().
      trackerRef.current = tracker;
      await tracker.start((fraction) => {
        if (!isCurrent()) return;
        const percent = Math.floor(fraction * 100);
        const model = fraction >= 1 ? 'warming' : 'loading';
        // Returning the same object when nothing visible changed lets React skip the render, so
        // this re-renders at most once per whole percent.
        setBoot((current) =>
          current.model === model && percent <= current.modelPercent
            ? current
            : { ...current, model, modelPercent: Math.max(current.modelPercent, percent) },
        );
      });
      if (!isCurrent()) {
        releaseLocal();
        return;
      }

      setBoot((current) => ({ ...current, model: 'ready', modelPercent: 100 }));
      const minDuration = reducedMotionRef.current ? 0 : BOOT_MIN_DURATION_MS;
      const hold = Math.max(BOOT_READY_HOLD_MS, minDuration - (performance.now() - bootStartedAt));
      await new Promise((resolve) => window.setTimeout(resolve, hold));
      if (!isCurrent()) {
        releaseLocal();
        return;
      }

      setFlightState('calibrating');
    } catch (error) {
      releaseLocal();
      // A superseded attempt (the player already went back) must not pop an error screen.
      if (!isCurrent()) return;
      console.error('Failed to start hand tracking', error);
      showError({ ...classifyStartupError(error), phase });
    }
  }, []);

  // "Begin pre-flight" (and Quick start): remember these choices, then start camera + tracking.
  const beginPreflight = useCallback(
    (chosen: FlightSettings) => {
      saveSettings(chosen);
      setQuickStartSettings(chosen);
      setHasSaved(true);
      setSettings(chosen);
      setIntroPending(false);
      void handleContinueToCalibration();
    },
    [handleContinueToCalibration],
  );

  const handleBeginPreflight = useCallback(() => beginPreflight(settingsRef.current), [beginPreflight]);
  const handleQuickStart = useCallback(() => beginPreflight(loadSettings()), [beginPreflight]);

  // Draws the live webcam+skeleton preview onto whichever canvas is currently mounted
  // (the calibration sensor feed, or the compact in-flight HUD one), including the calibration
  // reticles, box and current target while calibrating.
  useEffect(() => {
    if (flightState !== 'calibrating' && flightState !== 'flying') return;
    const video = videoRef.current;
    const canvas = flightState === 'calibrating' ? calibrationPreviewCanvasRef.current : hudPreviewCanvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!video || !ctx || !canvas) return;

    const width = canvas.width;
    const height = canvas.height;
    const showCalibration = flightState === 'calibrating';

    let rafId: number;
    const drawPreview = () => {
      if (video.readyState >= 2) {
        drawHandPreview(
          ctx,
          video,
          latestLandmarksRef.current,
          handConnections,
          width,
          height,
          showCalibration
            ? {
                points: calibrationPointsRef.current,
                target: CALIBRATION_STEPS[calibrationStepRef.current] ?? null,
                time: performance.now(),
              }
            : null,
        );
      }
      rafId = requestAnimationFrame(drawPreview);
    };
    rafId = requestAnimationFrame(drawPreview);
    previewRafRef.current = rafId;

    return () => cancelAnimationFrame(rafId);
  }, [flightState]);

  // Captures whichever calibration point the current step needs (neutral center, or one of
  // the 4 box corners), stores it for the overlay, and advances to the next step.
  const handleCaptureCalibrationStep = useCallback(() => {
    const step = CALIBRATION_STEPS[calibrationStep];
    if (!step || !trackerRef.current) return;
    const point =
      step.key === 'center'
        ? trackerRef.current.captureNeutralCenter()
        : trackerRef.current.captureCorner(step.key as CalibrationCorner);
    if (!point) return;
    calibrationPointsRef.current = { ...calibrationPointsRef.current, [step.key]: point };
    setCalibrationStep((s) => s + 1);
  }, [calibrationStep]);

  const handleResetCalibration = useCallback(() => {
    trackerRef.current?.resetCalibration();
    calibrationPointsRef.current = { ...EMPTY_CALIBRATION };
    setCalibrationStep(0);
  }, []);

  // Drag-to-fine-tune: once a corner has been captured, the player can grab its reticle
  // directly on the webcam preview and drag it to a new spot. Because the canvas is displayed
  // mirrored (CSS `scale-x-[-1]`) but draws calibration points un-mirrored (see
  // drawHandPreview), a pointer's fractional position within the element's own bounding box
  // maps 1:1 onto the stored (mirrored-space) calibration point — no extra flip needed here.
  const getCalibrationPointFromEvent = useCallback((event: { clientX: number; clientY: number }): CalibrationPoint | null => {
    const canvas = calibrationPreviewCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }, []);

  const findNearestCorner = useCallback((point: CalibrationPoint): CalibrationCorner | null => {
    const HIT_RADIUS = 0.09;
    const corners = calibrationPointsRef.current;
    let nearest: CalibrationCorner | null = null;
    let nearestDist = HIT_RADIUS;
    (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as CalibrationCorner[]).forEach((corner) => {
      const value = corners[corner];
      if (!value) return;
      const dist = Math.hypot(value.x - point.x, value.y - point.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = corner;
      }
    });
    return nearest;
  }, []);

  const handleCornerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const point = getCalibrationPointFromEvent(event);
      if (!point) return;
      const corner = findNearestCorner(point);
      if (!corner) return;
      draggingCornerRef.current = corner;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [getCalibrationPointFromEvent, findNearestCorner],
  );

  const handleCornerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const corner = draggingCornerRef.current;
      if (!corner) return;
      const point = getCalibrationPointFromEvent(event);
      if (!point) return;
      calibrationPointsRef.current = { ...calibrationPointsRef.current, [corner]: point };
      trackerRef.current?.setCorner(corner, point);
      event.preventDefault();
    },
    [getCalibrationPointFromEvent],
  );

  const handleCornerPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingCornerRef.current) return;
    draggingCornerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleSensitivityChange = useCallback((value: number) => {
    setSensitivity(value);
    trackerRef.current?.setSensitivity(value);
  }, []);

  /** Kills any takeoff animation, hides the veil, and releases a pending launch await. */
  const resetTakeoff = useCallback(() => {
    takeoffTimelineRef.current?.kill();
    takeoffTimelineRef.current = null;
    if (takeoffVeilRef.current) gsap.set(takeoffVeilRef.current, { autoAlpha: 0 });
    takeoffResolveRef.current?.();
    takeoffResolveRef.current = null;
    setLaunching(false);
  }, []);

  /**
   * Takeoff, part 1: the calibration panel lifts away and a pale "cloud" veil closes over the
   * screen. Resolves once the veil is opaque, so the landing backdrop can be swapped for the
   * engine unseen. Part 2 (the reveal) runs once flightState is 'flying'.
   */
  const playTakeoffLaunch = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const veil = takeoffVeilRef.current;
        takeoffTimelineRef.current?.kill();
        takeoffResolveRef.current = resolve;
        if (!veil) {
          resolve();
          return;
        }
        const done = () => {
          if (takeoffResolveRef.current === resolve) takeoffResolveRef.current = null;
          resolve();
        };
        const timeline = gsap.timeline({ onComplete: done });
        if (reducedMotionRef.current) {
          timeline.fromTo(veil, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'none' });
        } else {
          const panel = document.querySelector('[data-calibration-panel]');
          const text = veil.querySelectorAll('[data-takeoff-text]');
          const line = veil.querySelector('[data-takeoff-line]');
          if (panel) timeline.to(panel, { y: -28, scale: 0.97, autoAlpha: 0, duration: 0.5, ease: 'power2.in' }, 0);
          timeline.fromTo(veil, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: 'power2.inOut' }, 0.12);
          if (line) {
            timeline.fromTo(line, { scaleX: 0, opacity: 1, y: 0 }, { scaleX: 1, duration: 0.6, ease: 'expo.out' }, 0.3);
          }
          timeline.fromTo(
            text,
            { opacity: 0, y: 10 },
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out' },
            0.3,
          );
        }
        takeoffTimelineRef.current = timeline;
      }),
    [],
  );

  const handleStartFlying = useCallback(async () => {
    if (!canvasContainerRef.current || engineRef.current || startingFlightRef.current) return;
    startingFlightRef.current = true;
    setLaunching(true);
    const sessionId = sessionIdRef.current;

    let GameEngineClass: typeof GameEngine;
    try {
      // The engine chunk was prefetched at pre-flight, so it's normally ready well before the veil
      // has closed.
      [{ GameEngine: GameEngineClass }] = await Promise.all([loadGameEngine(), playTakeoffLaunch()]);
    } catch (error) {
      startingFlightRef.current = false;
      if (sessionId !== sessionIdRef.current) return;
      console.error('Failed to load the game engine', error);
      resetTakeoff();
      stopEverything();
      setBoot((current) => ({ ...current, calibration: 'done', startedAt: performance.now() }));
      setStartupError({ kind: 'engine-load-failed', detail: classifyStartupError(error).detail, phase: 'engine' });
      setFlightState('error');
      return;
    }
    // The player may have pressed Back while the engine chunk was loading.
    if (sessionId !== sessionIdRef.current || !canvasContainerRef.current) {
      startingFlightRef.current = false;
      return;
    }

    // Free the landing backdrop's GPU memory and WebGL context before the engine creates its own.
    disposeLandingScene();

    const engine = new GameEngineClass(canvasContainerRef.current, {
      birdType: selectedBird,
      mapType: selectedMap,
      weather: selectedWeather,
      ringChallenge: ringChallengeEnabled,
      onScoreChange: (total) => {
        setScore(total);
        setBestScore(saveBestScoreIfHigher(total));
      },
      onBarrelRoll: () => setBarrelRolling(true),
      onBackflip: () => setBackflipping(true),
      onWaterTransition: (state) => {
        setUnderwater(state === 'submerged');
        if (state === 'surfaced') setSurfaceSplash(true);
      },
    });
    engineRef.current = engine;
    try {
      await engine.start();
    } catch (error) {
      // Don't leave the player under an opaque veil.
      if (engineRef.current === engine) resetTakeoff();
      throw error;
    } finally {
      startingFlightRef.current = false;
    }
    // The player may have pressed Back while the engine was starting; stopEverything() has
    // already disposed it in that case.
    if (engineRef.current !== engine) return;
    setFlightState('flying');
  }, [
    selectedBird,
    selectedMap,
    selectedWeather,
    ringChallengeEnabled,
    stopEverything,
    disposeLandingScene,
    playTakeoffLaunch,
    resetTakeoff,
  ]);

  // Takeoff, part 2: once the first flight frame is up, the veil lifts off the chase camera's
  // swoop-in and the HUD blocks stagger in. Explicit from/to values keep this correct even if an
  // earlier run was killed halfway.
  useLayoutEffect(() => {
    if (flightState !== 'flying' || !launching) return;
    const veil = takeoffVeilRef.current;
    if (!veil) return;
    const hud = document.querySelectorAll('[data-flight-hud]');
    const timeline = gsap.timeline({
      onComplete: () => {
        takeoffTimelineRef.current = null;
        setLaunching(false);
      },
    });
    if (reducedMotionRef.current) {
      timeline.to(veil, { autoAlpha: 0, duration: 0.4, ease: 'none' });
    } else {
      timeline
        .to(
          veil.querySelectorAll('[data-takeoff-text], [data-takeoff-line]'),
          { opacity: 0, y: -8, duration: 0.3, ease: 'power1.in' },
          0,
        )
        .to(veil, { autoAlpha: 0, duration: 1.1, ease: 'power2.out' }, 0.15)
        .fromTo(
          hud,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.7, stagger: 0.07, ease: 'power3.out', clearProps: 'opacity,transform' },
          0.55,
        );
    }
    takeoffTimelineRef.current = timeline;
  }, [flightState, launching]);

  useEffect(() => {
    if (!barrelRolling) return;
    const timeout = window.setTimeout(() => setBarrelRolling(false), 850);
    return () => window.clearTimeout(timeout);
  }, [barrelRolling]);

  useEffect(() => {
    if (!backflipping) return;
    const timeout = window.setTimeout(() => setBackflipping(false), 950);
    return () => window.clearTimeout(timeout);
  }, [backflipping]);

  useEffect(() => {
    if (!surfaceSplash) return;
    const timeout = window.setTimeout(() => setSurfaceSplash(false), 700);
    return () => window.clearTimeout(timeout);
  }, [surfaceSplash]);

  const handleBackToMenu = useCallback(() => {
    resetTakeoff();
    stopEverything();
    setLandingBackdropOn(true);
    setFlightState('landing');
    setHandDetected(false);
    setBoosting(false);
    setBarrelRolling(false);
    setBackflipping(false);
    setUnderwater(false);
    setSurfaceSplash(false);
    setStartupError(null);
    setCalibrationStep(0);
    setStatusText('No Hand Detected');
  }, [stopEverything, resetTakeoff]);

  const handleStopFlight = handleBackToMenu;

  const flying = flightState === 'flying';
  const takeoffSummary = [
    optionName(BIRD_OPTIONS, selectedBird),
    optionName(MAP_OPTIONS, selectedMap),
    optionName(WEATHER_OPTIONS, selectedWeather),
  ].join(' · ');

  return (
    <div className="relative min-h-svh">
      {/* Landing/pre-flight WebGL backdrop, and the game engine's canvas. Only one of the two
          ever holds a live renderer. */}
      <div ref={landingContainerRef} className="fixed inset-0" aria-hidden="true" />
      <div ref={canvasContainerRef} className="fixed inset-0" />

      {flying && (
        <FlightHud
          engineRef={engineRef}
          previewCanvasRef={hudPreviewCanvasRef}
          previewWidth={HUD_PREVIEW_WIDTH}
          previewHeight={HUD_PREVIEW_HEIGHT}
          handDetected={handDetected}
          boosting={boosting}
          barrelRolling={barrelRolling}
          backflipping={backflipping}
          underwater={underwater}
          surfaceSplash={surfaceSplash}
          showDiving={selectedMap === 'ocean'}
          ringChallenge={ringChallengeEnabled}
          score={score}
          bestScore={bestScore}
          statusText={statusText}
          onStop={handleStopFlight}
        />
      )}

      <video ref={videoRef} className="hidden" muted playsInline />

      {flightState === 'landing' && (
        <Landing
          scene={landingScene}
          settings={settings}
          bestScore={bestScore}
          quickStartSettings={quickStartSettings}
          hasSavedSettings={hasSaved}
          reducedMotion={reducedMotion}
          playIntro={introPending}
          onChange={handleSettingsChange}
          onBegin={handleBeginPreflight}
          onQuickStart={handleQuickStart}
          subscribeTelemetry={subscribeTelemetry}
        />
      )}

      {/* One boot HUD instance for both states, so a failure (and Try Again) updates the lines in
          place instead of replaying the typing. */}
      {(flightState === 'requesting' || flightState === 'error') && (
        <BootSequence
          lines={buildBootLines(boot, flightState === 'error' ? startupError : null)}
          errorLineKey={flightState === 'error' && startupError ? startupError.phase : null}
          errorMessage={startupError ? STARTUP_ERROR_MESSAGES[startupError.kind] : null}
          errorDetail={startupError?.detail ?? null}
          startedAt={boot.startedAt}
          running={flightState === 'requesting'}
          reducedMotion={reducedMotion}
          onRetry={handleContinueToCalibration}
          onBack={handleBackToMenu}
        />
      )}

      {flightState === 'calibrating' && (
        <PreflightLayer>
          <CalibrationPanel
            canvasRef={calibrationPreviewCanvasRef}
            canvasWidth={CALIBRATION_PREVIEW_WIDTH}
            canvasHeight={CALIBRATION_PREVIEW_HEIGHT}
            handDetected={handDetected}
            step={calibrationStep}
            sensitivity={sensitivity}
            feedResolution={boot.cameraResolution}
            launching={launching}
            onCapture={handleCaptureCalibrationStep}
            onReset={handleResetCalibration}
            onSensitivityChange={handleSensitivityChange}
            onStartFlying={handleStartFlying}
            onBack={handleBackToMenu}
            onCanvasPointerDown={handleCornerPointerDown}
            onCanvasPointerMove={handleCornerPointerMove}
            onCanvasPointerUp={handleCornerPointerUp}
          />
        </PreflightLayer>
      )}

      {/* Takeoff veil: the pale sky the landing intro fades in from, closing over calibration and
          lifting off the first flight frame. Always mounted and hidden, animated only by GSAP. */}
      <div
        ref={takeoffVeilRef}
        className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-[#dff0f6] to-[#fdf3e0] px-6 text-center text-[color:var(--ascent-ink)]"
        style={{ opacity: 0, visibility: 'hidden' }}
        aria-hidden="true"
      >
        <div>
          <p data-takeoff-text className="ascent-hud text-[color:var(--ascent-ink)]/70">
            Pre-flight complete <span className="mx-1.5 opacity-50">·</span> {takeoffSummary}
          </p>
          <span data-takeoff-line className="mx-auto my-5 block h-px w-48 origin-center bg-[color:var(--ascent-ink)]/40" />
          <p data-takeoff-text className="font-display text-[clamp(3rem,7vw,5.5rem)] leading-none tracking-[-0.015em]">
            Cleared for takeoff
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Full-screen scrollable layer for the pre-flight cards. The card sits inside a `min-h-full`
 * flex box rather than directly in an `items-center` scroller, so a card taller than the window
 * starts at the top and scrolls instead of having its top cut off (CLAUDE.md §9 #7).
 */
function PreflightLayer({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-[#06101f]/25">
      <div className="flex min-h-full items-center justify-center px-4 py-8 sm:px-6 sm:py-10">{children}</div>
    </div>
  );
}

export default App;
