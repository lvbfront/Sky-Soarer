import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { HAND_CONNECTIONS, type NormalizedLandmark } from '@mediapipe/hands';
import { Hand, MoveHorizontal, MoveVertical, Zap, ArrowUp, X, Crosshair, ChevronLeft, RotateCcw } from 'lucide-react';
import { GameEngine, MAP_OPTIONS, WEATHER_OPTIONS, type MapType, type WeatherPreset } from '@/game/GameEngine';
import { BIRD_OPTIONS, type BirdType } from '@/game/bird';
import {
  HandTracker,
  TrackingStartError,
  MIN_SENSITIVITY,
  MAX_SENSITIVITY,
  type HandControlState,
  type CalibrationPoint,
  type CalibrationCorner,
} from '@/game/handControls';
import { getBestScore, saveBestScoreIfHigher } from '@/game/highscore';

type FlightState = 'menu' | 'requesting' | 'calibrating' | 'flying' | 'error';

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

const GESTURE_GUIDE = [
  {
    icon: Hand,
    title: 'Open hand, at your neutral center',
    description: 'Glide straight and steady.',
  },
  {
    icon: MoveHorizontal,
    title: 'Move hand left / right',
    description: 'Turn and roll that way.',
  },
  {
    icon: MoveVertical,
    title: 'Move hand up / down',
    description: 'Pitch up to climb, down to dive.',
  },
  {
    icon: Zap,
    title: 'Close into a fist',
    description: 'Speed boost — and an automatic barrel roll the instant your fist closes.',
  },
  {
    icon: ArrowUp,
    title: 'Flick your hand up, fast',
    description: 'Triggers an automatic backflip along your flight path.',
  },
] as const;

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
    for (const [start, end] of HAND_CONNECTIONS) {
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

  const [flightState, setFlightState] = useState<FlightState>('menu');
  const [handDetected, setHandDetected] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [barrelRolling, setBarrelRolling] = useState(false);
  const [backflipping, setBackflipping] = useState(false);
  const [underwater, setUnderwater] = useState(false);
  const [surfaceSplash, setSurfaceSplash] = useState(false);
  const [statusText, setStatusText] = useState('Status: No Hand Detected');
  const [startupError, setStartupError] = useState<StartupError | null>(null);

  const [selectedBird, setSelectedBird] = useState<BirdType>('pigeon');
  const [selectedMap, setSelectedMap] = useState<MapType>('mountain');
  const [selectedWeather, setSelectedWeather] = useState<WeatherPreset>('sunny');
  const [ringChallengeEnabled, setRingChallengeEnabled] = useState(false);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);

  const [sensitivity, setSensitivity] = useState(1);
  const [calibrationStep, setCalibrationStep] = useState(0);

  const calibrationComplete = calibrationStep >= CALIBRATION_STEPS.length;

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

    const engine = new GameEngine(canvasContainerRef.current, {
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
  }, [selectedBird, selectedMap, selectedWeather, ringChallengeEnabled]);

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
    setFlightState('menu');
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
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <div ref={canvasContainerRef} className="absolute inset-0" />

      {flying && (
        <>
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
        </>
      )}

      <video ref={videoRef} className="hidden" muted playsInline />

      {flightState === 'menu' && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#cfe8f0] via-[#e9ecd6] to-[#fbe3c9] px-6 py-10">
          <div className="w-full max-w-md rounded-3xl border border-border/50 bg-card/90 p-8 text-center shadow-xl backdrop-blur-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              A quiet little sky
            </p>
            <h1 className="mb-3 text-3xl font-semibold text-foreground">Bird Flight</h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Glide over endless landscapes — and dive beneath the waves — using nothing but
              your hand. Here's how the controls work:
            </p>

            <ul className="mb-8 flex flex-col gap-3 text-left">
              {GESTURE_GUIDE.map(({ icon: Icon, title, description }) => (
                <li
                  key={title}
                  className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3"
                >
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{title}</span>
                    <span className="block text-xs text-muted-foreground">{description}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mb-6 text-left">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Choose your bird
              </p>
              <div className="flex flex-col gap-2">
                {BIRD_OPTIONS.map((bird) => (
                  <button
                    key={bird.id}
                    type="button"
                    onClick={() => setSelectedBird(bird.id)}
                    className={`w-full rounded-2xl border px-4 py-2.5 text-left transition ${
                      selectedBird === bird.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border/60 bg-muted/40 hover:bg-muted/70'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-foreground">{bird.name}</span>
                    <span className="block text-xs text-muted-foreground">{bird.tagline}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6 text-left">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Choose your map
              </p>
              <div className="flex flex-col gap-2">
                {MAP_OPTIONS.map((map) => (
                  <button
                    key={map.id}
                    type="button"
                    onClick={() => setSelectedMap(map.id)}
                    className={`w-full rounded-2xl border px-4 py-2.5 text-left transition ${
                      selectedMap === map.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border/60 bg-muted/40 hover:bg-muted/70'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-foreground">{map.name}</span>
                    <span className="block text-xs text-muted-foreground">{map.tagline}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6 text-left">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Day, night &amp; weather
              </p>
              <div className="flex flex-col gap-2">
                {WEATHER_OPTIONS.map((weather) => (
                  <button
                    key={weather.id}
                    type="button"
                    onClick={() => setSelectedWeather(weather.id)}
                    className={`w-full rounded-2xl border px-4 py-2.5 text-left transition ${
                      selectedWeather === weather.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border/60 bg-muted/40 hover:bg-muted/70'
                    }`}
                  >
                    <span className="block text-sm font-semibold text-foreground">{weather.name}</span>
                    <span className="block text-xs text-muted-foreground">{weather.tagline}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6 flex items-center justify-between rounded-2xl bg-muted/60 px-4 py-3 text-left">
              <span>
                <span className="block text-sm font-semibold text-foreground">Ring Challenge</span>
                <span className="block text-xs text-muted-foreground">
                  Fly through glowing rings to score points.
                  {bestScore > 0 && <span className="block font-semibold text-foreground/80">Best Score: {bestScore}</span>}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={ringChallengeEnabled}
                onClick={() => setRingChallengeEnabled((v) => !v)}
                className={`relative h-6 w-11 flex-none rounded-full transition-colors ${
                  ringChallengeEnabled ? 'bg-primary' : 'bg-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    ringChallengeEnabled ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>

            <button
              type="button"
              onClick={handleContinueToCalibration}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90 disabled:opacity-60"
            >
              Continue to Calibration
            </button>

            <p className="mt-4 text-xs text-muted-foreground">
              Your camera feed stays on this page and is only used to read hand position.
            </p>
          </div>
        </div>
      )}

      {(flightState === 'requesting' || flightState === 'error') && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#cfe8f0] via-[#e9ecd6] to-[#fbe3c9] px-6 py-10">
          <div className="w-full max-w-md rounded-3xl border border-border/50 bg-card/90 p-8 text-center shadow-xl backdrop-blur-sm">
            <h1 className="mb-3 text-2xl font-semibold text-foreground">Bird Flight</h1>
            {flightState === 'requesting' && (
              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                Waking up the sky… (allow camera access, then hand tracking loads)
              </p>
            )}
            {flightState === 'error' && startupError && (
              <div className="mb-6 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
                <p>{STARTUP_ERROR_MESSAGES[startupError.kind]}</p>
                {startupError.detail && (
                  <p className="mt-1 break-words text-xs opacity-70">{startupError.detail}</p>
                )}
              </div>
            )}
            {flightState === 'error' && (
              <button
                type="button"
                onClick={handleContinueToCalibration}
                className="mb-2 w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90"
              >
                Try Again
              </button>
            )}
            <button
              type="button"
              onClick={handleBackToMenu}
              className="w-full rounded-full bg-primary/10 px-6 py-3 text-sm font-semibold text-primary transition hover:bg-primary/20"
            >
              Back to Menu
            </button>
          </div>
        </div>
      )}

      {calibrating && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#cfe8f0] via-[#e9ecd6] to-[#fbe3c9] px-6 py-10">
          <div className="w-full max-w-md rounded-3xl border border-border/50 bg-card/90 p-8 text-center shadow-xl backdrop-blur-sm">
            <button
              type="button"
              onClick={handleBackToMenu}
              className="mb-4 flex items-center gap-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>

            <h1 className="mb-4 text-2xl font-semibold text-foreground">Calibrate Your Controls</h1>

            <div className="mb-4 flex items-center justify-center gap-1.5">
              {CALIBRATION_STEPS.map((step, i) => (
                <span
                  key={step.key}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i < calibrationStep ? 'bg-primary' : i === calibrationStep ? 'bg-primary/50' : 'bg-border'
                  }`}
                />
              ))}
            </div>

            {!calibrationComplete && currentCalibrationStep && (
              <>
                <p className="mb-1 text-sm font-semibold text-foreground">{currentCalibrationStep.title}</p>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{currentCalibrationStep.instruction}</p>
              </>
            )}
            {calibrationComplete && (
              <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                Your control range is calibrated — flight pitch and roll are now mapped to fit exactly
                within the box you just drew.
              </p>
            )}

            <div className="mb-2 overflow-hidden rounded-2xl border border-border/60 bg-muted/40 shadow-inner">
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
            <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
              {handDetected ? 'Hand detected — hold it at the target position.' : 'Show your hand to the camera.'}
            </p>
            <p className="mb-5 text-xs text-muted-foreground">
              You can also drag any orange corner dot directly on the preview to fine-tune it.
            </p>

            {!calibrationComplete && (
              <button
                type="button"
                onClick={handleCaptureCalibrationStep}
                disabled={!handDetected}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 py-3 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Crosshair className="h-4 w-4" />
                {currentCalibrationStep?.buttonLabel}
              </button>
            )}
            {calibrationComplete && (
              <p className="mb-2 text-xs font-semibold text-primary">Calibrated! Your control range is set.</p>
            )}

            {calibrationStep > 0 && (
              <button
                type="button"
                onClick={handleResetCalibration}
                className="mb-5 flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Start Over
              </button>
            )}
            {calibrationStep === 0 && <div className="mb-5" />}

            <div className="mb-6 text-left">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Steering Sensitivity
                </p>
                <p className="text-xs font-semibold text-foreground">
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
                className="w-full accent-primary"
              />
              <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Calm</span>
                <span>Twitchy</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartFlying}
              disabled={!calibrationComplete}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start Flying
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
