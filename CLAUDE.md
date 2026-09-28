# CLAUDE.md — Sky Soarer ("Bird Flight")

Guidance for Claude Code (and humans) working in this repository. The repo is named **Sky Soarer**. The landing page's hero title is **SKY SOARER**, the `<title>` is "Sky Soarer — Bird Flight", and the game still calls itself **Bird Flight** in `replit.md` and its storage keys. It was built on Replit with Replit Agent. It has since been cleaned into a standalone game repo that builds on any OS, deploys to Vercel as a static site, and still runs on Replit.

- `replit.md` is the original agent's running notes. It is kept unchanged as history, but **it is stale**: it describes template packages that have been deleted (api-server, db, mockup-sandbox), a port-5000 API server, and audio starting on "Continue". Where the two disagree, this file wins.
- `.agents/memory/*.md` holds lessons that agent recorded while fixing bugs. Read them before you touch the controls or tricks.

---

## 1. Project overview

Bird Flight is a relaxing, endless 3D flight game. You steer a low-poly bird **with your bare hand in front of a webcam** (MediaPipe Hands tracks it), or, in **Keyboard** mode, with WASD / the arrow keys. Both inputs produce the same `HandControlState`, so the engine never knows which one is driving. There is **no touch or gamepad input**; the mouse is only for menus and HUD buttons.

How a session plays:

1. **Landing page, "The Ascent" (Screen 1).** A scroll-driven page over a live 3D backdrop. Scrolling climbs the bird from the ground to above the clouds, and each full-viewport chapter is one setup step (see §6.10):
   - **0 · Hero (0 m):** the SKY SOARER title, tagline, a **Quick start** button that reuses the last saved settings and goes straight to pre-flight, and a "Scroll to ascend" hint.
   - **1 · Choose your bird (300 m):** Pigeon, Falcon, Greater Flamingo, or Duck/Seabird. Prev/next buttons, ←/→ keys, or the name chips.
   - **2 · Choose your world (1,200 m):** Mountain Valley, or Tropical Ocean & Islands. The 3D world switches live.
   - **3 · Choose the sky (3,000 m):** Sunny Morning, Sunset Gold, or Starry Night. Sky and lighting crossfade live.
   - **4 · Above the clouds (5,000 m):** a summary of the choices, the **Input** switch (**Hand (webcam)** or **Keyboard**), the Ring Challenge switch (with best score), a controls briefing for the chosen input, and **Begin pre-flight**, which saves the settings (input included) and starts the pre-flight for that input.

   Fixed instrument chrome: an altimeter rail (clickable chapter ticks), telemetry (speed, heading, V/S, lat/lon), a big altitude counter, and a **Sound** toggle for ambient wind (off by default).
2. **Pre-flight 01: boot sequence.** A full-screen HUD over the frozen backdrop types monospace status lines that follow the **real** startup events (see §6.11). In hand mode there are three:
   - `CAMERA [REQUESTING → ONLINE · 480×360]`
   - `HAND TRACKING MODEL [STANDBY → LOADING xx% → WARMING UP → READY]`, where the percentage is measured from the actual MediaPipe downloads
   - `CALIBRATION [PENDING]`

   A failure shows inline under the failing line (`DENIED`, `NOT FOUND`, `BUSY`, `FAILED`, `TIMEOUT`, …) with the message, the raw detail, and **Try Again** (or **Reload page** when a code chunk failed to import, see §6.12). **Back** is always available.

   **Keyboard mode** skips the camera, MediaPipe and calibration entirely. Its boot shows only `CONTROLS [KEYBOARD]` and `FLIGHT ENGINE [LOADING → READY]` (the real engine chunk import), then goes straight to the takeoff transition.
3. **Pre-flight 02: calibration, as an instrument panel** (hand mode only).
   - Steering always tracks the **palm center**. An Index Finger mode existed earlier and was removed.
   - The camera preview is framed as a sensor feed (LIVE marker, resolution, scanlines, corner brackets, HAND LOCK / NO SIGNAL).
   - Capture 5 points: the neutral center, then the top-left, top-right, bottom-left and bottom-right corners of your comfortable range. Each is drawn as a target reticle. The step being captured also shows a pulsing ghost reticle at a suggested spot, and a checklist shows each step as LOCKED / ACQUIRE / STANDBY.
   - Once a corner is captured you can drag its reticle on the feed to fine-tune it.
   - Set steering sensitivity from 0.5x to 2.0x on a styled slider.
   - **Start Flying** stays disabled until all 5 points are captured. It plays a short GSAP **takeoff transition** into flight.
   - **"How to fly" guide.** Before takeoff (after Start Flying, or after the keyboard boot), the guide opens by itself until the player ticks **Don't show again**, stored per input mode. It has one card per move, each with a looping procedural SVG/CSS illustration and one precise tip whose numbers come from the real thresholds (§6.12). **Take off** continues; **Back** returns to calibration (hand) or the landing (keyboard).
