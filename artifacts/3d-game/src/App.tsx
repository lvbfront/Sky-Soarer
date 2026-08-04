import { useCallback, useEffect, useRef, useState } from 'react';
import { HAND_CONNECTIONS, type NormalizedLandmark } from '@mediapipe/hands';
import { Hand, MoveHorizontal, MoveVertical, Zap, X } from 'lucide-react';
import { GameEngine, MAP_OPTIONS, WEATHER_OPTIONS, type MapType, type WeatherPreset } from '@/game/GameEngine';
import { BIRD_OPTIONS, type BirdType } from '@/game/bird';
import { HandTracker, type HandControlState } from '@/game/handControls';
import { getBestScore, saveBestScoreIfHigher } from '@/game/highscore';

type FlightState = 'idle' | 'requesting' | 'flying' | 'denied' | 'unsupported';

const PREVIEW_WIDTH = 176;
const PREVIEW_HEIGHT = 132;

const GESTURE_GUIDE = [
  {
    icon: Hand,
    title: 'Open hand, centered',
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
] as const;

function drawHandPreview(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[] | null,
) {
  ctx.save();
  ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

  if (landmarks) {
    ctx.strokeStyle = 'rgba(255, 214, 165, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [start, end] of HAND_CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      ctx.moveTo(a.x * PREVIEW_WIDTH, a.y * PREVIEW_HEIGHT);
      ctx.lineTo(b.x * PREVIEW_WIDTH, b.y * PREVIEW_HEIGHT);
    }
    ctx.stroke();

    ctx.fillStyle = '#ff8a5c';
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * PREVIEW_WIDTH, point.y * PREVIEW_HEIGHT, 2.6, 0, Math.PI * 2);
      ctx.fill();
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
}) {
  if (!state.handDetected) return 'Status: No Hand Detected';
  if (state.boost) return 'Status: Fist (Boost) Active';
  if (state.barrelRolling) return 'Status: Barrel Roll Detected';
  if (state.roll > 0) return 'Status: Steering Right';
  if (state.roll < 0) return 'Status: Steering Left';
  if (state.pitch > 0) return 'Status: Pitching Up';
  if (state.pitch < 0) return 'Status: Pitching Down';
  return 'Status: Flying Straight';
}

function App() {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const barrelRollingRef = useRef(false);

  const [flightState, setFlightState] = useState<FlightState>('idle');
  const [handDetected, setHandDetected] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [barrelRolling, setBarrelRolling] = useState(false);
  const [statusText, setStatusText] = useState('Status: No Hand Detected');

  const [selectedBird, setSelectedBird] = useState<BirdType>('pigeon');
  const [selectedMap, setSelectedMap] = useState<MapType>('mountain');
  const [selectedWeather, setSelectedWeather] = useState<WeatherPreset>('sunny');
  const [ringChallengeEnabled, setRingChallengeEnabled] = useState(false);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);

  useEffect(() => {
    setBestScore(getBestScore());
  }, []);

  useEffect(() => {
    barrelRollingRef.current = barrelRolling;
  }, [barrelRolling]);

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
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  const handleEnableFlight = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setFlightState('unsupported');
      return;
    }

    setFlightState('requesting');
    setScore(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      });

      const video = videoRef.current;
      if (!video || !canvasContainerRef.current) throw new Error('Missing video/canvas target');
      video.srcObject = stream;
      await video.play();

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
      });
      engineRef.current = engine;
      await engine.start();

      const tracker = new HandTracker(
        video,
        (state: HandControlState) => {
          engine.applyControls(state);
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
            }),
          );
        },
        () => setFlightState('denied'),
      );
      trackerRef.current = tracker;
      await tracker.start();

      // Mounting the preview canvas happens once flightState flips to 'flying' (below); the
      // draw-loop effect keyed on flightState picks it up as soon as it's in the DOM.
      setFlightState('flying');
    } catch (error) {
      console.error('Failed to start flight', error);
      setFlightState('denied');
    }
  }, [selectedBird, selectedMap, selectedWeather, ringChallengeEnabled]);

  // Starts the webcam-preview draw loop only once the preview canvas is actually mounted
  // (flightState === 'flying'), instead of grabbing the ref before React has rendered it.
  useEffect(() => {
    if (flightState !== 'flying') return;
    const video = videoRef.current;
    const previewCtx = previewCanvasRef.current?.getContext('2d') ?? null;
    if (!video || !previewCtx) return;

    let rafId: number;
    const drawPreview = () => {
      if (video.readyState >= 2) {
        drawHandPreview(previewCtx, video, latestLandmarksRef.current);
      }
      rafId = requestAnimationFrame(drawPreview);
    };
    rafId = requestAnimationFrame(drawPreview);
    previewRafRef.current = rafId;

    return () => cancelAnimationFrame(rafId);
  }, [flightState]);

  useEffect(() => {
    if (!barrelRolling) return;
    const timeout = window.setTimeout(() => setBarrelRolling(false), 850);
    return () => window.clearTimeout(timeout);
  }, [barrelRolling]);

  const handleStopFlight = useCallback(() => {
    stopEverything();
    setFlightState('idle');
    setHandDetected(false);
    setBoosting(false);
    setBarrelRolling(false);
    setStatusText('Status: No Hand Detected');
  }, [stopEverything]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <div ref={canvasContainerRef} className="absolute inset-0" />

      {flightState === 'flying' && (
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
          </div>

          <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1.5">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-lg backdrop-blur-sm">
              <canvas
                ref={previewCanvasRef}
                width={PREVIEW_WIDTH}
                height={PREVIEW_HEIGHT}
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

      {flightState !== 'flying' && (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#cfe8f0] via-[#e9ecd6] to-[#fbe3c9] px-6 py-10">
          <div className="w-full max-w-md rounded-3xl border border-border/50 bg-card/90 p-8 text-center shadow-xl backdrop-blur-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              A quiet little sky
            </p>
            <h1 className="mb-3 text-3xl font-semibold text-foreground">Bird Flight</h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Glide over endless landscapes using nothing but your hand. Here's how the controls
              work:
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

            {flightState === 'denied' && (
              <p className="mb-4 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
                Camera access was blocked. Allow camera permissions in your browser and try again.
              </p>
            )}
            {flightState === 'unsupported' && (
              <p className="mb-4 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">
                This browser does not support webcam access, so hand tracking cannot run here.
              </p>
            )}

            <button
              type="button"
              onClick={handleEnableFlight}
              disabled={flightState === 'requesting'}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90 disabled:opacity-60"
            >
              {flightState === 'requesting' ? 'Waking up the sky…' : 'Got It, Start Flying!'}
            </button>

            <p className="mt-4 text-xs text-muted-foreground">
              Your camera feed stays on this page and is only used to read hand position.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
