import { useCallback, useEffect, useRef, useState } from 'react';
import { HAND_CONNECTIONS, type NormalizedLandmark } from '@mediapipe/hands';
import { GameEngine } from '@/game/GameEngine';
import { HandTracker, type HandControlState } from '@/game/handControls';

type FlightState = 'idle' | 'requesting' | 'flying' | 'denied' | 'unsupported';

const PREVIEW_WIDTH = 176;
const PREVIEW_HEIGHT = 132;

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

function App() {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

  const [flightState, setFlightState] = useState<FlightState>('idle');
  const [handDetected, setHandDetected] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [flipping, setFlipping] = useState(false);

  const stopEverything = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    engineRef.current?.dispose();
    engineRef.current = null;
    if (previewRafRef.current !== null) cancelAnimationFrame(previewRafRef.current);
    previewRafRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => stopEverything, [stopEverything]);

  const handleEnableFlight = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setFlightState('unsupported');
      return;
    }

    setFlightState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, facingMode: 'user' },
        audio: false,
      });

      const video = videoRef.current;
      if (!video || !canvasContainerRef.current) throw new Error('Missing video/canvas target');
      video.srcObject = stream;
      await video.play();

      const engine = new GameEngine(canvasContainerRef.current);
      engineRef.current = engine;
      await engine.start();

      const tracker = new HandTracker(
        video,
        (state: HandControlState) => {
          engine.applyControls(state);
          latestLandmarksRef.current = state.landmarks;
          setHandDetected(state.handDetected);
          setBoosting(state.boost);
          if (state.flipTriggered) setFlipping(true);
        },
        () => setFlightState('denied'),
      );
      trackerRef.current = tracker;
      await tracker.start();

      const previewCtx = previewCanvasRef.current?.getContext('2d') ?? null;
      const drawPreview = () => {
        if (previewCtx && video.readyState >= 2) {
          drawHandPreview(previewCtx, video, latestLandmarksRef.current);
        }
        previewRafRef.current = requestAnimationFrame(drawPreview);
      };
      drawPreview();

      setFlightState('flying');
    } catch (error) {
      console.error('Failed to start flight', error);
      setFlightState('denied');
    }
  }, []);

  useEffect(() => {
    if (!flipping) return;
    const timeout = window.setTimeout(() => setFlipping(false), 850);
    return () => window.clearTimeout(timeout);
  }, [flipping]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <div ref={canvasContainerRef} className="absolute inset-0" />

      {flightState === 'flying' && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 text-center">
            <p className="rounded-full bg-card/70 px-5 py-2 text-sm font-medium tracking-wide text-foreground/80 shadow-sm backdrop-blur-sm">
              {handDetected ? 'Tilt your palm to glide' : 'Show your hand to the camera to steer'}
            </p>
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
                flipping ? 'bg-secondary text-secondary-foreground opacity-100' : 'bg-card/60 text-foreground/50 opacity-70'
              }`}
            >
              Barrel Roll
            </span>
          </div>

          <div className="absolute bottom-6 right-6 overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-lg backdrop-blur-sm">
            <canvas
              ref={previewCanvasRef}
              width={PREVIEW_WIDTH}
              height={PREVIEW_HEIGHT}
              className="block scale-x-[-1]"
            />
          </div>
        </>
      )}

      <video ref={videoRef} className="hidden" muted playsInline />

      {flightState !== 'flying' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#cfe8f0] via-[#e9ecd6] to-[#fbe3c9] px-6">
          <div className="w-full max-w-md rounded-3xl border border-border/50 bg-card/85 p-8 text-center shadow-xl backdrop-blur-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              A quiet little sky
            </p>
            <h1 className="mb-3 text-3xl font-semibold text-foreground">Bird Flight</h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Glide over endless rolling hills using nothing but your hand. Tilt your palm to
              steer, close it into a fist to catch a gust of speed, and flick your wrist for a
              lazy barrel roll.
            </p>

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
              {flightState === 'requesting' ? 'Waking up the sky…' : 'Enable Camera & Fly'}
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