4. **Flight.**
   - Move your palm inside the calibrated box to pitch and roll (keyboard: W/↑ climb, S/↓ dive, A/← and D/→ bank, with a smooth ramp). Roll banks the bird, and banking turns it.
   - **Close a fist** (keyboard: hold **Space**) to boost. Boosting also fires an automatic 0.8 s barrel roll.
   - **Flick your hand up fast** (keyboard: **F**) for a 0.9 s backflip. An upward flick that was too slow or too short shows a brief coaching hint, "Flick faster ↑" or "Flick higher ↑".
   - Both tricks are cosmetic only. They never change heading or momentum.
   - **Esc** or the HUD's **Pause** button opens the pause menu (**Resume / How to fly / Back to landing**), and the game loop freezes. The HUD's **?** button (or the `?` key) opens the guide mid-flight, paused. Switching tabs pauses too.
   - On the ocean map you can dive under open water into a reef world with fish, a shark, caustics and bubbles. Surfacing sprays a water burst.
   - In Ring Challenge, fly through glowing rings to score. The **next ring** (the earliest-spawned ring still ahead that you haven't collected or missed) glows in a highlight color picked for the map + sky, a floating arrow in the same color points at it, and the HUD shows its distance (`NEXT RING 84 m`). The best score is saved in `localStorage`.
   - The HUD (§6.11) shows a heading tape, speed and altitude readouts, the ring score, best and next-ring distance, Boost/Barrel Roll/Backflip/Diving annunciator badges, a boost HUD effect (edge speed streaks and tightening frame brackets), a small mirrored sensor feed with the hand skeleton (keyboard mode: a live pitch/roll input indicator instead), a status line, and **?**, **Pause** and **Stop Game** buttons.

There is no win or lose state, no timer, and no collision damage. Terrain acts only as an altitude floor.

---

## 2. Tech stack (versions from the lockfile as installed)

| Area | Library | Version |
|---|---|---|
| Monorepo | pnpm workspace with a single package, `artifacts/3d-game` | pnpm **10.33.0**, pinned in `packageManager` (lockfile v9). `minimumReleaseAge: 1440` needs pnpm 10.16+. |
| Language | TypeScript | ~5.9.3 |
| Runtime | Node | `engines: >=20.19` (Vite 7's minimum). Replit uses `nodejs-24`, and Node 22.22 is verified. |
| Bundler / dev server | Vite | ^7.3.2 (7.3.6 resolved) |
| UI | React / React DOM | 19.1.0 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) with `tw-animate-css` and `@tailwindcss/typography` imported in `index.css` | ^4.1.14 (4.3.3 resolved) |
| Icons | lucide-react | ^0.545.0 |
| 3D | three (vanilla, **no** React Three Fiber) | ^0.185.1 (`@types/three` ^0.185.3) |
| Hand tracking | `@mediapipe/hands` (legacy "Solutions" API), assets self-hosted | **0.4.1675469240**, pinned exactly; this `package.json` entry is the only place the version lives |
| Landing animation | GSAP + ScrollTrigger (`gsap` package, plugins are free) | ^3.15.0 |
| Noise | simplex-noise (v4 `createNoise2D`) | ^4.0.3 |
| Audio | Web Audio API, fully synthesized (no audio files) | — |
| Replit-only dev plugins | `@replit/vite-plugin-runtime-error-modal`, `-cartographer`, `-dev-banner` | loaded only when `REPL_ID` is set |

- Runtime libraries are listed in `dependencies`, and build tooling in `devDependencies`, in `artifacts/3d-game/package.json`.
- Shared versions come from the `catalog:` block in `pnpm-workspace.yaml`.
- The only root devDependencies are `typescript` and `prettier`.

---

## 3. Running locally

### Commands (run from the repo root; no env vars needed)

```bash
pnpm install --frozen-lockfile   # ~2 s warm; the root preinstall script refuses npm/yarn
pnpm dev                         # Vite dev server  -> http://localhost:5173/
pnpm run typecheck               # tsc --noEmit for the game
pnpm run build                   # typecheck, then vite build -> artifacts/3d-game/dist/public
pnpm preview                     # serve the production build -> http://localhost:4173/
```

These are aliases for `pnpm --filter @workspace/3d-game run dev|build|serve|typecheck`. Both servers bind `0.0.0.0`. The dev server uses `strictPort`.

Results of a verification run (Linux x64, Node 22.22.2, pnpm 10.33.0, no `PORT`/`BASE_PATH`/`REPL_ID` set):

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm run typecheck` passes.
- `pnpm run build` succeeds from the root. It emits a 1.9 kB `index.html`, 49 kB of CSS, a 930 kB entry chunk (269 kB gzip: React, three, GSAP, the landing and the pre-flight/HUD UI), two lazy chunks (`handControls` 52 kB with the MediaPipe JS and the download meter, `GameEngine` 33 kB), and about 24 MB of MediaPipe files under `mediapipe/hands/`. Vite prints its "chunk larger than 500 kB" warning.
- The Vercel commands (`npx --yes pnpm@10.33.0 install --frozen-lockfile` and `… run build`) also succeed in a shell with **no global pnpm**. The nested `pnpm` calls in the root scripts resolve to the npx-provided pnpm.
- The dev server starts on 5173 with defaults. It also starts with Replit's env (`PORT=24982 BASE_PATH=/ REPL_ID=…`), and then the Replit plugins load.
- Headless Chromium with a fake camera, and **every non-localhost request blocked**, reached the calibration screen on the production preview. The landing redesign PR re-ran this with SwiftShader WebGL: every chapter, live bird/world/sky switching, snapping, reduced motion, Quick start, Back, and the error screen. It also confirmed that no `handControls`/MediaPipe/`GameEngine` request happens before **Begin pre-flight**. Deep links such as `/some/route` return `index.html`. The startup error paths were also exercised in headless runs; see the P0 PR's test notes.
- The pre-flight/HUD restyle PR re-ran this headlessly (SwiftShader, fake camera; see §11 for the harness):
  - The production build, with the network throttled to 2 MB/s and the **real** MediaPipe files, showed `LOADING` climbing 00% → 99% in small steps, then READY, then calibration. `WebAssembly.instantiateStreaming` still worked through the fetch wrapper, and `fetch`/`XMLHttpRequest.prototype.open` were native again afterwards.
  - A denied camera and an aborted `.tflite` download each produced the inline error. Try Again recovered from the denied camera.
  - With a stubbed detector, it covered all 5 captures, a corner drag, the takeoff veil, the HUD (cruise, boost, hand lost, a collected ring), and Stop Game. Back during the READY hold never opened calibration, and Stop Game during the takeoff reveal left no veil behind. A second session ran with only one WebGL context. Reduced motion was checked too, all with no console errors.
- The keyboard/pause/guide PR re-ran this headlessly (SwiftShader, ~5 FPS; harness notes in §11), with 60+ scripted checks, all passing:
  - Keyboard mode, dev server: every key flew as intended (turn, level-out, climb, boost, barrel roll, backflip with an unchanged heading), plus ring collection by an autopilot pressing real keys, and diving and surfacing on the ocean map.
  - Pause: the loop is frozen, keys are ignored, and the guide is reachable from the pause menu and from `?`.
  - Three sessions in one page with one WebGL context each; "Don't show again" and Quick start were checked too.
  - The engine-chunk failure path, reduced motion, and Esc during the takeoff reveal.
  - The production preview confirmed keyboard mode never requests `handControls` or MediaPipe.
  - Hand mode with a stubbed detector: the auto guide over calibration, "Flick higher" / "Flick faster" hints, a real flick firing a backflip with no hint, and flicks ignored while paused.
  - The near-miss detector was also checked deterministically: the real `HandTracker` bundled with esbuild and fed synthetic 15/30/60 fps palm tracks.
- The lockfile now includes native binaries for every OS and CPU (esbuild, rollup, lightningcss, the tailwind oxide engine). Actual installs on macOS or Windows haven't been tested yet.

### Environment variables (all optional)

| Var | Default | Notes |
|---|---|---|
| `PORT` | 5173 for dev, 4173 for preview | Replit sets 24982 through `artifact.toml`. An invalid value throws. |
| `BASE_PATH` | `/` | Becomes Vite `base`. Set it only when serving from a sub-path. |
| `REPL_ID` | unset | Set automatically inside a Repl. When set, it loads `runtime-error-modal`, plus `cartographer` and `dev-banner` in non-production builds. |

The game needs **no secrets, no backend and no database**.

### Browser, webcam and network requirements

- A **secure context** (`https://` or `http://localhost`), because `getUserMedia` refuses plain-HTTP LAN IPs. Vercel deployments are HTTPS.
- A webcam. The app requests 480×360 with `facingMode: 'user'`.
- **WebGL.** WebGL2 is preferred, since three r185 targets it.
- **No third-party network access is needed at runtime.**
  - The MediaPipe wasm, packed graph `.data` and `.tflite` files are **self-hosted**. `vite-plugin-mediapipe-assets.ts` serves them from `node_modules/@mediapipe/hands` in dev and emits them into `dist/public/mediapipe/hands/` at build time. `locateFile` in `handControls.ts` points at `${BASE_URL}mediapipe/hands/`.
  - This adds about 24 MB to the deploy. A session downloads about 13 MB: `hands_solution_simd_wasm_bin.wasm` (6 MB), `hands_solution_packed_assets.data` (4.3 MB) and `hand_landmark_lite.tflite` (2 MB). The non-SIMD wasm and the `full` model are shipped as fallbacks and are only fetched if needed.
  - Google Fonts (Inter, Instrument Serif for display type, JetBrains Mono for HUD readouts) is the only external request, and the UI falls back to system fonts without it.
  - If the files can't load, or the load (including the first frame through the graph) takes more than **30 s**, the startup screen shows a specific error with **Try Again**.
- A desktop Chromium, Edge or Firefox with a decent GPU is the target. Mobile isn't designed for: there's no touch fallback, and the layout assumes a large screen.
- In headless screenshot tools, WebGL often fails with no GPU. Launch Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` to render, and expect very low FPS.

### Deploying

- **Vercel:** `vercel.json` at the repo root holds everything:
  - the framework preset is set to "Other" (`"framework": null`)
  - install and build use a pinned pnpm through `npx`
  - `outputDirectory` is `artifacts/3d-game/dist/public`
  - there's an SPA rewrite to `/index.html`; Vercel serves real files first, so assets are unaffected

  Leave the project's Root Directory as the repo root.
- **Replit:** `.replit` plus `artifacts/3d-game/.replit-artifact/artifact.toml` handle dev on port 24982 and a static production deploy from the same `dist/public`.
- **Any other static host:** run `pnpm run build`, publish `artifacts/3d-game/dist/public`, and add a catch-all rewrite to `/index.html`. The rewrite is optional, because there's no client router.

---

## 4. Repository map

```
.
├── artifacts/
│   └── 3d-game/               # ★ THE GAME (@workspace/3d-game) — the only workspace package
│       ├── .replit-artifact/artifact.toml   # Replit service config (port 24982, static deploy, SPA rewrite)
│       ├── index.html         # <title>Bird Flight</title>, meta/OG description, Google Fonts Inter, favicon
│       ├── vite.config.ts     # PORT/BASE_PATH defaults; Replit plugins only when REPL_ID is set; @ -> src
│       ├── vite-plugin-mediapipe-assets.ts # serves/emits the MediaPipe runtime files under mediapipe/hands/, plus the
│       │                                   #   `virtual:mediapipe-hands-assets` file-size manifest (typed in src/mediapipe-assets.d.ts)
│       ├── public/            # favicon.svg, robots.txt (copied as-is into dist/public)
│       └── src/
│           ├── main.tsx       # createRoot(<App/>)
│           ├── App.tsx        # ★ state machine, startup/teardown, lazy loaders, boot status, takeoff transition, preview rAF
│           ├── index.css      # Tailwind v4 + theme tokens; `ascent-*` utilities (glass, HUD type, grain, blip, range, boost streaks)
│           ├── preflight/     # pre-flight screens (presentational; App owns the state)
│           │   ├── BootSequence.tsx     # 01: typed boot-status HUD, inline errors + Try Again, T+ clock
│           │   ├── CalibrationPanel.tsx # 02: sensor feed frame, step checklist, capture/reset, sensitivity slider, Start Flying
│           │   └── handPreview.ts       # CALIBRATION_STEPS, calibration types, drawHandPreview (reticles, box, ghost target)
│           ├── flight/
│           │   ├── FlightHud.tsx  # in-flight HUD: heading tape, SPD/ALT, score, badges, boost effect, sensor feed or
│           │   │                  #   keyboard input indicator, near-miss flick hint, ? / Pause / Stop buttons
│           │   ├── PauseMenu.tsx  # pause menu: Resume / How to fly / Back to landing
│           │   ├── FlightGuide.tsx # "How to fly" guide: per-move cards for hand or keyboard, tips built from real constants
│           │   └── guideArt.tsx   # procedural SVG hand illustrations + animated keycaps (CSS keyframes in index.css)
│           ├── ui/
│           │   └── hud.tsx        # CornerBrackets, Wordmark (shared instrument-frame pieces)
│           ├── landing/       # ★ the scroll-driven landing page ("The Ascent")
│           │   ├── Landing.tsx     # chapters, GSAP ScrollTrigger (scrub + snap), intro timeline, HUD, keys, sound toggle
│           │   └── content.ts      # chapter list, copy (bird personalities, world/sky details), formatters
│           └── game/          # ★ framework-free Three.js game code
│               ├── GameEngine.ts   # renderer, scene, loop, flight physics, camera, lighting/weather, underwater state machine
│               ├── LandingScene.ts # landing backdrop: scroll-progress-driven bird/camera/altitude, cloud deck, live swaps, dispose
│               ├── presets.ts      # MAP_OPTIONS, WEATHER_OPTIONS, WEATHER_LOOKS (shared by engine + landing); speeds and
│               │                   #   trick durations (shared by engine + guide); NEXT_RING_HIGHLIGHTS (engine + HUD)
│               ├── damping.ts      # damp(rate, dt): frame-rate independent smoothing factor
│               ├── sky.ts          # sky dome / starfield / horizon-cloud builders (shared by engine + landing)
│               ├── settings.ts     # localStorage last-used settings ("bird-flight-settings", incl. control mode), validated
│               │                   #   on read; guide "Don't show again" per mode ("bird-flight-guide-dismissed")
│               ├── trackingShared.ts # TrackingStartError, sensitivity bounds, flick/deadzone/fist thresholds (quoted by the
│               │                     #   guide), importable without loading MediaPipe
│               ├── handControls.ts # MediaPipe wrapper: load + frame loop, calibration box, fist/flick gestures, near-miss
│               │                   #   flick coaching (lazy-loaded)
│               ├── keyboardControls.ts # keyboard input → the same HandControlState (ramped axes, Space boost, F backflip)
│               ├── downloadMeter.ts # real download progress for MediaPipe's own fetch/XHR requests (used by handControls)
│               ├── bird.ts         # 4 procedural low-poly birds + wing flap
│               ├── terrain.ts      # Mountain Valley: streamed simplex-noise tiles
│               ├── ocean.ts        # Ocean: streamed tiles, hashed islands, animated water verts, foam band
│               ├── underwater.ts   # reef/fish/shark/caustics/bubbles (lazy-built)
│               ├── clouds.ts       # flyable cloud clusters in the flight corridor
│               ├── rings.ts        # Ring Challenge spawning, hit test, next-ring selection + highlight
│               ├── ringGuide.ts    # arrow pointing (smoothly) at the next ring
│               ├── ringBurst.ts    # star-burst particles (custom ShaderMaterial)
│               ├── waterBurst.ts   # surfacing droplet particles (copy of ringBurst, retuned)
│               ├── splash.ts       # skimming spray particles (PointsMaterial – fade is broken)
│               ├── audio.ts        # WindAudio (filtered noise) + SoundEffects (ring chime)
│               └── highscore.ts    # localStorage best score ("bird-flight-best-score")
├── attached_assets/           # the two feature-request prompts the user pasted into Replit Agent (history only)
├── .agents/memory/            # Replit Agent's lessons-learned notes (read these!)
├── .replit, .replitignore     # Replit workspace config
├── vercel.json                # Vercel static deploy config
├── package.json               # root scripts (dev/build/preview/typecheck), packageManager pnpm@10.33.0
├── pnpm-workspace.yaml        # workspace glob, version catalog, minimumReleaseAge, security overrides
├── pnpm-lock.yaml
├── tsconfig.base.json         # shared strict-ish TS options (strictFunctionTypes: false, noUnusedLocals: false)
└── replit.md                  # original agent notes (kept as is; partly stale)
```

The game still sits in the `artifacts/3d-game` pnpm-workspace layout. Replit's `PNPM_WORKSPACE` agent stack and its artifact system expect that layout, so moving it would break Replit.

---

## 5. Architecture and data flow

```
 getUserMedia (App) ──► <video hidden> ──► HandTracker rAF loop ──► Hands.send()  (self-hosted wasm + model)
                                                                 │ onResults
                                                                 ▼
                                   HandTracker.handleResults()  → HandControlState
                                   {handDetected, pitch, roll, boost, backflip, flickNearMiss, landmarks}
            (keyboard mode: KeyboardControls rAF → the same HandControlState; handDetected always true)
                                                                 │ handleControlState (one stable callback in App)
            ┌────────────────────────────────────────────────────┼────────────────────────────┐
            ▼                                                    ▼                            ▼
 engineRef.current?.applyControls(state)     latestLandmarksRef / latestControlRef   setHandDetected / setBoosting /
 (no-op until "Start Flying", ignored        (read by the preview canvas rAF and     setStatusText / setFlickHint
  while paused)                               the HUD's keyboard input indicator)    → React re-render
            │
            ▼
 GameEngine (own rAF loop): update(dt) → renderer.render(scene, camera)
            │ callbacks
            └─► onScoreChange / onBarrelRoll / onBackflip / onWaterTransition → React state → HUD badges & CSS overlays
```

- **React owns only the UI chrome.** `GameEngine` is a plain class that is mounted into a `div` ref, and it owns the `WebGLRenderer` and its own `requestAnimationFrame` loop. This is deliberate, so React re-renders never affect frame timing.
- **Top-level state** is a string union in `App.tsx`: `FlightState = 'landing' | 'requesting' | 'calibrating' | 'flying' | 'error'`. When the state is `'error'`, `startupError: { kind, detail, phase, needsReload }` picks the message. The control mode is `settings.controls` (`'hand' | 'keyboard'`). Overlays are `guide: GuideOrigin | null` (`'preflight' | 'pause' | 'hud'`) and `pauseOpen`; in flight, either one makes `paused` true. Everything else is local `useState` plus refs. There is no store, context or router.
- **Code splitting.** `handControls` (and with it the `@mediapipe/hands` JS) and `GameEngine` are loaded with dynamic `import()` through `loadHandTracking()` / `loadGameEngine()` in `App.tsx`. Both start when pre-flight begins. App code only imports *types* from those modules; runtime values it needs early live in `trackingShared.ts` and `presets.ts`. A failed import clears its cached promise so **Try Again** retries it, and a failed tracking import surfaces as `TrackingStartError('load-failed')`.
- **Startup dispatch.** `beginPreflight()` (from **Begin pre-flight** or **Quick start**) saves the settings, writes them into `settingsRef` right away (the async flows read it before React re-renders), and calls `startPreflight()`. That runs `startKeyboardPreflight` or `handleContinueToCalibration` for the chosen mode, and is also the boot HUD's **Try Again**.
- **Keyboard startup** (`startKeyboardPreflight`): take a session id, set `boot` to the keyboard lines, and await `loadGameEngine()` (FLIGHT ENGINE LOADING → READY, or `engine-load-failed` with `needsReload`). Then apply the same capped `BOOT_MIN_DURATION_MS`/`BOOT_READY_HOLD_MS` hold, set `boot.done` (freezing the T+ clock), and call `requestTakeoff()`. No camera, `isSecureContext` check or MediaPipe.
- **Hand startup sequence** (`handleContinueToCalibration`):
  1. Check `isSecureContext` and that `getUserMedia` exists.
  2. Kick off `loadHandTracking()` and prefetch `loadGameEngine()`.
  3. Call `getUserMedia` (the **only** camera stream; `@mediapipe/camera_utils` was removed because it opened a second stream).
  4. Call `video.play()`, then await the tracking module.
  5. Construct `new HandTracker(video, onUpdate)` and register it in `trackerRef`.
  6. `await tracker.start(onProgress)` loads the files, runs a warm-up frame, and starts the loop. `onProgress` reports the real download fraction.
  7. Hold for `max(BOOT_READY_HOLD_MS 550, BOOT_MIN_DURATION_MS 1100 − elapsed)`, then switch to `'calibrating'`. The minimum is 0 under reduced motion. This hold is the only added time in the whole boot: it lets the typed lines finish and READY register, and adds at most ~1.1 s.

  Each step also updates `boot: BootStatus` (camera, resolution, model state and percent, calibration, `startedAt`). `buildBootLines()` turns that plus any error into the boot HUD's lines. A local `phase` (`camera` until the video plays, then `model`) is recorded on the error as `StartupError.phase`, and picks the line the error is reported under. The engine-chunk failure in `handleStartFlying` uses phase `engine`, which adds a `FLIGHT ENGINE [FAILED]` line.

  Any failure goes through `classifyStartupError()`:

  | Cause | Error kind |
  |---|---|
  | `NotAllowedError` / `SecurityError` | `permission-denied` |
  | `NotFoundError` / `OverconstrainedError` | `no-camera` |
  | `NotReadableError` / `AbortError` | `camera-in-use` |
  | `NotSupportedError` | `unsupported` |
  | `TrackingStartError` | `tracking-load-failed` / `tracking-timeout` |
  | anything else | `unknown` |
  | (engine chunk import failed, set directly in `handleStartFlying`) | `engine-load-failed` |

  Each kind has its own text in `STARTUP_ERROR_MESSAGES`. `needsReload` is set when a code chunk import failed (the engine, or the tracking module while `chunkImport` is true). Chromium caches a failed dynamic `import()` for the page's lifetime, so retrying in place can't work, and the boot HUD's button becomes **Reload page**.
- **Takeoff request.** Start Flying and the end of the keyboard boot both call `requestTakeoff()`. It opens the guide (`guide = 'preflight'`) if `shouldAutoShowGuide(mode)`, otherwise calls `handleStartFlying()`. The guide's **Take off** stores "Don't show again" if ticked, then calls `handleStartFlying()`. `startKeyboardPreflight` reaches `requestTakeoff` through `requestTakeoffRef`, since it's created first. `handleStartFlying` reads the bird/map/weather/rings/controls from `settingsRef.current`, never from its closure (a Quick start may have changed them). In keyboard mode it creates and starts `KeyboardControls` once `engine.start()` resolves.
- **Pause.** An effect keyed on `paused` calls `engine.setPaused()` and `keyboard.setPaused()`, and clears any flick hint. One window `keydown` handler takes Esc: it closes the guide (in pre-flight, as its Back), or toggles the pause menu in flight. The same handler opens the guide on `?`. A `visibilitychange` to hidden opens the pause menu. While paused the HUD is `inert`, and so is the pre-flight screen behind the pre-flight guide.
- **Session ids guard async startup.** Each attempt takes `++sessionIdRef.current`, and `stopEverything()` also increments it. After every `await`, a superseded attempt (for example, the player pressed Back while the permission prompt was open) releases its own stream and tracker and returns without touching UI state.
- **One `HandTracker` per session.** It is created on the user click and reused through calibration and flight. Calibration state (center, box, sensitivity) lives **inside the tracker**. The engine only ever sees normalized `pitch`/`roll` in `-1..1`.
- **Engine options are fixed at construction.** Bird, map, weather and ring mode can't change mid-flight. Changing them means stopping and restarting.
- **Teardown.** `stopEverything()` bumps the session id, stops the tracker and the keyboard controls, disposes the engine, cancels the preview rAF, and stops the MediaStream tracks. Back and Stop Game both call it (`handleBackToMenu`, which also calls `resetTakeoff()` and turns the landing backdrop back on). `handleStartFlying` is guarded by `startingFlightRef`/`engineRef`, so a double click builds only one engine. It awaits the engine chunk **and** the takeoff launch animation together, checks the session id afterwards, and bails out if Back disposed the engine while `engine.start()` was awaiting. `resetTakeoff()` kills the takeoff timeline, hides the veil, and resolves the pending launch promise, so an interrupted launch never leaves `handleStartFlying` awaiting forever.
- **The landing backdrop (`LandingScene`)** is created by an effect in `App` while `landingBackdropOn` is true, and it stays alive behind the landing *and* the pre-flight screens (holding the "above the clouds" shot). In hand mode, while `flightState` is `'requesting'` (tracking loading) or `'calibrating'` it is **paused** (`setPaused(true)`): no update and no render, so it doesn't compete with MediaPipe on the main thread. Keyboard mode has no MediaPipe, so its short boot keeps the backdrop moving. Before freezing it cuts to the pre-flight shot and renders that one frame, which the canvas then holds. That matters for Quick start, which is pressed from the hero. It resumes on Back or on the error screen. `handleStartFlying` calls `disposeLandingScene()` **before** constructing `GameEngine`, so only one WebGL context is ever live. Returning from flight rebuilds it. If WebGL can't start, the constructor throws, the error is logged, and the page runs over the CSS sky gradient on `<html>`. App also keeps the backdrop's bird/world/sky in sync with `settings`, so a Quick start swap shows behind pre-flight.

---

## 6. How each system works

### 6.1 Rendering (`GameEngine.ts`)
- `WebGLRenderer({antialias, powerPreference:'high-performance'})`, with pixel ratio capped at 2, sRGB output, and shadow maps on.
- `PerspectiveCamera` with FOV 58, rising to 72 on boost (50 and 60 underwater), near 0.1, far 1200.
- **Sky.** An inverted sphere of radius 900 with vertex-color gradient from the `WEATHER_LOOKS` preset, plus 24 decorative cloud clusters. On Starry Night there's also a 900-point starfield that follows the bird on XZ. The sky sphere, the decorative cloud group (`skyClouds`) and the starfield all **follow the bird on XZ** every frame, so the world never flies out of the backdrop.
- **Fog.** `FogExp2`, density 0.0068 above water and 0.022 underwater.
- **Lights.** Hemisphere + ambient + a shadow-casting sun (1024² map, 180×180 frustum) that is **re-centered on the bird every frame**, plus an unshadowed fill light.
- **Weather.** `WEATHER_LOOKS` is one table holding sky colors, fog colors, and light colors and intensities. `enterUnderwaterLook()` and `exitUnderwaterLook()` swap between it and the fixed cyan underwater palette.
- **Screen effects.** The boost motion blur, the surfacing flash and the underwater tint are **CSS overlays in `App.tsx`**, not post-processing. There is no `EffectComposer`.

### 6.2 Flight physics and camera (`GameEngine.update`)
- `currentPitch` and `currentRoll` chase the tracker's targets with a per-frame lerp of 0.06, then scale by max angles of 38° pitch and 48° roll.
- **Steering and visual angles are separate.** Heading, the forward vector and movement use only `steeringPitchAngle`/`steeringRollAngle`. The mesh rotation uses `visual*Angle`, which adds the 360° trick sweep. **Never merge these.** See `.agents/memory/decouple-visual-sweep-from-physics.md`.
- **Turning.** `headingYaw -= steeringRoll * dt * 0.6`, and the heading is locked while a barrel roll is in progress.
- **Speed.**
  - Base speed is 9 and boost is 20. Underwater they're 5 and 10.
  - Speed lerps toward its target at 0.04 per frame, or 0.02 underwater.
  - Collecting a ring adds a +7 pulse that decays at 9/s.
- **Altitude.**
  - Over solid ground (mountains or islands) the floor is `height + 3.5`.
  - **Islands are solid underwater.** While submerged, a move that would enter an island's footprint (`!isOverWater`) slides along the edge: it keeps only the X or only the Z part of the move, or blocks the horizontal move entirely. Before this, the solid-ground floor snapped the bird up through the surface.
  - Over open water the only floor is `SEABED_FLOOR_Y = -15`.
  - The ceiling is y = 140.
  - The bird starts at (0, 26, 0) heading +Z.
- **Camera.** A chase camera 6.5 behind and 2.2 above the bird, looking 8 units ahead, with a per-frame lerp of 0.05 (0.03 underwater).
- **Hand loss.** On `handDetected: false`, `applyControls` first handles the backflip fallback. It then sets `targetPitch`/`targetRoll` to 0 and `boosting` to false, so the bird eases back to level cruise instead of latching the last input.
- **Timing.** `dt` is clamped to 0.05 s, so below 20 FPS the simulation runs in slow motion.
- **Pause.** `setPaused(true)` cancels the rAF loop, so there's no update and no render and the canvas holds the last frame. It also suspends the wind `AudioContext`, and `applyControls` returns early (input can't steer, boost or start a trick behind the menu). `setPaused(false)` discards the paused time with `clock.getDelta()` and restarts the loop. A resize while paused re-renders the held frame once. Before `start()` has finished, `setPaused` only records the flag, and `start()` honors it (so two loops are never scheduled).
- **Wing flaps.** Flap rate is mapped from speed onto 7–17, times 0.55 when gliding in a dive (pitch below -0.15 and not boosting), and uses a gentle paddle stroke underwater.

### 6.3 Hand tracking (`handControls.ts`)
- **MediaPipe options:**
  - `maxNumHands: 1`
  - `modelComplexity: 0`, the lite model
  - `selfieMode: false`, so mirroring is done manually
  - detection confidence 0.6, tracking confidence 0.5

- **Loading and frame loop.**
  - `locateFile` resolves to `${import.meta.env.BASE_URL}mediapipe/hands/<file>`. That path must match `PUBLIC_DIR` in `vite-plugin-mediapipe-assets.ts`.
  - `start(onProgress?)` runs `hands.initialize()` plus one warm-up `send()` (which fetches the model) under a 30 s `withTimeout`. A failure throws `TrackingStartError('load-failed' | 'timeout')`.
  - **Real load progress.** MediaPipe has no progress callback. It loads the wasm and the `.tflite` with `fetch()`, the packed `.data` with an XHR, and the loader scripts with `<script>` tags. While `start()` runs, `meterDownloads()` (`downloadMeter.ts`) wraps `window.fetch` and `XMLHttpRequest.prototype.open`, but only observes requests under `mediapipe/hands/`:
    - fetch: it reads a `clone()` of the response and hands the caller the original, untouched response (so `instantiateStreaming` keeps working)
    - XHR: it adds `progress`/`load` listeners with `addEventListener`, which leaves the loader's own `onprogress` alone

    The three big files are weighted by their byte sizes from the plugin's `virtual:mediapipe-hands-assets` manifest. The SIMD and plain wasm share one slot. An unfinished file never counts as more than 99%. The wrappers are removed in `start()`'s `finally` and in `stop()`.
  - The tracker then runs its **own rAF loop** on the video the app already started. It sends a frame only when `video.currentTime` has advanced, and `stop()` cancels the rAF.
  - The tracker never opens or stops the camera: `App` owns the `MediaStream`.
- **Frame pipeline** in `handleResults`:
  1. Compute the palm center, the mean of landmarks 0, 5, 9, 13 and 17.
  2. The palm center is the only tracked point. Finger mode was removed.
  3. Mirror X as `1 - x`, so the steering matches the mirrored "selfie" preview.
  4. Smooth with an EMA, α = 0.35 per frame.
  5. Map onto -1..1 **within the calibrated box** with `axisValue()`. Each side of the center uses its own asymmetric extent.
  6. Apply a normalized deadzone of 0.06, rescaled so there's no jump at its edge.
  7. Multiply by sensitivity (0.5–2.0) and clamp to ±1.
- **Box calibration.**
  - `captureNeutralCenter()` and `captureCorner()` snapshot the smoothed point.
  - `recomputeBox()` averages the two corners that share a side, so the left edge is the mean of `topLeft.x` and `bottomLeft.x`.
  - `setCorner()` sets a corner directly and backs the drag-to-fine-tune feature.
  - Default box: x 0.24–0.76, y 0.28–0.72.
- **Boost (fist).**
  - `fistRatio` is the mean fingertip-to-palm distance divided by the wrist-to-middle-MCP distance.
  - The fist closes below 0.62 and opens above 0.8, with 3 frames of hysteresis in each direction.
  - Hand loss resets `fistActive`, so boost can't come back latched when the hand reappears.
- **Backflip (upward flick).**
  - The thresholds (`FLICK_WINDOW_MS` 220, `FLICK_MIN_DISTANCE` 0.1, `FLICK_MIN_VELOCITY` 1.1, `BACKFLIP_COOLDOWN_MS` 1200) live in `trackingShared.ts` because the guide quotes them.
  - Keeps a 220 ms rolling history of the **raw**, unsmoothed Y.
  - It fires when the point has moved up more than 0.1 at more than 1.1 frame-heights/s, with a 1200 ms cooldown.
  - **The speed is measured from the oldest sample in the window**, so once the hand has been in view for a moment it is `rise / ~0.22 s`, not rise / (time the snap took). From a still hand, a backflip therefore needs the palm to rise **~24% of the frame height within 0.22 s** (`FLICK_STILL_HAND_DISTANCE`). The 0.1 minimum only decides right after the hand reappears. The guide says "at least a quarter of the frame, within 0.2 s".
  - It needs at least 2 samples inside 220 ms, so it can't fire if the tracker runs below ~4.5 FPS (a webcam runs at 30).
- **Near-miss coaching** (`trackStroke` / `finishStroke`):
  - Each upward stroke of the raw Y (from when it starts rising until it drops back 0.02 or makes no new high for 120 ms) is scored once, when it ends.
  - A stroke that fired no backflip, rose ≥ 0.06, and peaked ≥ 64% of the flick speed reports `flickNearMiss`:
    - `too-slow` ("Flick faster ↑") if it rose ≥ `FLICK_STILL_HAND_DISTANCE` in total
    - otherwise `too-short` ("Flick higher ↑")
  - Hints are rate-limited to one per 2.5 s and suppressed during the backflip cooldown. Steering (up to ~0.6 frame-heights/s) and jitter never trigger one.
  - App shows the hint for 1.8 s, only while flying and not paused.
  - **Fallback:** if the hand vanishes within 300 ms of a fast flick, the tracker emits `backflip: true` with `handDetected: false`. `GameEngine.applyControls` checks `backflip` **before** its `if (!handDetected) return` guard, so don't reorder these. See `.agents/memory/gesture-fallback-before-detection-guard.md`.
- **Robustness.**
  - A `stopped` flag guards `send()` after `stop()`, which avoids MediaPipe's "deleted object" wasm race.
  - Per-frame `send()` errors are logged and swallowed, never re-thrown.
- **Other inputs:** keyboard mode (§6.12) replaces the tracker entirely. There is no mouse, gamepad or touch steering. Pointer events are used only for dragging calibration corners and for buttons.

### 6.4 Calibration UI and webcam preview (`preflight/handPreview.ts`, `preflight/CalibrationPanel.tsx`, the preview rAF in `App.tsx`)
- `drawHandPreview()` draws the raw video frame and the raw landmarks, then CSS `scale-x-[-1]` mirrors the canvas.
- Stored calibration points are in mirrored space, so they are **un-mirrored when drawn** (`1 - p.x`).
- Pointer drag positions map 1:1 to stored points with **no** flip. The two mirrors cancel. See `.agents/memory/canvas-mirror-coordinate-overlay.md` and `mirrored-canvas-pointer-drag.md`.
- **Canvas text** (reticle labels such as `TL`) is drawn pre-flipped around its anchor (`drawMirroredLabel`), so it reads correctly after the CSS mirror.
- **The overlay** (calibration only), drawn in this order:
  1. an ink wash
  2. the box (dashed, faint fill)
  3. the current step's ghost reticle at `CalibrationStep.hint` (the tracker's default box corners, a suggestion only)
  4. captured corners as warm bracket reticles (the drag handles)
  5. the captured center as a cyan crosshair
  6. the live palm-center steering point, computed from the raw landmarks
- Sizes scale with canvas width, since they were tuned at 360 px.
- One preview rAF draws on whichever canvas is mounted: the 480×360 calibration sensor feed or the 176×132 HUD feed. It runs in a `useEffect` keyed on `flightState`, because refs are null until the conditional render commits. It reads the current step through `calibrationStepRef`.

### 6.5 Tricks
- **Barrel roll:**
  - Triggered on the rising edge of `boost` (the fist closing).
  - Adds 360° of visual roll over 0.8 s with `easeInOutCubic`.
  - The heading is frozen during the roll.
- **Backflip:**
  - Triggered by `state.backflip`.
  - Adds 360° of visual pitch over 0.9 s.
- The two tricks are mutually exclusive, and each is checked only when neither is active.
- The HUD badges are cleared by `setTimeout`s of 850 ms and 950 ms.

### 6.6 Environments
- **Mountain Valley** (`terrain.ts`):
  - 120-unit tiles with 20×20 segments, in a 7×7 grid around the bird (`VIEW_RADIUS 3`).
  - Height is two octaves of simplex noise × 16, with vertex colors banded by height.
  - Tiles are pooled and rebuilt only when the bird crosses a tile boundary.
  - The noise seed is random per session.
- **Tropical Ocean** (`ocean.ts`):
  - The same tiling, with 24 segments.
  - Water sits at y = 0, with a static noise ripple of ±0.18.
  - Islands are smoothstep domes on a 55-unit lattice, chosen by a deterministic `sin` hash with a 40% chance per cell.
  - Vertex colors band from deep water through shallow water, foam, sand and foliage.
  - `animateWater()` animates open-water vertices (base height ≤ 0.24) only in the 3×3 tiles nearest the bird, and recomputes normals every 4th frame.
  - `isOverWater()` decides whether the altitude floor or diving applies.
- **The shared map contract** is duck-typed rather than an interface or base class: `update(pos)` and `heightAtWorld(x, z)`. `OceanManager` adds `isOverWater` and `animateWater`.
- **Underwater** (`underwater.ts`):
  - **Lazy build.** Everything is built on the first `setActive(true)`.
  - **Reef.** Items are coral, flora, anemones and shells, pooled up to 32. They spawn ahead of the bird, and on every dive a full ring of them is seeded around it.
  - **Fish and shark.** Three fish schools of 6 lerp toward offsets from the bird. The shark follows a sine patrol around the bird.
  - **Light.** 7 additive vertical caustic planes and 12 caustic floor rings.
  - **Bubbles.** A 200-particle bubble stream.
  - **Entry and exit.** The switch happens when the bird's depth below `heightAtWorld` crosses ±0.4 (hysteresis).

### 6.7 Ring Challenge (`rings.ts`, `ringGuide.ts`, `ringBurst.ts`, `highscore.ts`)
- **Spawning.**
  - The first ring spawns immediately, 42 units dead ahead.
  - After that, one spawns every 2.1 s, 55–80 units ahead along the *current* forward vector.
  - When no ring is ahead (the bird turned away from all of them), one spawns at once; if all 6 slots are taken, the oldest ring (none of them is ahead) is recycled to make room.
  - Rings are offset laterally and vertically on a sine curve (phase +0.85 per ring).
  - Rings are clamped to at least 8 above the ground, with at most 6 active.
- **Hit test.** `ringFrame()` measures the bird in the ring's own frame (`axial` along the ring's normal, negative while short of the plane; `radial` from its axis). `isRingHit`: |axial| under 2.2 and radial under 3.4. `isRingPassed`: axial over 2.2, i.e. the bird crossed the plane outside the hoop; the ring is then flagged `missed` for good (it can still be collected by flying back through it, but is never targeted again).
- **Next ring** (`selectNextRing`, pure and unit-tested): the earliest-spawned ring (`active` is kept in spawn order) that isn't `missed` and whose center is no more than 3 units behind the bird along its **horizontal heading**. So collecting or missing the target moves it to the following ring, and after a sharp turn rings that fell behind are skipped (turning back makes an earlier ring ahead, and the target, again). Recomputed every frame after the hit/miss/despawn pass.
- **Highlight.** The target's torus and glow disc swap to their own materials in the `NEXT_RING_HIGHLIGHTS[map][weather]` color (one table in `presets.ts` for all 6 combinations: magenta, cyan, mint, violet or pink, chosen to contrast with that palette and with the gold of the other rings). Its emissive intensity breathes 1.0–1.7, its scale pulses ±7%, and a shared additive halo torus is re-parented onto it. Other rings keep the gold, dimmed (emissive 0.55, glow opacity 0.2).
- **Despawn.** A missed ring is recycled once it is 40 units *past* along its own normal (`axialDist > 40`; `delta` points from the ring to the bird), **or** once it is more than 120 units from the bird in any direction. The distance check covers turns and U-turns.
  - Before this fix the sign was inverted (`< -40`), so every ring spawned 42+ units ahead was recycled in the frame it spawned. Ring Challenge never showed a ring.
  - Clouds use the same two-part rule: past 60 axially, or more than 240 away. Reef items do too: past 42 axially, or more than 80 away horizontally.
- **On collect:**
  - score +1
  - a speed pulse
  - the chime
  - a star burst
  - `onScoreChange`, which calls `saveBestScoreIfHigher` on **every** ring
- `RingGuideArrow` floats above and ahead of the bird, in the highlight color, and turns toward `getNextRingPosition()` by slerping its quaternion (`damp(7, dt)`), so a retarget swings smoothly. It is modelled along local **+Z**: `Object3D.lookAt` (and `Matrix4.lookAt(target, eye, up)`, which it mirrors) turns a non-camera object's +Z toward the target. Before this, it was modelled along −Z and pointed *away* from the ring.
- **HUD readout.** `GameEngine.getNextRingDistance()` (straight-line, world units = meters) is written by the HUD's telemetry rAF under the ring score as `NEXT RING 84 m`, next to a marker in the highlight color; `—` when there's no target.

### 6.8 Audio (`audio.ts`)
- `WindAudio` plays 2 s of looping white noise through a lowpass filter and a gain node. Filter cutoff and gain follow a speed ratio that its own rAF feeds in with `setTargetAtTime`. It is muted underwater.
- `SoundEffects.playChime()` plays two sine tones, C6 then G6, with a quick attack and exponential decay.
- Two separate `AudioContext`s are created. The wind one starts in `engine.start()`, which runs from the **Start Flying** click and so satisfies the autoplay policy. `replit.md` says audio starts on "Continue", but that's outdated.

### 6.9 Particles
- **`ringBurst.ts` and `waterBurst.ts`:**
  - Near-identical classes.
  - Pooled `THREE.Points` with a custom `ShaderMaterial` that reads per-particle `aOpacity` and `aSize`, and a canvas-generated sprite texture.
  - Ignored by fog and not scaled by pixel ratio.
- **`splash.ts`:**
  - Skimming spray within 1.6 units of the water.
  - Uses `PointsMaterial`, which **ignores** its custom `opacity` attribute, so the particles never fade. This is a known, documented bug.

### 6.10 Landing page ("The Ascent": `landing/Landing.tsx`, `game/LandingScene.ts`)
- **Scene.** `LandingScene` is framework-free and follows the manager lifecycle (constructor → setters → `dispose()`). It reuses `Bird`, `TerrainManager`, `OceanManager`, `CloudManager` and the `sky.ts` builders, but **none of GameEngine's flight physics**. It never reads hand input, and GameEngine doesn't depend on it.
  - The bird flies along +Z at a fixed speed with a slow lateral weave. It banks into the weave, pitches with the climb, and never drops below `ground + 5.5` (looking a little ahead).
  - `SHOTS` holds one camera/altitude keyframe per chapter: bird altitude, displayed meters, camera and look offsets, a `shift` that frames the bird right of the text column, FOV, and extra yaw. Progress 0..1 interpolates neighbors with smootherstep. Camera X offsets are **positive** to put the bird on screen-right, because the camera looks along +Z, where screen-right is −X.
  - Progress, pointer and ground-floor smoothing all use frame-rate-independent `1 - exp(-k·dt)`. It uses `performance.now()`, not the deprecated `THREE.Clock`.
  - Each map lives in its own sub-`Scene` (`terrainRoot`/`oceanRoot`). The second map is built lazily the first time it's chosen, and a switch is hidden inside a short fog dip.
  - Weather crossfades blend a resolved `LookState` between two `WEATHER_LOOKS` presets over 1.4 s. The blend repaints the sky dome gradient and updates fog, lights, starfield and horizon-cloud opacity.
  - The **cloud deck** is 320 instanced puffs at y ≈ 105, wrapped around the bird on XZ. It and the CloudManager clusters (in `cloudRoot`) only show once the camera is above y = 55, because from the ground their undersides read as grey rock. The camera whites out while it's inside the deck, between chapters 2 and 3.
  - Telemetry (displayed altitude, V/S, knots, heading, fictional lat/lon) is emitted every frame through `onTelemetry`. `Landing` writes it to the DOM through refs at about 16 Hz, never through React state.
  - `setPaused(true)` cancels the rAF loop, then snaps to the target shot: it ends the intro dolly, jumps progress to its target, and runs `update(0)` plus one render, so the held frame is the intended shot rather than a mid-transition one. The cloud-deck visibility check uses the current frame's camera height for the same reason. Resuming restarts the loop without a time jump. A resize while paused re-renders the held frame once, because `setSize` clears the canvas.
  - `dispose()` kills its GSAP tweens, frees every geometry, material and texture in one traversal, then calls `renderer.dispose()` and `forceContextLoss()`.
- **Page.** Five `data-chapter` sections of at least `100svh` each.
  - One scrubbed GSAP timeline (scrub 0.8) spans the whole page. Segment *k* runs from section *k*'s top to section *k+1*'s top, so chapter stops stay aligned even if a section grows taller than the viewport. Snap points are those tops: an array, so snapping is directional, with `inertia: false` so a fast fling can't skip chapters. The timeline is rebuilt on resize (debounced).
  - Chapter content (`data-reveal`) rises in and falls away in both directions. The hero content scrubs up and out.
  - The intro timeline (veil, per-character title rise, `data-intro="fade"` items, `data-hud` chrome) plays once per page load, together with the scene's camera dolly-in (`playIntro`).
  - Pointer parallax moves the scene camera/bird (`setPointer`) and the title (`gsap.quickTo`).
  - ←/→ step the bird only while chapter 1 is active.
  - **Sound** starts a `WindAudio` from the toggle's click. Its intensity follows the vertical speed, and it's stopped on unmount.
- **Reduced motion** (`prefers-reduced-motion: reduce`, read live by `usePrefersReducedMotion`): no scrub, no snapping, no intro choreography and no parallax. Chapters activate when centered, and the backdrop *cuts* to that chapter's shot (`setProgress(p, true)`) behind a quick fade. Reveals are opacity-only, bird/map/sky swaps are instant, and the bird's weave is reduced. Changing the setting rebuilds the scene.
- **Settings.** `settings.ts` persists `{bird, map, weather, ringChallenge}` under `bird-flight-settings` when pre-flight begins, and validates every field on read. The landing starts from the saved choices, and **Quick start** uses them.

### 6.11 Pre-flight boot HUD, flight HUD and takeoff (`preflight/BootSequence.tsx`, `flight/FlightHud.tsx`, `App.tsx`)
- **Boot HUD.** `BootSequence` is presentational: App passes `lines` (from `buildBootLines`), the error line/message/detail, `startedAt` and `running`.
  - One instance renders for both `'requesting'` and `'error'`, so a failure or Try Again updates the lines in place.
  - On mount, a GSAP timeline types each label by writing `textContent` into a span React renders empty. Then it fades in that line's leader and `[ status ]`. Under reduced motion the labels appear at once.
  - Status changes re-key the status span, which replays the CSS `ascent-blip` flicker. Active statuses breathe.
  - The model line draws a hairline progress bar from the real percentage.
  - The T+ clock is real elapsed time (a rAF writing `textContent`) and freezes on failure.
  - A polite `aria-live` summary reads the statuses to screen readers.
- **Flight HUD.** `FlightHud` receives `engineRef` (a type-only import, so the engine stays lazy). A rAF loop:
  - moves the heading tape every frame (a strip of ticks from −120° to 480° slid under a center caret, so it never wraps)
  - writes HDG/SPD/ALT text about every 100 ms through refs, never React state

  These use the new `GameEngine` getters: `getHeadingDegrees()` (0° is the start direction and right turns increase it), `getAltitude()` (the bird's Y), and `getSpeed()` (×1.944 to show knots). The splash and underwater overlays are unchanged. The old warm boost vignette is replaced by a HUD effect: masked conic speed streaks (opacity plus a compositor-only transform animation), a faint warm rim, and frame brackets that tighten and turn warm. Badges snap on and off with no color transition.
- **Takeoff.** `handleStartFlying` sets `launching` (which locks the calibration controls). It then awaits the engine chunk together with `playTakeoffLaunch()`: the panel lifts away, and the always-mounted pale veil (`takeoffVeilRef`, the landing intro's sky gradient, reading "Cleared for takeoff" and the bird, world and sky) fades to opaque. The landing scene is disposed and the engine built under the veil. Once `flightState` is `'flying'`, a layout effect fades the veil off the chase camera's swoop-in and staggers the `[data-flight-hud]` blocks in with `fromTo`. `clearProps` then removes GSAP's inline styles. Reduced motion uses plain crossfades.

### 6.12 Keyboard controls, pause menu and "How to fly" guide (`game/keyboardControls.ts`, `flight/PauseMenu.tsx`, `flight/FlightGuide.tsx`, `flight/guideArt.tsx`)
- **`KeyboardControls`** is framework-free and emits the same `HandControlState` through the same `handleControlState` callback as the tracker:
  - `handDetected` is always true, so the engine's hand-lost easing never applies.
  - `landmarks` and `flickNearMiss` are always null.
  - It reads `event.code` (physical keys), so WASD is ZQSD on AZERTY.
- **Keys:**
  - W/↑ climb, S/↓ dive, A/← bank left, D/→ bank right.
  - Axes ramp toward ±1 at 2.8/s (about 0.36 s to full), return at 4/s, and reverse at 6/s. The rates are frame-rate independent, and a rAF emits only when something changed.
  - **Space** held = `boost`, so the engine's rising-edge barrel roll fires on each new press.
  - **F** = a one-shot `backflip` (key repeat ignored).
  - Handled keys `preventDefault` on keydown *and* keyup (Space activates a focused button on keyup), unless paused.
  - Window `blur` releases every key, and `setPaused` releases them and rests the axes at 0.
- **Pause menu** (`PauseMenu`): dark glass in the HUD style, with a flight summary (and ring score) and **Resume** (autofocused, shows `Esc`) / **How to fly** / **Back to landing**. GSAP fades it in unless reduced motion.
- **Guide** (`FlightGuide`):
  - Hand mode has 4 cards: Steer, Boost (close fist), Barrel roll, Backflip (quick upward flick). Keyboard mode has 4: Steer (WASD/arrows), Boost + barrel roll (Space), Backflip (F), Pause (Esc / ?).
  - Each card has an illustration, the input, one precise tip, and a small mono line with the exact numbers.
  - **Every number is computed from the real constants**: `trackingShared.ts` (deadzone, fist hold frames, flick thresholds), `presets.ts` (speeds in knots, trick durations) and `keyboardControls.ts` (ramp). Change those constants, never the copy.
  - **Buttons by origin:**
    - `'preflight'`: **Take off** (primary), **Back** (to calibration / to landing) and **Don't show again**
    - `'pause'`: **Back to pause menu**
    - `'hud'`: **Resume flight**
    - Esc acts as Back/close.
- **Illustrations** (`guideArt.tsx`) are inline SVG (a procedural hand glyph: finger rects that fold with `scaleY`, a thumb that rotates, a cyan palm-center dot) and HTML keycaps. They're animated only by the `ascent-guide-*` / `ascent-key-press` keyframes in `index.css`, with `transform-box: fill-box`. Under reduced motion every animation is paused on its telling pose: a per-illustration `--pose` negative delay.

---

## 7. Coding conventions and patterns

- **Keep game code framework-free.** Anything in `src/game/` is plain TypeScript and three.js with no React imports. React talks to it through constructor options, a few `get*/is*` getters, `applyControls()`, and callbacks.
- **Use one manager class per system**, with the same lifecycle: `constructor(scene)`, then `update(dt, birdPosition, forward, …)` every frame, then `dispose()`. `GameEngine.update` calls them in order. New systems should follow this shape.
- **Pool and stream around the bird.** Objects spawn ahead of the bird along `forward` and are reused through `visible = false` and a pool array. They're recycled once they're some distance *behind* along their spawn-time forward, **or** beyond a max distance from the bird. Always include the distance cap, or a U-turn can fill the pool with unreachable objects and stop spawning. Terrain and ocean tiles are keyed by `"x,z"` strings.
- **Tune with constants at the top of each file**, in `UPPER_SNAKE_CASE` with a comment explaining the *why*. Change these rather than inlining magic numbers.
- **Generate assets procedurally.** Meshes are built from three primitives with `flatShading: true`, textures from `<canvas>`, and sound from Web Audio. There are no binary assets, and it's worth keeping it that way.
- **Comments are dense and explain intent**, often pointing to `.agents/memory/*`. Match that density in `src/game/`.
- **Style:**
  - 2-space indent, single quotes, semicolons, trailing commas, about 120 columns.
  - Prettier is installed but there's no config file, so defaults apply apart from the quote style already used in the code.
  - There's no ESLint and **no tests**.
- **Imports.** Use the `@/` alias for `src`. Use `import * as THREE from 'three'`. Put `type` imports inline, as in `import { Bird, type BirdType }`.
- **React style.** One big `App` function component. Every handler is wrapped in `useCallback`. Refs mirror state that the long-lived tracker closure needs to read, such as `barrelRollingRef`. Styling is Tailwind utility classes with inline styles for gradients. There's no component library: the shadcn scaffold was removed. Theme tokens such as `bg-card` and `text-primary` still come from `index.css`.
- **Verification habit:** always run `pnpm run build` from the root, which also typechecks, and check visual changes in a real browser with a webcam.
- **Styling.** The landing, the pre-flight screens and the in-flight HUD share one cinematic, instrument-panel look:
  - dark glass (`ascent-glass`, `ascent-glass-strong`)
  - `ascent-hud` monospace caps for labels and readouts
  - `ascent-shadow` for text over the sky
  - `CornerBrackets` for instrument frames
  - `--ascent-cyan` for OK/readouts, `--ascent-warm` for actions and active states, `--ascent-fault` for failures
  - `font-display` (Instrument Serif) for headings and `font-mono` (JetBrains Mono) for numbers

  The old warm theme tokens (`bg-card`, `text-primary`, …) are no longer used by any screen.
- **`ascent-*` classes are unlayered CSS**, so they outrank Tailwind utilities on the same element. `.ascent-hud` fixes `font-size: 11px`, so a `text-[10px]` next to it has no effect, and `.ascent-glass` fixes the border color. Use an inline style when you need to override them.
- **Dependencies:** anything imported at runtime goes in the game's `dependencies`, and build tooling in `devDependencies`. Prefer `catalog:` versions for shared tooling. New packages must be at least 1 day old (`minimumReleaseAge`). Don't reintroduce platform-specific `overrides`.

---

## 8. Replit-specific pieces (kept, and still working)

| Item | What it does | Elsewhere |
|---|---|---|
| `.replit` | `modules = ["nodejs-24"]`, autoscale deployment with a `pnpm store prune` post-build, agent stack `PNPM_WORKSPACE`. The `postMerge` hook was removed along with `scripts/post-merge.sh`, which ran `pnpm --filter db push` for the deleted db package. | Ignored. |
| `artifacts/3d-game/.replit-artifact/artifact.toml` | Declares the game service on **port 24982**, sets `PORT=24982` and `BASE_PATH=/`, runs `pnpm --filter @workspace/3d-game run dev` in development, and deploys the build **statically** from `artifacts/3d-game/dist/public` with a `/* → /index.html` rewrite. | Ignored. Vercel uses `vercel.json`. |
| `vite.config.ts` Replit plugins | `@replit/vite-plugin-runtime-error-modal`, plus `cartographer` and `dev-banner` in non-production builds, are imported dynamically **only when `REPL_ID` is set**. | Not loaded. They're still installed as devDependencies, so Replit keeps working. |
| `PORT` / `BASE_PATH` | Injected by `artifact.toml` on Replit. | Optional. Defaults are 5173 or 4173 and `/`. |
| `pnpm-workspace.yaml` `minimumReleaseAgeExclude: '@replit/*'` | Lets Replit's own packages bypass the 1-day release-age guard. | Harmless. |
| `.replitignore`, `.gitignore` `.local/` `.cache/` | Replit cache directories. | Harmless. |
| `replit.md`, `.agents/memory/`, `attached_assets/` | Replit Agent's notes, memories and pasted prompts. | Documentation and history only. |

What was removed to make the repo standalone:
- **Deleted packages:** `artifacts/api-server` (the Express health-check template), `artifacts/mockup-sandbox` (Replit's Canvas preview) and `lib/*` (api-spec, api-zod, api-client-react, db).
- **Deleted scripts:** `scripts/`, including `post-merge.sh` and its hook.
- **Deleted game files:** 55 unused shadcn components, `hooks/`, `pages/`, `lib/utils.ts` and `components.json`.
- **Dropped dependencies:** the unused `@replit/connectors-sdk`, wouter, react-query, Radix, zod, framer-motion and other scaffold deps.
- **Removed overrides:** the linux-x64-only native-binary overrides in `pnpm-workspace.yaml`. The lockfile now carries every platform's esbuild, rollup, lightningcss and tailwind binaries.
- **Kept overrides:** the `esbuild: 0.27.3` and `@esbuild-kit/esm-loader → tsx` security overrides, and `minimumReleaseAge: 1440`.

There is no Replit DB, Replit Auth or Replit secrets usage anywhere. The game is 100% client-side.

---

## 9. Known issues, bugs, fragile areas and tech debt

These come from code reading plus headless runs.

**Fixed so far, and removed from this list:**
- **Standalone cleanup (earlier PR):** env vars were required, installs only worked on linux-x64, template scaffolding, and a placeholder meta description.
- **P0 correctness pass:**
  - steering and boost latched on hand loss
  - rings, clouds and reef stalled after U-turns
  - the Ring Challenge's inverted despawn sign
  - the sky dome and horizon clouds were left behind
  - the island-edge teleport underwater
  - a silent MediaPipe CDN failure
  - the generic "Camera access was blocked" error
  - the Back-during-requesting race
  - a double-click could build two engines
  - `surfaceSplash` wasn't reset
  - the second camera stream opened by `camera_utils`
  - the Index Finger mode

### Gameplay and control bugs
1. **Frame-rate-dependent feel.** Every lerp (orientation 0.06, speed 0.04, camera 0.05, FOV 0.06, the tracker EMA 0.35, fish-school lerp 0.02) is per frame, not scaled by `dt`. The game behaves differently at 30, 60 and 144 Hz. Separately, `dt` is clamped to 0.05, so below 20 FPS everything runs in slow motion.
2. **Gestures that interfere with steering:**
   - Closing a fist shifts the palm-center landmarks slightly, so boosting nudges steering.
   - An upward flick is also a large pitch-up input.
   - A center captured outside the corner box makes `axisValue()` return 0 on that side, silently disabling steering in that direction.
   - Sensitivity is applied after the box mapping. At 0.5x the bird can never reach full pitch or roll, and at 2x it saturates at the middle of the box.
3. **Reef items float mid-water.** Reef items spawn at a random depth between -13 and -4, not on the seabed, and there is no visible seabed mesh, only caustic rings at y = -14. Coral heights use `geometry.boundingSphere`, which is always null because it's never computed, so the offset is always 0.8. Pooled reef items keep their original `kind`.
4. The skimming splash particles don't fade (the `PointsMaterial` issue in §6.9).
5. **Surface-level island pop.** A bird skimming *above* the water that flies into an island is still lifted to `height + 3.5` in one frame. Near the shore that's about 3.5 units. Only the underwater case was fixed.

### Robustness and UX
6. ~~**No keyboard fallback, and no pause.**~~ Keyboard mode and the pause menu now exist. There is still **no touch or gamepad input**, so mobile is effectively unsupported.
7. ~~**Tall cards get clipped.**~~ Fixed in the landing redesign. The menu card is gone, and the pre-flight cards sit in `PreflightLayer` (a `fixed overflow-y-auto` scroller around a `min-h-full` flex box), so a tall card starts at the top and scrolls. At 1280×720 the two-column calibration card (522 px) fits without scrolling, and the landing chapters are `min-h-svh`, so they grow instead of clipping.
8. **Cryptic load-error detail.** When a MediaPipe file 404s, the detail under the friendly message is minified MediaPipe internals such as `TypeError: jt is not a function`. The friendly message is correct, but the detail line doesn't help users.
9. **The SPA rewrite hides missing MediaPipe files.** The SPA rewrites on Vercel and Replit return `index.html` for any missing file. If the `mediapipe/hands/` files were ever missing from a deploy, MediaPipe would receive HTML and fail. The startup error screen now reports this.
28. **A failed chunk import can't be retried in place.** Chromium caches a failed dynamic `import()` for the page's lifetime. So when the engine or tracking chunk fails to download, the boot HUD offers **Reload page** instead of Try Again. Other failures (camera, MediaPipe wasm/model loads) keep Try Again. Recovery after a denied camera is verified; recovery after a MediaPipe asset failure is not.
29. **Flick detection is frame-rate sensitive.** Below ~4.5 tracker FPS, the 220 ms window holds a single sample and no flick can register (see §6.3). Headless SwiftShader sits right at that edge.

### Performance
10. **The React app re-renders at the tracker rate.** `onUpdate` calls `setHandDetected`, `setBoosting` and `setStatusText` on every MediaPipe frame (about 30/s). Each call re-renders the whole `App` during flight. React bails out of identical values, but any change re-renders App and the HUD. The flight telemetry avoids this (refs plus rAF), and boot progress re-renders at most once per whole percent.
11. **Per-frame allocations.** `GameEngine.update`, rings, clouds, underwater, splash and the ring guide create `new THREE.Vector3()` and `.clone()` in hot loops, which causes GC churn. `ocean.animateWater` also does a `key.split(',')` for every tile on every frame.
12. **Leaky disposal.** `GameEngine.dispose()` removes objects but doesn't dispose most geometries and materials: terrain, ocean tiles, sky, bird, clouds, rings and the underwater scene. It also never calls `renderer.forceContextLoss()`. Repeated play sessions leak GPU memory, and browsers cap live WebGL contexts at about 16.
13. **Unbounded cache.** `OceanManager.islandCache` grows forever during long flights.
14. **Main-thread stutter.** Tile generation is synchronous: crossing a tile boundary builds 7 tiles of noise on the main thread. MediaPipe also runs on the main thread, alongside a WebGL render with PCF shadows.
15. **Large downloads.** The entry chunk is 908 kB (264 kB gzip: React, three, GSAP). MediaPipe's JS and the engine are now split out and only loaded at pre-flight, but each session still downloads about 13 MB of MediaPipe files.

### three.js deprecations (seen in the console on r185)
16. `THREE.Clock` is deprecated in favor of `THREE.Timer`.
17. `PCFSoftShadowMap` is deprecated and **silently falls back to `PCFShadowMap`**, so the "soft shadows" aren't soft.

### Tech debt
18. **A god component and a god class.** The screens now live in `preflight/` and `flight/`, and canvas drawing in `handPreview.ts`. `App.tsx` still owns the tracker lifecycle, the calibration state machine, boot status and the takeoff timelines. `GameEngine.update` is a roughly 190-line function.
19. **Duplication.** `ringBurst.ts` and `waterBurst.ts` are near-copies. `TerrainManager` and `OceanManager` duplicate the tiling logic with no shared interface type.
20. **No tests, no lint and no CI.** The pure math in `axisValue`, `applyDeadzone`, `recomputeBox`, the flick detector, the ring hit test and despawn, and `classifyStartupError` is easy to unit-test and currently isn't. The ring despawn sign bug shipped unnoticed for exactly this reason.
21. **Inconsistent naming.** The repo and root package are "Sky Soarer" / `sky-soarer`, the UI is "Bird Flight", the game package is `@workspace/3d-game`, and the localStorage key is `bird-flight-best-score`.
22. **Stale `replit.md`.** It is kept as is by request (see the top of this file). It still describes Finger mode and the CDN.
23. **Untested installs.** The macOS, Windows and ARM installs are expected to work now that the platform overrides are gone, but they haven't been tested yet.
24. **The MediaPipe asset path lives in two places.** `PUBLIC_DIR` in `vite-plugin-mediapipe-assets.ts` and `MEDIAPIPE_ASSET_DIR` in `handControls.ts` must stay in sync. The download meter also depends on MediaPipe's loading mechanism (fetch for the wasm and model, XHR for `.data`) and on the file names in `DOWNLOAD_WEIGHTS`. After a version bump, check that the percentage still reaches ~99% before READY.
27. **Boot and HUD timing are only verified headlessly.** Under SwiftShader, CSS transitions trail state changes by about a second and the chase camera takes many seconds to swoop in, because of the low frame rate. The 550 ms READY hold is shorter than a SwiftShader screenshot, so READY can't be captured there. Check the feel on a real GPU.
25. **Landing and game stay separate.** The landing flight path is scripted and never uses GameEngine physics. Tuning the in-game feel doesn't change the landing, and the reverse is also true.
26. **Landing performance is only verified headlessly.** It was checked with SwiftShader (software WebGL), which renders correctly but can't measure real frame rates. The 60 FPS target needs checking on a real mid-range laptop (see the PR test checklist).

---

## 10. Prioritized improvement ideas

**P0: playability**
1. ~~Add a **keyboard fallback** behind the same `HandControlState` interface.~~ Done (keyboard mode, plus pause and the guide). Still open: touch and gamepad input.
2. ~~Fix the clipped tall cards (§9 #7).~~ Done in the landing redesign.

**P1: controls feel**

3. Make all lerps frame-rate independent with `1 - Math.exp(-k * dt)`, and use `THREE.Timer`.
4. While the fist is closing, freeze or hold the steering sample so boosting doesn't nudge steering.
5. Validate calibration: the center must lie inside the box, and the box must have a minimum size. Offer a "use default box" quick start, and persist calibration in `localStorage` so returning players can skip it.
6. Make flick detection relative to the calibration box size, and suppress the pitch spike it causes.
7. Migrate from the legacy `@mediapipe/hands` to `@mediapipe/tasks-vision` `HandLandmarker`, which is maintained, supports a GPU delegate, and can run in a worker.

**P2: performance**

8. Throttle React updates from the tracker, sending only changed values, or move HUD status into a ref plus a small subscribed component.
9. Remove per-frame `Vector3` allocations by using scratch vectors.
10. Dispose geometries, materials and textures properly, and call `forceContextLoss()` on engine teardown.
11. Generate tiles incrementally (one per frame) or in a worker. Bound `islandCache`.
12. ~~Code-split: lazy-load MediaPipe and the engine.~~ Done (both load at pre-flight). Still open: consider dropping the unused `hand_landmark_full.tflite` from the build, since `modelComplexity` is 0.

**P3: visuals and gameplay**

13. Fix the splash fade by reusing the burst `ShaderMaterial`, and deduplicate the burst classes into one configurable `ParticleBurst`.
14. Add a real seabed mesh, anchor reef items to it, and add a double-sided or underside water surface with a Snell's-window look from below.
15. Use real soft shadows (VSM, or PCF with a larger radius), and optionally postprocessing (bloom for rings and emissive reef, real motion blur).
16. Gameplay: timed ring runs, a combo multiplier, trick scoring, collectibles underwater, day and night that changes over time, and live weather switching.
17. Allow switching bird, map or weather without re-calibrating: keep the tracker and rebuild only the engine.

**P4: code quality**

18. Add a `MapEnvironment` interface for Terrain and Ocean, split `App.tsx` into screens and hooks (`useHandTracker`, `useGameEngine`), and break `GameEngine.update` into named steps.
19. Add Vitest unit tests for the tracker math, ring hit and despawn tests, and `classifyStartupError`. Add ESLint and Prettier configs, and a GitHub Actions workflow that runs `pnpm install --frozen-lockfile && pnpm run build` on Linux, macOS and Windows.
20. Unify the naming (Sky Soarer vs Bird Flight), keeping the localStorage key backward-compatible.

---

## 11. Gotchas for future changes

- Don't start the camera or audio before a user gesture. Camera and tracking start on **Begin pre-flight** / **Quick start**. In-game wind audio starts on **Start Flying** (or **Take off**, or the keyboard boot's automatic takeoff, which relies on the page's sticky activation from the Quick start / Begin click), and the landing's ambient wind starts only from its **Sound** toggle click.
- New inputs must emit `HandControlState` through App's `handleControlState`; don't give the engine input-specific code. Keyboard mode must never import `handControls` at runtime (type imports only). The production build check is that keyboard mode never requests `handControls-*.js` or `mediapipe/hands/`.
- Anything that can run while a menu is open must respect the pause: the engine ignores `applyControls` while paused, `KeyboardControls.setPaused` stops listening, and flick hints are gated on `flickHintsOnRef`. A new overlay over the flight should set `paused` (through `guide`/`pauseOpen`) and leave the HUD `inert`.
- The guide's numbers come from `trackingShared.ts`, `presets.ts` and `keyboardControls.ts`. When you change a threshold, change it there, and the guide follows. Don't hard-code numbers in `FlightGuide.tsx`.
- `handleStartFlying` must read settings from `settingsRef.current`: the keyboard boot calls it asynchronously through `requestTakeoffRef`, after a Quick start may have replaced the settings.
- Keep MediaPipe and the engine lazy. Never add a runtime (non-`type`) import of `@/game/handControls`, `@mediapipe/hands` or `@/game/GameEngine` to `App.tsx`, `landing/*`, or anything they import statically. Put shared runtime values in `trackingShared.ts` / `presets.ts` instead. Check with `pnpm run build`: `handControls-*.js` and `GameEngine-*.js` must stay separate chunks.
- Always dispose the `LandingScene` before constructing a `GameEngine` (`disposeLandingScene()` in `handleStartFlying`), so two WebGL contexts are never live at once. Do it under the opaque takeoff veil.
- Boot status must stay real. Drive `boot` only from actual events, and keep the only added delay the capped `BOOT_MIN_DURATION_MS`/`BOOT_READY_HOLD_MS` hold. After that hold, check `isCurrent()` like after every other `await`.
- The download meter wraps global `fetch`/`XMLHttpRequest.prototype.open` only while `HandTracker.start()` runs. Keep it scoped to the MediaPipe path, and always stop it (in `finally` and in `stop()`). Never consume the caller's response body: count bytes on a `clone()`.
- Keep the takeoff veil mounted (hidden with `visibility`) so its ref exists before the first animation (see `react-ref-before-conditional-mount.md`). Any path that abandons a launch must call `resetTakeoff()`, which also resolves the pending launch promise.
- `[data-flight-hud]` wrappers and the boot HUD's `[data-after-type]` parts are animated by GSAP, so don't put Tailwind `transition` utilities on those exact elements. Put transitions on children.
- Don't put Tailwind's plain `transition` utility (it includes `opacity` and `transform`) on elements GSAP animates (`data-hud`, `data-intro`, `data-reveal`). The CSS transition fights the tween and left the Sound button stuck at opacity 0. Use `transition-colors`.
- Don't wrap text that has `ascent-shadow` in `overflow-hidden` masks. The clip turns the soft shadow into visible rectangles, so reveal it with opacity and a transform instead.
- Don't fold the trick sweep into the steering angles (see memory note).
- Don't move the `state.backflip` check below the `handDetected` guard in `applyControls`.
- Don't re-throw from the per-frame `hands.send()` catch. Startup failures are different: `start()` surfaces them as `TrackingStartError` so the UI can show them.
- Don't reintroduce `@mediapipe/camera_utils` or a CDN `locateFile`. The app owns the single `MediaStream`, and MediaPipe files are self-hosted. When bumping `@mediapipe/hands`, change only `package.json`, then check that the file list the plugin emits still matches what the new version requests.
- After every `await` in the startup flow, check the session id (`isCurrent()`) and release anything acquired if the attempt was superseded.
- Every pooled spawner needs a max-distance despawn as well as the "behind" check (see §7). Watch the sign of axial distances: `delta = bird - item`, so an item the bird has passed is **positive**.
- Don't "fix" the mirrored overlay or drag math without reading the two canvas-mirror memory notes. The un-mirror at draw time and the *absence* of a flip in pointer handling are both intentional.
- To flip a bird's facing direction, change the yaw offset on the outer group, never the mesh (see `three-js-mesh-orientation-fix.md`).
- When adding a map, implement `update(position)` and `heightAtWorld(x, z)`. Add `isOverWater` if it has water, and wire it in the `GameEngine` constructor.
- The WebGL scene can't be verified in most headless screenshot sandboxes. Use a real browser, or SwiftShader flags as described in §3. In this repo's cloud sandbox, headless Chromium can't reach Google Fonts through the TLS proxy. For screenshots, route `fonts.googleapis.com`/`fonts.gstatic.com` through `curl` with Playwright's `page.route` rather than disabling certificate checks.
- **Driving calibration and flight headlessly** (no real hand available):
  - Override `navigator.mediaDevices.getUserMedia` with an init script that returns a `canvas.captureStream()`.
  - On the **dev server**, `page.route` the pre-bundled `/node_modules/.vite/deps/@mediapipe_hands.js` to a stub module. It must export `Hands` and `HAND_CONNECTIONS` both as named and default exports, because Vite's CJS interop reads them off the default export. The stub's `send()` reports synthetic landmarks you control.
  - Everything else (HandTracker math, App, engine) stays real.
  - Use the production preview with the real files to check the loading percentage.
- **Flying headlessly in keyboard mode:**
  - Press real keys with `page.keyboard.down/up`.
  - To read the bird's state without adding debug code to the product, patch the engine from the page on the dev server. `import('/src/game/GameEngine.ts')` is the same module instance the app lazy-loads, so wrapping `GameEngine.prototype.update` to stash `this` on `window` exposes `bird.group.position`, `headingYaw`, `rings.getNextRingPosition()` and the `is*`/`get*` getters. A ring autopilot works from those.
  - SwiftShader runs at ~5 FPS at 1280×720 (the sim then runs at ~¼ speed). Shrink the viewport (e.g. 800×450) for physics and flick checks, and restore it for screenshots.
  - After a hint or overlay appears, wait ~0.7 s before a screenshot: its CSS fade-in hasn't produced a frame yet.
  - Playwright's role queries don't honor `inert`, so scope locators to the open dialog.
  - Near-miss and flick thresholds are best checked deterministically: bundle `handControls.ts` with esbuild (`--alias:@mediapipe/hands=<stub>`, `--alias:virtual:mediapipe-hands-assets=<stub>`, `--define:import.meta.env.BASE_URL='"/"'`), stub `performance.now`, and call `handleResults` with synthetic landmarks at a fixed frame rate.
