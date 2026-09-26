import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { NormalizedLandmark } from '@mediapipe/hands';
import { X, Crosshair, ChevronLeft, RotateCcw, ArrowRight } from 'lucide-react';
import type { GameEngine } from '@/game/GameEngine';
import { LandingScene, type LandingTelemetry } from '@/game/LandingScene';
import { TrackingStartError, MIN_SENSITIVITY, MAX_SENSITIVITY } from '@/game/trackingShared';
import type { HandTracker, HandControlState, CalibrationPoint, CalibrationCorner } from '@/game/handControls';
import { getBestScore, saveBestScoreIfHigher } from '@/game/highscore';
import { hasSavedSettings, loadSettings, saveSettings, type FlightSettings } from '@/game/settings';
import { Landing } from '@/landing/Landing';

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
  | 'unknown';

interface StartupError {
  kind: StartupErrorKind;
  /** Raw error text, shown small under the friendly message to help with debugging. */
  detail?: string;
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
  unknown: 'Something went wrong while starting the camera. Please try again.',
};

/** Maps a getUserMedia / video.play() / HandTracker failure onto a specific, user-facing error. */
function classifyStartupError(error: unknown): StartupError {
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

// The small in-flight HUD preview stays compact; the calibration screen gets a larger one
// so the player can clearly see the crosshair/box and their hand while setting it up.
const HUD_PREVIEW_WIDTH = 176;
const HUD_PREVIEW_HEIGHT = 132;
const CALIBRATION_PREVIEW_WIDTH = 360;
const CALIBRATION_PREVIEW_HEIGHT = 270;

interface CalibrationPointsMap {
  center: CalibrationPoint | null;
  topLeft: CalibrationPoint | null;
  topRight: CalibrationPoint | null;
  bottomLeft: CalibrationPoint | null;
  bottomRight: CalibrationPoint | null;
}

const EMPTY_CALIBRATION: CalibrationPointsMap = {
  center: null,
  topLeft: null,
  topRight: null,
  bottomLeft: null,
  bottomRight: null,
};

type CalibrationStepKey = keyof CalibrationPointsMap;

const CALIBRATION_STEPS: { key: CalibrationStepKey; title: string; instruction: string; buttonLabel: string }[] = [
  {
    key: 'center',
    title: 'Step 1 of 5 — Neutral Center',
    instruction:
      'Hold your hand comfortably in front of the camera, wherever feels natural. This is where "fly straight" will be.',
    buttonLabel: 'Set Center',
  },
  {
    key: 'topLeft',
    title: 'Step 2 of 5 — Top-Left Boundary',
    instruction: 'Move to the top-left edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Top-Left',
  },
  {
    key: 'topRight',
    title: 'Step 3 of 5 — Top-Right Boundary',
    instruction: 'Move to the top-right edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Top-Right',
  },
  {
    key: 'bottomLeft',
    title: 'Step 4 of 5 — Bottom-Left Boundary',
    instruction: 'Move to the bottom-left edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Bottom-Left',
  },
  {
    key: 'bottomRight',
    title: 'Step 5 of 5 — Bottom-Right Boundary',
    instruction: 'Move to the bottom-right edge of your comfortable range, then lock it in.',
    buttonLabel: 'Set Bottom-Right',
  },
];

/**
 * Draws the webcam frame + hand skeleton onto a preview canvas, optionally with the
 * in-progress calibration box (center crosshair + up to 4 corner markers) overlaid. Shared by
 * both the small in-flight HUD preview and the larger calibration-screen preview.
 */
function drawHandPreview(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[] | null,
  width: number,
  height: number,
  calibration?: CalibrationPointsMap | null,
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);

  if (landmarks) {
    ctx.strokeStyle = 'rgba(255, 214, 165, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [start, end] of handConnections) {
      const a = landmarks[start];
      const b = landmarks[end];
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
    }
    ctx.stroke();

    ctx.fillStyle = '#ff8a5c';
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (calibration) {
    // Calibration points come from HandTracker in its mirrored-frame coordinate space (X is
    // already flipped to match the mirrored steering math), but this canvas draws the raw
    // video and raw landmarks un-mirrored — the whole canvas gets flipped horizontally
    // afterward via CSS (`scale-x-[-1]`) for display. So every point here must be un-mirrored
    // back to raw canvas space, or it would land on the wrong side once the CSS flip applies.
    const toCanvas = (p: CalibrationPoint) => ({ x: (1 - p.x) * width, y: p.y * height });

    const corners = [calibration.topLeft, calibration.topRight, calibration.bottomRight, calibration.bottomLeft];
    if (corners.every((c): c is CalibrationPoint => c !== null)) {
      ctx.strokeStyle = 'rgba(94, 234, 212, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      corners.forEach((p, i) => {
        const c = toCanvas(p);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const corner of [calibration.topLeft, calibration.topRight, calibration.bottomLeft, calibration.bottomRight]) {
      if (!corner) continue;
      const c = toCanvas(corner);
      ctx.fillStyle = 'rgba(255, 138, 92, 0.95)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (calibration.center) {
      const c = toCanvas(calibration.center);
      ctx.strokeStyle = 'rgba(94, 234, 212, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x - 12, c.y);
      ctx.lineTo(c.x + 12, c.y);
      ctx.moveTo(c.x, c.y - 12);
      ctx.lineTo(c.x, c.y + 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Small deadzone-aware label describing the current hand pose, shown under the webcam preview. */
function describeStatus(state: {
  handDetected: boolean;
  roll: number;
  pitch: number;
  boost: boolean;
  barrelRolling: boolean;
  backflipping: boolean;
}) {
  if (!state.handDetected) return 'Status: No Hand Detected';
  if (state.boost) return 'Status: Fist (Boost) Active';
  if (state.barrelRolling) return 'Status: Barrel Roll Detected';
  if (state.backflipping) return 'Status: Backflip!';
  if (state.roll > 0) return 'Status: Steering Right';
  if (state.roll < 0) return 'Status: Steering Left';
  if (state.pitch > 0) return 'Status: Pitching Up';
  if (state.pitch < 0) return 'Status: Pitching Down';
  return 'Status: Flying Straight';
}

function sensitivityLabel(value: number) {
  if (value < 0.85) return 'Low';
  if (value > 1.4) return 'High';
  return 'Medium';
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

  const [flightState, setFlightState] = useState<FlightState>('landing');
  const [handDetected, setHandDetected] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [barrelRolling, setBarrelRolling] = useState(false);
  const [backflipping, setBackflipping] = useState(false);
  const [underwater, setUnderwater] = useState(false);
  const [surfaceSplash, setSurfaceSplash] = useState(false);
  const [statusText, setStatusText] = useState('Status: No Hand Detected');
  const [startupError, setStartupError] = useState<StartupError | null>(null);

  // The landing page starts from the last choices saved in this browser (or the defaults).
  const [settings, setSettings] = useState<FlightSettings>(() => loadSettings());
  const [quickStartSettings, setQuickStartSettings] = useState<FlightSettings>(() => loadSettings());
  const [hasSaved, setHasSaved] = useState(() => hasSavedSettings());
  const { bird: selectedBird, map: selectedMap, weather: selectedWeather, ringChallenge: ringChallengeEnabled } = settings;
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);

  const [sensitivity, setSensitivity] = useState(1);
  const [calibrationStep, setCalibrationStep] = useState(0);

  const calibrationComplete = calibrationStep >= CALIBRATION_STEPS.length;

  const reducedMotion = usePrefersReducedMotion();
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

  // During calibration MediaPipe is tracking on the main thread, so the backdrop freezes on its
  // last frame instead of competing with it. It resumes on Back or the error screen, and is
  // disposed outright (not just paused) once Start Flying builds the engine.
  useEffect(() => {
    landingScene?.setPaused(flightState === 'calibrating');
  }, [flightState, landingScene]);

  // Behind the pre-flight cards, the backdrop holds the "above the clouds" shot.
  useEffect(() => {
    if (flightState === 'requesting' || flightState === 'calibrating' || flightState === 'error') {
      landingScene?.setProgress(1);
    }
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
  const handleContinueToCalibration = useCallback(async () => {
    const showError = (error: StartupError) => {
      setStartupError(error);
      setFlightState('error');
    };

    if (!window.isSecureContext) {
      showError({ kind: 'insecure-context' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showError({ kind: 'unsupported' });
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
      await tracker.start();
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
      showError(classifyStartupError(error));
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
  // (the larger calibration one, or the compact in-flight HUD one), including the in-progress
  // calibration box while calibrating.
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
          width,
          height,
          showCalibration ? calibrationPointsRef.current : null,
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

  // Drag-to-fine-tune: once a corner has been captured, the player can grab its handle
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

  const handleStartFlying = useCallback(async () => {
    if (!canvasContainerRef.current || engineRef.current || startingFlightRef.current) return;
    startingFlightRef.current = true;
    const sessionId = sessionIdRef.current;

    let GameEngineClass: typeof GameEngine;
    try {
      ({ GameEngine: GameEngineClass } = await loadGameEngine());
    } catch (error) {
      startingFlightRef.current = false;
      if (sessionId !== sessionIdRef.current) return;
      console.error('Failed to load the game engine', error);
      stopEverything();
      setStartupError(classifyStartupError(error));
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
    } finally {
      startingFlightRef.current = false;
    }
    // The player may have pressed Back while the engine was starting; stopEverything() has
    // already disposed it in that case.
    if (engineRef.current !== engine) return;
    setFlightState('flying');
  }, [selectedBird, selectedMap, selectedWeather, ringChallengeEnabled, stopEverything, disposeLandingScene]);

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
    setStatusText('Status: No Hand Detected');
  }, [stopEverything]);

  const handleStopFlight = handleBackToMenu;

  const flying = flightState === 'flying';
  const calibrating = flightState === 'calibrating';
  const currentCalibrationStep = CALIBRATION_STEPS[calibrationStep] ?? null;

  return (
    <div className="relative min-h-svh">
      {/* Landing/pre-flight WebGL backdrop, and the game engine's canvas. Only one of the two
          ever holds a live renderer. */}
      <div ref={landingContainerRef} className="fixed inset-0" aria-hidden="true" />
      <div ref={canvasContainerRef} className="fixed inset-0" />

      {flying && (
        <div className="fixed inset-0 z-10 overflow-hidden">
          {/* CSS-only speed-blur / motion-streak vignette around the screen edges during
              Boost — a lightweight stand-in for a full post-processing motion-blur pass,
              since the renderer here doesn't run an EffectComposer pipeline. */}
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-200"
            style={{
              opacity: boosting ? 1 : 0,
              background:
                'radial-gradient(ellipse at center, rgba(255,255,255,0) 42%, rgba(255,244,224,0.35) 78%, rgba(255,214,165,0.65) 100%)',
              boxShadow: 'inset 0 0 140px 40px rgba(255,180,110,0.45)',
            }}
          />
          {/* Brief water-droplet screen flash the moment the bird breaks back into the air
              after a dive. */}
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-150"
            style={{
              opacity: surfaceSplash ? 1 : 0,
              background:
                'radial-gradient(ellipse at center, rgba(255,255,255,0) 30%, rgba(214,244,255,0.5) 75%, rgba(160,220,255,0.75) 100%)',
            }}
          />
          {/* Blue tint overlay while submerged, on top of the underwater fog/lighting already
              applied inside the 3D scene itself. */}
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-500"
            style={{
              opacity: underwater ? 1 : 0,
              background: 'linear-gradient(rgba(20,110,150,0.18), rgba(10,60,90,0.32))',
            }}
          />

          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-center">
            <p className="rounded-full bg-card/70 px-5 py-2 text-sm font-medium tracking-wide text-foreground/80 shadow-sm backdrop-blur-sm">
              {handDetected ? 'Tilt your palm to glide' : 'Show your hand to the camera to steer'}
            </p>
          </div>

          {ringChallengeEnabled && (
            <div className="pointer-events-none absolute left-6 top-6">
              <p className="rounded-full bg-card/80 px-5 py-2 text-sm font-semibold tracking-wide text-foreground shadow-sm backdrop-blur-sm">
                Score: {score}
              </p>
            </div>
          )}

          <div className="absolute right-6 top-6">
            <button
              type="button"
              onClick={handleStopFlight}
              className="flex items-center gap-1.5 rounded-full bg-card/80 px-4 py-2 text-xs font-semibold tracking-wide text-foreground/80 shadow-sm backdrop-blur-sm transition hover:bg-card"
            >
              <X className="h-3.5 w-3.5" />
              Stop Game
            </button>
          </div>

          <div className="pointer-events-none absolute bottom-6 left-6 flex gap-2">
            <span
              className={`rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide transition-opacity ${
                boosting ? 'bg-primary text-primary-foreground opacity-100' : 'bg-card/60 text-foreground/50 opacity-70'
              }`}
            >
              Boost
            </span>
            <span
              className={`rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide transition-opacity ${
                barrelRolling ? 'bg-secondary text-secondary-foreground opacity-100' : 'bg-card/60 text-foreground/50 opacity-70'
              }`}
            >
              Barrel Roll
            </span>
            <span
              className={`rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide transition-opacity ${
                backflipping ? 'bg-secondary text-secondary-foreground opacity-100' : 'bg-card/60 text-foreground/50 opacity-70'
              }`}
            >
              Backflip
            </span>
            {selectedMap === 'ocean' && (
              <span
                className={`rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide transition-opacity ${
                  underwater ? 'bg-sky-500 text-white opacity-100' : 'bg-card/60 text-foreground/50 opacity-70'
                }`}
              >
                Diving
              </span>
            )}
          </div>

          <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1.5">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-lg backdrop-blur-sm">
              <canvas
                ref={hudPreviewCanvasRef}
                width={HUD_PREVIEW_WIDTH}
                height={HUD_PREVIEW_HEIGHT}
                className="block scale-x-[-1]"
              />
            </div>
            <p className="rounded-full bg-card/70 px-3 py-1 text-[11px] font-medium tracking-wide text-foreground/70 shadow-sm backdrop-blur-sm">
              {statusText}
            </p>
          </div>
        </div>
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

      {(flightState === 'requesting' || flightState === 'error') && (
        <PreflightLayer>
          <div className="ascent-glass-strong w-full max-w-md rounded-[28px] p-8 text-white shadow-2xl">
            <p className="ascent-hud mb-4 text-[color:var(--ascent-cyan)]">
              Pre-flight <span className="mx-1.5 text-white/40">·</span> 01 / 02
            </p>
            {flightState === 'requesting' && (
              <>
                <h1 className="font-display text-5xl leading-none">Waking up the sky…</h1>
                <p className="mt-4 text-sm leading-relaxed text-white/80">
                  Allow camera access, then hand tracking loads (about 13 MB the first time).
                </p>
                <div className="relative mt-6 h-px overflow-hidden bg-white/20" aria-hidden="true">
                  <span className="ascent-loading-bar absolute inset-y-0 w-1/3 bg-white" />
                </div>
              </>
            )}
            {flightState === 'error' && (
              <>
                <h1 className="font-display text-5xl leading-none">Pre-flight halted</h1>
                {startupError && (
                  <div className="mt-5 rounded-2xl border border-[#ffb4a2]/40 bg-[#ff6b4a]/15 px-4 py-3 text-sm text-white">
                    <p>{STARTUP_ERROR_MESSAGES[startupError.kind]}</p>
                    {startupError.detail && (
                      <p className="mt-1.5 break-words font-mono text-[11px] text-white/60">{startupError.detail}</p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleContinueToCalibration}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[color:var(--ascent-ink)] transition hover:bg-[color:var(--ascent-warm)]"
                >
                  Try Again
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleBackToMenu}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white/90 transition hover:bg-white/10"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          </div>
        </PreflightLayer>
      )}

      {calibrating && (
        <PreflightLayer>
          <div className="ascent-glass-strong grid w-full max-w-5xl gap-8 rounded-[28px] p-6 text-white shadow-2xl sm:p-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <button
                type="button"
                onClick={handleBackToMenu}
                className="ascent-hud mb-4 flex items-center gap-1 text-white/70 transition hover:text-white"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="overflow-hidden rounded-2xl border border-white/20 bg-black/30 shadow-inner">
                <canvas
                  ref={calibrationPreviewCanvasRef}
                  width={CALIBRATION_PREVIEW_WIDTH}
                  height={CALIBRATION_PREVIEW_HEIGHT}
                  className="block w-full cursor-crosshair scale-x-[-1] touch-none"
                  onPointerDown={handleCornerPointerDown}
                  onPointerMove={handleCornerPointerMove}
                  onPointerUp={handleCornerPointerUp}
                  onPointerCancel={handleCornerPointerUp}
                />
              </div>
              <p className="ascent-hud mt-3 flex items-center gap-2 text-white/85">
                <span
                  className={`h-2 w-2 rounded-full ${handDetected ? 'bg-[color:var(--ascent-cyan)]' : 'bg-white/30'}`}
                  aria-hidden="true"
                />
                {handDetected ? 'Hand detected — hold it at the target position.' : 'Show your hand to the camera.'}
              </p>
              <p className="mt-1.5 text-xs text-white/65">
                You can also drag any orange corner dot directly on the preview to fine-tune it.
              </p>
            </div>

            <div className="flex min-w-0 flex-col">
              <p className="ascent-hud mb-3 text-[color:var(--ascent-cyan)]">
                Pre-flight <span className="mx-1.5 text-white/40">·</span> 02 / 02
              </p>
              <h1 className="font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none">Calibrate your controls</h1>

              <div className="mb-4 mt-5 flex items-center gap-1.5">
                {CALIBRATION_STEPS.map((step, i) => (
                  <span
                    key={step.key}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      i < calibrationStep ? 'bg-white' : i === calibrationStep ? 'bg-white/50' : 'bg-white/15'
                    }`}
                  />
                ))}
              </div>

              {!calibrationComplete && currentCalibrationStep && (
                <>
                  <p className="text-sm font-semibold">{currentCalibrationStep.title}</p>
                  <p className="mb-5 mt-1 text-sm leading-relaxed text-white/75">{currentCalibrationStep.instruction}</p>
                </>
              )}
              {calibrationComplete && (
                <p className="mb-5 text-sm leading-relaxed text-white/75">
                  Your control range is calibrated — flight pitch and roll are now mapped to fit exactly
                  within the box you just drew.
                </p>
              )}

              {!calibrationComplete && (
                <button
                  type="button"
                  onClick={handleCaptureCalibrationStep}
                  disabled={!handDetected}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Crosshair className="h-4 w-4" />
                  {currentCalibrationStep?.buttonLabel}
                </button>
              )}
              {calibrationComplete && (
                <p className="ascent-hud text-[color:var(--ascent-cyan)]">Calibrated! Your control range is set.</p>
              )}

              {calibrationStep > 0 ? (
                <button
                  type="button"
                  onClick={handleResetCalibration}
                  className="ascent-hud mt-3 flex items-center justify-center gap-1.5 self-center text-white/65 transition hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Start Over
                </button>
              ) : (
                <div className="mt-3 h-4" />
              )}

              <div className="mb-6 mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <p className="ascent-hud text-white/65">Steering Sensitivity</p>
                  <p className="ascent-hud text-white">
                    {sensitivityLabel(sensitivity)} ({sensitivity.toFixed(1)}x)
                  </p>
                </div>
                <input
                  type="range"
                  min={MIN_SENSITIVITY}
                  max={MAX_SENSITIVITY}
                  step={0.1}
                  value={sensitivity}
                  onChange={(event) => handleSensitivityChange(Number(event.target.value))}
                  className="w-full accent-[color:var(--ascent-warm)]"
                />
                <div className="ascent-hud mt-1 flex justify-between text-[10px] text-white/55">
                  <span>Calm</span>
                  <span>Twitchy</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartFlying}
                disabled={!calibrationComplete}
                className="group mt-auto flex w-full items-center justify-between rounded-full bg-white py-2 pl-6 pr-2 text-[color:var(--ascent-ink)] transition hover:bg-[color:var(--ascent-warm)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white"
              >
                <span className="text-base font-semibold">Start Flying</span>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--ascent-ink)] text-white">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          </div>
        </PreflightLayer>
      )}
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
