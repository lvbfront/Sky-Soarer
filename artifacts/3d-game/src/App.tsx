import { useCallback, useEffect, useRef, useState } from 'react';
import { HAND_CONNECTIONS, type NormalizedLandmark } from '@mediapipe/hands';
import { Hand, MoveHorizontal, MoveVertical, Zap, ArrowUp, X, Crosshair, ChevronLeft, RotateCcw } from 'lucide-react';
import { GameEngine, MAP_OPTIONS, WEATHER_OPTIONS, type MapType, type WeatherPreset } from '@/game/GameEngine';
import { BIRD_OPTIONS, type BirdType } from '@/game/bird';
import {
  HandTracker,
  MIN_SENSITIVITY,
  MAX_SENSITIVITY,
  type HandControlState,
  type ControlMode,
  type CalibrationPoint,
  type CalibrationCorner,
} from '@/game/handControls';
import { getBestScore, saveBestScoreIfHigher } from '@/game/highscore';

type FlightState = 'menu' | 'requesting' | 'calibrating' | 'flying' | 'denied' | 'unsupported';

// The small in-flight HUD preview stays compact; the calibration screen gets a larger one
// so the player can clearly see the crosshair/box and their hand while setting it up.
const HUD_PREVIEW_WIDTH = 176;
const HUD_PREVIEW_HEIGHT = 132;
const CALIBRATION_PREVIEW_WIDTH = 360;
const CALIBRATION_PREVIEW_HEIGHT = 270;

const GESTURE_GUIDE_HAND = [
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

const GESTURE_GUIDE_FINGER = [
  {
    icon: Hand,
    title: 'Point your index finger, at your neutral center',
    description: 'Glide straight and steady — cursor-style flight.',
  },
  {
    icon: MoveHorizontal,
    title: 'Move your fingertip left / right',
    description: 'Turn and roll that way.',
  },
  {
    icon: MoveVertical,
    title: 'Move your fingertip up / down',
    description: 'Pitch up to climb, down to dive.',
  },
  {
    icon: Zap,
    title: 'Pinch thumb + finger, or fold your hand',
    description: 'Speed boost — and an automatic barrel roll the instant you trigger it.',
  },
  {
    icon: ArrowUp,
    title: 'Flick your finger up, fast',
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
      'Hold your hand (or finger) comfortably in front of the camera, wherever feels natural. This is where "fly straight" will be.',
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
  controlMode?: ControlMode,
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

    if (controlMode === 'finger') {
      // Highlight the index fingertip distinctly — it's the actual tracked point in Single
      // Finger Steering mode, not the palm center.
      const tip = landmarks[8];
      ctx.fillStyle = '#5eead4';
      ctx.beginPath();
      ctx.arc(tip.x * width, tip.y * height, 6, 0, Math.PI * 2);
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
function describeStatus(
  state: {
    handDetected: boolean;
    roll: number;
    pitch: number;
    boost: boolean;
    barrelRolling: boolean;
    backflipping: boolean;
  },
  controlMode: ControlMode,
) {
  if (!state.handDetected) return 'Status: No Hand Detected';
  if (state.boost) return controlMode === 'finger' ? 'Status: Pinch/Fold (Boost) Active' : 'Status: Fist (Boost) Active';
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
  const barrelRollingRef = useRef(false);
  const backflippingRef = useRef(false);

  const [flightState, setFlightState] = useState<FlightState>('menu');
  const [handDetected, setHandDetected] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [barrelRolling, setBarrelRolling] = useState(false);
  const [backflipping, setBackflipping] = useState(false);
  const [underwater, setUnderwater] = useState(false);
  const [surfaceSplash, setSurfaceSplash] = useState(false);
  const [statusText, setStatusText] = useState('Status: No Hand Detected');

  const [selectedBird, setSelectedBird] = useState<BirdType>('pigeon');
  const [selectedMap, setSelectedMap] = useState<MapType>('mountain');
  const [selectedWeather, setSelectedWeather] = useState<WeatherPreset>('sunny');
  const [ringChallengeEnabled, setRingChallengeEnabled] = useState(false);
  const [controlMode, setControlMode] = useState<ControlMode>('hand');
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setFlightState('unsupported');
      return;
    }

    setFlightState('requesting');
    setScore(0);
    setCalibrationStep(0);
    calibrationPointsRef.current = { ...EMPTY_CALIBRATION };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      });

      const video = videoRef.current;
      if (!video) throw new Error('Missing video target');
      video.srcObject = stream;
      await video.play();

      // Defined once and never recreated: it always forwards to whichever engine is
      // currently active (a no-op during calibration, since engineRef.current is still
      // null), and keeps the live preview/status state fresh on both the calibration and
      // flying screens.
      const tracker = new HandTracker(
        video,
        (state: HandControlState) => {
          engineRef.current?.applyControls(state);
          latestLandmarksRef.current = state.landmarks;
          setHandDetected(state.handDetected);
          setBoosting(state.boost);
          setStatusText(
            describeStatus(
              {
                handDetected: state.handDetected,
                roll: state.roll,
                pitch: state.pitch,
                boost: state.boost,
                barrelRolling: barrelRollingRef.current,
                backflipping: backflippingRef.current,
              },
              controlMode,
            ),
          );
        },
        () => setFlightState('denied'),
      );
      tracker.setControlMode(controlMode);
      trackerRef.current = tracker;
      await tracker.start();

      setFlightState('calibrating');
    } catch (error) {
      console.error('Failed to start hand tracking', error);
      setFlightState('denied');
    }
  }, [controlMode]);

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
          controlMode,
        );
      }
      rafId = requestAnimationFrame(drawPreview);
    };
    rafId = requestAnimationFrame(drawPreview);
    previewRafRef.current = rafId;

    return () => cancelAnimationFrame(rafId);
  }, [flightState, controlMode]);

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

  const handleSensitivityChange = useCallback((value: number) => {
    setSensitivity(value);
    trackerRef.current?.setSensitivity(value);
  }, []);

  const handleStartFlying = useCallback(async () => {
    if (!canvasContainerRef.current) return;

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
    await engine.start();
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
    setCalibrationStep(0);
    setStatusText('Status: No Hand Detected');
  }, [stopEverything]);

  const handleStopFlight = handleBackToMenu;

  const flying = flightState === 'flying';
  const calibrating = flightState === 'calibrating';
  const gestureGuide = controlMode === 'finger' ? GESTURE_GUIDE_FINGER : GESTURE_GUIDE_HAND;
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
              {handDetected
                ? controlMode === 'finger'
                  ? 'Point your finger to glide'
                  : 'Tilt your palm to glide'
                : 'Show your hand to the camera to steer'}
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

            <div className="mb-6 text-left">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                Control mode
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setControlMode('hand')}
                  className={`w-full rounded-2xl border px-4 py-2.5 text-left transition ${
                    controlMode === 'hand'
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 bg-muted/40 hover:bg-muted/70'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground">Full Hand Steering</span>
                  <span className="block text-xs text-muted-foreground">Steer with your whole palm — the classic feel.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setControlMode('finger')}
                  className={`w-full rounded-2xl border px-4 py-2.5 text-left transition ${
                    controlMode === 'finger'
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 bg-muted/40 hover:bg-muted/70'
                  }`}
                >
                  <span className="block text-sm font-semibold text-foreground">Single Finger Steering</span>
                  <span className="block text-xs text-muted-foreground">
                    Point your index finger for precise, cursor-style flight.
                  </span>
                </button>
              </div>
            </div>

            <ul className="mb-8 flex flex-col gap-3 text-left">
              {gestureGuide.map(({ icon: Icon, title, description }) => (
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

      {(flightState === 'requesting' || flightState === 'denied' || flightState === 'unsupported') && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#cfe8f0] via-[#e9ecd6] to-[#fbe3c9] px-6 py-10">
          <div className="w-full max-w-md rounded-3xl border border-border/50 bg-card/90 p-8 text-center shadow-xl backdrop-blur-sm">
            <h1 className="mb-3 text-2xl font-semibold text-foreground">Bird Flight</h1>
            {flightState === 'requesting' && (
              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">Waking up the sky…</p>
            )}
            {flightState === 'denied' && (
              <p className="mb-6 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
                Camera access was blocked. Allow camera permissions in your browser and try again.
              </p>
            )}
            {flightState === 'unsupported' && (
              <p className="mb-6 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
                This browser does not support webcam access, so hand tracking cannot run here.
              </p>
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

            <h1 className="mb-2 text-2xl font-semibold text-foreground">Calibrate Your Controls</h1>

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

            <div className="mb-4 overflow-hidden rounded-2xl border border-border/60 bg-muted/40 shadow-inner">
              <canvas
                ref={calibrationPreviewCanvasRef}
                width={CALIBRATION_PREVIEW_WIDTH}
                height={CALIBRATION_PREVIEW_HEIGHT}
                className="block w-full scale-x-[-1]"
              />
            </div>
            <p className="mb-5 text-xs font-medium tracking-wide text-muted-foreground">
              {handDetected
                ? `${controlMode === 'finger' ? 'Finger' : 'Hand'} detected — hold it at the target position.`
                : `Show your ${controlMode === 'finger' ? 'finger' : 'hand'} to the camera.`}
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
