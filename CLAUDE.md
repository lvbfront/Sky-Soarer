# CLAUDE.md — Sky Soarer ("Bird Flight")

Guidance for Claude Code (and humans) working in this repository. The repo is named **Sky Soarer**. The landing page's hero title is **SKY SOARER**, the `<title>` is "Sky Soarer — Bird Flight", and the game still calls itself **Bird Flight** in `replit.md` and its storage keys. It was built on Replit with Replit Agent. It has since been cleaned into a standalone game repo that builds on any OS, deploys to Vercel as a static site, and still runs on Replit.

- `replit.md` is the original agent's running notes. It is kept unchanged as history, but **it is stale**: it describes template packages that have been deleted (api-server, db, mockup-sandbox), a port-5000 API server, and audio starting on "Continue". Where the two disagree, this file wins.
- `.agents/memory/*.md` holds lessons that agent recorded while fixing bugs. Read them before you touch the controls or tricks.

---

## 1. Project overview

Bird Flight is a relaxing, endless 3D flight game. You steer a low-poly bird **with your bare hand in front of a webcam** (MediaPipe Hands tracks it), or, in **Keyboard** mode, with WASD / the arrow keys. Both inputs produce the same `HandControlState`, so the engine never knows which one is driving. There is **no touch or gamepad input**; the mouse is only for menus and HUD buttons.

**Privacy is a public promise** (§12): camera frames and hand landmarks never leave the browser, the game makes zero third-party requests (fonts and MediaPipe are self-hosted), nothing but a few small `localStorage` settings is stored, and a **Privacy** panel (landing + camera step) lists them with **Clear my data**.

How a session plays:

1. **Landing page, "The Ascent" (Screen 1).** A scroll-driven page over a live 3D backdrop. Scrolling climbs the bird from the ground to above the clouds, and each full-viewport chapter is one setup step (see §6.10):
   - **0 · Hero (0 m):** the SKY SOARER title, tagline, a **Quick start** button that reuses the last saved settings and goes straight to pre-flight, and a "Scroll to ascend" hint.
   - **1 · Choose your bird (300 m):** Pigeon, Falcon, Greater Flamingo, or Duck/Seabird. Prev/next buttons, ←/→ keys, or the name chips.
   - **2 · Choose your world (1,200 m):** Mountain Valley, or Tropical Ocean & Islands. The 3D world switches live.
   - **3 · Choose the sky (3,000 m):** Sunny Morning, Sunset Gold, or Starry Night. Sky and lighting crossfade live.
   - **4 · Above the clouds (5,000 m):** a summary of the choices, the **Input** switch (**Hand (webcam)** or **Keyboard**), the Ring Challenge switch (with best score), a controls briefing for the chosen input, and **Begin pre-flight**, which saves the settings (input included) and starts the pre-flight for that input. Under it, the camera privacy note with a **Privacy** link (§12).

   Fixed instrument chrome: an altimeter rail (clickable chapter ticks), telemetry (speed, heading, V/S, lat/lon), a big altitude counter, and a **Sound** toggle for ambient wind (off by default).
2. **Pre-flight 01: boot sequence.** A full-screen HUD over the frozen backdrop types monospace status lines that follow the **real** startup events (see §6.11). In hand mode there are three:
   - `CAMERA [REQUESTING → ONLINE · 480×360]`
   - `HAND TRACKING MODEL [STANDBY → LOADING xx% → WARMING UP → READY]`, where the percentage is measured from the actual MediaPipe downloads
   - `CALIBRATION [PENDING]`, or `[SAVED]` when a saved calibration lets the player skip calibration

   A failure shows inline under the failing line (`DENIED`, `NOT FOUND`, `BUSY`, `FAILED`, `TIMEOUT`, …) with the message, the raw detail, and **Try Again** (or **Reload page** when a code chunk failed to import, see §6.12). **Back** is always available.

   **Keyboard mode** skips the camera, MediaPipe and calibration entirely. Its boot shows only `CONTROLS [KEYBOARD]` and `FLIGHT ENGINE [LOADING → READY]` (the real engine chunk import), then goes straight to the takeoff transition.
3. **Pre-flight 02: calibration, as an instrument panel** (hand mode only).
   - Steering always tracks the **palm center**. An Index Finger mode existed earlier and was removed.
   - The camera preview is framed as a sensor feed (LIVE marker, resolution, scanlines, corner brackets, HAND LOCK / NO SIGNAL).
   - Capture 5 points: the neutral center, then the top-left, top-right, bottom-left and bottom-right corners of your comfortable range. Each is drawn as a target reticle. The step being captured also shows a pulsing ghost reticle at a suggested spot, and a checklist shows each step as LOCKED / ACQUIRE / STANDBY.
   - Once a corner is captured you can drag its reticle on the feed to fine-tune it.
   - Set steering sensitivity from 0.5x to 2.0x on a styled slider.
   - **Start Flying** stays disabled until all 5 points are captured **and** the calibration is valid: the box must be at least 15% of the feed on each axis, and the center must sit inside it with 15% of the box's span to spare on every side. An invalid box turns red, with a message saying what to fix. Start Flying saves the calibration (points and sensitivity) in `localStorage` and plays a short GSAP **takeoff transition** into flight.
   - **Returning players skip calibration.** When a valid calibration is saved, the hand boot shows `CALIBRATION [SAVED]` and goes straight to takeoff. To recalibrate, use **Recalibrate hand controls** under Begin pre-flight on the landing, **Recalibrate** in the pause menu, or the guide's **Back to calibration** (which opens the saved box). **Recalibrate** on a complete calibration screen starts over.
   - **"How to fly" guide.** Before takeoff (after Start Flying, or after the keyboard boot), the guide opens by itself until the player ticks **Don't show again**, stored per input mode. It has one card per move, each with a looping procedural SVG/CSS illustration and one precise tip whose numbers come from the real thresholds (§6.12). **Take off** continues; **Back** returns to calibration (hand) or the landing (keyboard).
4. **Flight.**
   - Move your palm inside the calibrated box to pitch and roll (keyboard: W/↑ climb, S/↓ dive, A/← and D/→ bank, with a smooth ramp). Roll banks the bird, and banking turns it in a coordinated turn: ~93°/s at cruise (a held key turns 180° in ~2.3 s), wider when boosting, tighter when braking or swimming (§6.14).
   - **Air brake:** hold **Shift**, or push your open palm toward the camera. The bird slows to half of cruise, sinks gently and turns much tighter (~145°/s; ~160°/s swimming). Boost cancels it.
   - **Steering settings** (sensitivity 0.5–2.0x, invert climb/dive) apply to **both** inputs, on the landing's last chapter and live in the pause menu (§6.14).
   - **Landing:** keep the brake on low over flat ground, a rock top or the sea and the bird lands by itself (an LDG readout and a reticle on the surface show when you're in range). It stands (or floats, bobbing on the waves) until you **take off**: jump and jump again in the air, hold Space 0.4 s, or raise your palm into the top of your box for 0.5 s; on water a tap of Space or a fist starts a takeoff run (§6.15).
   - **On the ground** the bird walks, turns, jumps and backflips (W/S, A/D, Space, F; or palm low, tilt, fist, flick). Walking off a ledge opens its wings into a glide; walking into the sea floats it, and it paddles back onto a beach (§6.16). The full controls table is in §6.16.
   - **Close a fist** (keyboard: hold **Space**) to boost. Boosting also fires an automatic 0.8 s barrel roll. Closing or opening the fist doesn't nudge the steering.
   - **Flick your hand up fast**, about half the height of your calibrated box in under 0.2 s (keyboard: **F**), for a 0.9 s backflip. The flick doesn't pitch the bird up. An upward flick that was too slow or too short shows a brief coaching hint, "Flick faster ↑" or "Flick higher ↑".
   - Both tricks are cosmetic only. They never change heading or momentum.
   - **Esc** or the HUD's **Pause** button opens the pause menu (**Resume / How to fly / Recalibrate** (hand mode) **/ Back to landing**, plus a **Graphics: Auto / High / Low** switch, §6.13), and the game loop freezes. The HUD's **?** button (or the `?` key) opens the guide mid-flight, paused. Switching tabs pauses too.
   - **The Tropical Ocean** (§6.6): a shader-animated sea, turquoise over the shallows and deep blue offshore, with Fresnel sky reflection, sun glint and shore foam. Islands have sandy beaches, palms, bushes and shore rocks. Dolphins leap now and then, seabirds circle in the distance, and hazy island silhouettes line the horizon.
   - **Dive** under open water into a streamed seabed (sand dunes, rock patches, reef slopes that carry every island down to the sea floor) covered in instanced coral, kelp, anemones, rocks, starfish and shells, with animated caustics, light shafts, marine snow and round bubbles. Fish schools flock (four species), and a sea turtle, a manta ray, jellyfish (glowing at night) and a shark swim around the bird, keeping their distance. Looking up shows the shimmering underside of the surface. Diving and surfacing blend the fog and light over ~0.4 s, with a splash sound and the wind muffling into an underwater rumble.
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
| Web fonts | `@fontsource/inter`, `@fontsource/instrument-serif`, `@fontsource/jetbrains-mono`, imported in `main.tsx` and bundled (self-hosted, no Google Fonts) | ^5.3.0 |
| Audio | Web Audio API, fully synthesized (no audio files) | — |
| Unit tests | Vitest (`vitest.config.ts`, Node environment, `src/**/*.test.ts`) | ^4.1.11. v5 needs Node 22.12+, and the repo supports Node 20.19. |
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
pnpm run typecheck               # tsc --noEmit for the game (includes the *.test.ts files)
pnpm test                        # Vitest unit tests (tracking math, flick detector, rings, damping, saved calibration)
pnpm run build                   # typecheck, then vite build -> artifacts/3d-game/dist/public
pnpm preview                     # serve the production build -> http://localhost:4173/
```

These are aliases for `pnpm --filter @workspace/3d-game run dev|build|serve|typecheck`. Both servers bind `0.0.0.0`. The dev server uses `strictPort`.

Results of a verification run (Linux x64, Node 22.22.2, pnpm 10.33.0, no `PORT`/`BASE_PATH`/`REPL_ID` set):

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm run typecheck` passes.
- `pnpm run build` succeeds from the root. It emits a 1.6 kB `index.html`, 72 kB of CSS (13 kB gzip; the `@font-face` rules), the self-hosted font files (woff2 + woff fallbacks; a page fetches only the ~6 latin woff2 it uses, ~140 kB), a 930 kB entry chunk (269 kB gzip: React, three, GSAP, the landing and the pre-flight/HUD UI), two lazy chunks (`handControls` 52 kB with the MediaPipe JS and the download meter, `GameEngine` 33 kB), and about 24 MB of MediaPipe files under `mediapipe/hands/`. Vite prints its "chunk larger than 500 kB" warning.
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
- The ring guidance + controls feel PR re-ran this headlessly (SwiftShader; harness notes in §11):
  - `pnpm test`: 80 Vitest tests pass (tracking math, flick detector at 30/60 Hz plus sparse 15–60 Hz tracks, rings, damping, saved calibration).
  - **Ring Challenge, keyboard mode, dev server:** screenshots of the arrow pointing at the highlighted next ring on both maps × all three skies. A missed ring (crossed 13 m outside the hoop) moved the target to the following ring on that frame, with the arrow's aim error easing 50° → 10° over ~0.25 s. A hard left bank from heading 000 to 195 stepped the target 3 → 4 → 5 → 6 → 7 as rings fell behind. The highlight was on exactly one ring on every frame.
  - **Simulated hand** (fake camera + stubbed `@mediapipe/hands`; tracker ~15 Hz in flight at 640×360): 5 of 5 half-box flicks fired, and the bird's pitch peaked at 0.02 during a flick. A brisk climb didn't fire and wasn't held (pitch reached 1.0). A fist close/hold/open changed pitch by 0.0000 (the palm shift is ~0.07 of pitch). A slow flick showed "Flick faster ↑". Calibration validation, drag-to-fix, saving, the saved-calibration skip (`CALIBRATION [SAVED]`), Recalibrate from the landing and from the pause menu (one WebGL context throughout), and the guide's Back to calibration all worked, with no console errors.
- The ocean overhaul PR re-ran this headlessly (SwiftShader, keyboard mode, 960×540, quality pinned; harness notes in §11):
  - `pnpm test`: 99 tests (adds the ocean height field and waves, the quality monitor and levels, and the saved quality).
  - Fixed spots above water, just below the surface looking up, on the seabed by an island and in open water, on all three skies, before vs after (High / Low). Sunset: draw calls 63 → 52 / 51 above water and 95–185 → 35–39 / 44–47 underwater; triangles 23k → 87k / 46k above and 19–28k → 78–92k / 35–42k below; worst `update()` in a 20 s boosted flight 17.3 ms → 5.3 ms (sunny 22.6 → 8.6, night 21.6 → 7.1): the old synchronous 7-tile rebuilds are gone. SwiftShader frame times went up (air 123 → 137 / 97 ms, underwater ~60 → 120–200 / 87–141 ms): it rasterises on the CPU, and the old underwater view was mostly an unlit, fogged sky dome, while now a lit seabed and reef fill the screen. Real-GPU frame rates are still to be checked (PR checklist).
  - Functional: dive and surface with real keys (sky/clouds hidden, fog, camera below the waves, night glow), the pause menu's Graphics switch (applies live and persists), Auto dropping to Low under SwiftShader and the menu showing "Auto · Low", Ring Challenge on the ocean, the landing's ocean chapter, two mountain sessions back to back (one live WebGL context after each), no console errors.
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
  - The fonts (Inter, Instrument Serif for display type, JetBrains Mono for HUD readouts) are **self-hosted** from `@fontsource` packages, so the game makes **no third-party request at all** (§12). Vite emits them as files (`assetsInlineLimit` never inlines `.woff`/`.woff2`, so the CSP's `font-src 'self'` holds).
  - If the files can't load, or the load (including the first frame through the graph) takes more than **30 s**, the startup screen shows a specific error with **Try Again**.
- A desktop Chromium, Edge or Firefox with a decent GPU is the target. Mobile isn't designed for: there's no touch fallback, and the layout assumes a large screen.
- In headless screenshot tools, WebGL often fails with no GPU. Launch Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader` to render, and expect very low FPS.

### Deploying

- **Vercel:** `vercel.json` at the repo root holds everything:
  - the framework preset is set to "Other" (`"framework": null`)
  - install and build use a pinned pnpm through `npx`
  - `outputDirectory` is `artifacts/3d-game/dist/public`
  - there's an SPA rewrite to `/index.html`; Vercel serves real files first, so assets are unaffected
  - the security headers on every response: Content-Security-Policy, Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, Cross-Origin-Opener-Policy (§12). `vite preview` reads and serves the same headers from `vercel.json`, so `pnpm preview` runs under the production policy.

  Leave the project's Root Directory as the repo root.
- **Replit:** `.replit` plus `artifacts/3d-game/.replit-artifact/artifact.toml` handle dev on port 24982 and a static production deploy from the same `dist/public`. That deploy does **not** send the security headers (§9 #30).
- **Any other static host:** run `pnpm run build`, publish `artifacts/3d-game/dist/public`, and add a catch-all rewrite to `/index.html`. The rewrite is optional, because there's no client router. Copy the headers from `vercel.json` into the host's config.

---

## 4. Repository map

```
.
├── artifacts/
│   └── 3d-game/               # ★ THE GAME (@workspace/3d-game) — the only workspace package
│       ├── .replit-artifact/artifact.toml   # Replit service config (port 24982, static deploy, SPA rewrite)
│       ├── index.html         # <title>, meta/OG description, favicon (no external links: fonts are bundled from main.tsx)
│       ├── vite.config.ts     # PORT/BASE_PATH defaults; Replit plugins only when REPL_ID is set; @ -> src
│       ├── vitest.config.ts   # unit tests only (no React/Tailwind/MediaPipe/Replit plugins); @ -> src
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
│           │   │                  #   keyboard input indicator, near-miss flick hint, NEXT RING distance, ? / Pause / Stop buttons
│           │   ├── PauseMenu.tsx  # pause menu: Resume / How to fly / Recalibrate (hand) / Back to landing, Steering, Graphics
│           │   ├── DebugOverlay.tsx # ?debug=flight numbers overlay (state, speed, yaw rate, bank, AGL, brake, FPS…)
│           │   ├── FlightGuide.tsx # "How to fly" guide: per-move cards for hand or keyboard, tips built from real constants
│           │   └── guideArt.tsx   # procedural SVG hand illustrations + animated keycaps (CSS keyframes in index.css)
│           ├── ui/
│           │   ├── hud.tsx        # CornerBrackets, Wordmark (shared instrument-frame pieces)
│           │   ├── SteeringControls.tsx # sensitivity slider + invert switch (landing chapter 4, pause menu)
│           │   └── privacy.tsx    # CAMERA_PRIVACY_NOTE, PrivacyNote (note + "Privacy" link), PrivacyPanel (stored data, Clear my data)
│           ├── landing/       # ★ the scroll-driven landing page ("The Ascent")
│           │   ├── Landing.tsx     # chapters, GSAP ScrollTrigger (scrub + snap), intro timeline, HUD, keys, sound toggle
│           │   └── content.ts      # chapter list, copy (bird personalities, world/sky details), formatters
│           └── game/          # ★ framework-free Three.js game code
│               ├── GameEngine.ts   # renderer, scene, loop, flight physics, camera, lighting/weather, underwater state machine
│               ├── LandingScene.ts # landing backdrop: scroll-progress-driven bird/camera/altitude, cloud deck, live swaps, dispose
│               ├── presets.ts      # MAP_OPTIONS, WEATHER_OPTIONS, WEATHER_LOOKS, OCEAN_LOOKS (shared by engine + landing); speeds and
│               │                   #   trick durations (shared by engine + guide); NEXT_RING_HIGHLIGHTS (engine + HUD)
│               ├── damping.ts      # damp(rate, dt) + perFrameRate(alpha, fps): frame-rate independent smoothing
│               ├── sky.ts          # sky dome / starfield / horizon-cloud builders (shared by engine + landing; clouds merged)
│               ├── settings.ts     # localStorage last-used settings ("bird-flight-settings", incl. control mode), validated
│               │                   #   on read; guide "Don't show again" per mode ("bird-flight-guide-dismissed"); the saved
│               │                   #   hand calibration ("bird-flight-calibration", validated on read)
│               ├── trackingShared.ts # TrackingStartError, sensitivity bounds, calibration types/limits, DEFAULT_BOX,
│               │                     #   flick/deadzone/fist thresholds (quoted by the guide); importable without MediaPipe
│               ├── trackingMath.ts # pure steering math: axisValue, applyDeadzone, applySensitivity, computeBox,
│               │                   #   validateCalibration (tracker, calibration UI, saved-calibration check, tests)
│               ├── flickDetector.ts # pure backflip detector (box-relative flick, near-miss coaching, pitch hold)
│               ├── handControls.ts # MediaPipe wrapper: load + frame loop, calibration box, fist gesture + steering guard,
│               │                   #   flick detector wiring (lazy-loaded)
│               ├── *.test.ts       # Vitest unit tests (next to the module they test)
│               ├── keyboardControls.ts # keyboard input → the same HandControlState (ramped axes, Space boost, Shift brake,
│               │                       #   F backflip; sensitivity scales the ramps)
│               ├── flightTuning.ts # ★ every tunable flight number: turn model, springs, brake, steering ranges, camera
│               ├── flightModel.ts  # pure flight maths: coordinated-turn rate, critically damped springs, stepTurn,
│               │                   #   visual bank, sensitivity scaling, hand expo, brake speeds, keyboard ramps
│               ├── brakeDetector.ts # pure hand air-brake gesture (palm size vs. calibration, hold + hysteresis)
│               ├── birdState.ts    # pure locomotion state machine: FLYING → FLARE → TOUCHDOWN → GROUNDED/FLOATING → TAKEOFF
│               ├── landingSurface.ts # pure landing surfaces (ground as drawn, water, PerchPoint), footprint, landing envelope
│               ├── landingCue.ts   # the touchdown reticle projected on the surface
│               ├── takeoffGesture.ts # pure hand raise-and-hold takeoff detector
│               ├── groundMotion.ts # pure GroundWalker: walking, turning, slope/step limits, jumps, ledges, beach ↔ water
│               ├── downloadMeter.ts # real download progress for MediaPipe's own fetch/XHR requests (used by handControls)
│               ├── bird.ts         # 4 procedural low-poly birds + wing flap
│               ├── terrain.ts      # Mountain Valley: streamed simplex-noise tiles
│               ├── oceanField.ts   # pure ocean height field: hashed islands, seabed dunes/rock, reef slopes, waves (CPU mirror
│               │                   #   of the water shader), seeded RNG (unit-tested)
│               ├── ocean.ts        # OceanManager: incremental tile streaming (ground mesh + depth-texture jobs), the water
│               │                   #   surface, island decor, horizon; land-first index ranges; underwater view switch
│               ├── waterSurface.ts # the single bird-following water mesh + shader (depth colour, Fresnel, glint, foam,
│               │                   #   underside/Snell's window) and the toroidal ground-height texture it reads
│               ├── oceanShaders.ts # shared ocean uniforms, caustics GLSL, patchOceanMaterial (caustics, sway/swim vertex
│               │                   #   code, night glow, fog early-out) for built-in Lambert materials
│               ├── oceanDecor.ts   # instanced palms/bushes/shore rocks per island; horizon silhouettes + fog apron
│               ├── oceanLife.ts    # dolphins (pooled leaps) and circling seabirds, one InstancedMesh each
│               ├── underwater.ts   # UnderwaterEnvironment: composes reef + sea life + fx, reef prefetch, dive seeding
│               ├── reef.ts         # 9 instanced reef species scattered per tile on the real ground (seeded, clustered)
│               ├── seaLife.ts      # fish schools (boids, 4 species), turtle, manta, shark, jellyfish; shader swim animation
│               ├── underwaterFx.ts # light shafts, marine snow (camera-wrapped in the vertex shader), round bubbles
│               ├── lowPoly.ts      # bake/merge helpers for vertex-coloured low-poly geometry (one draw per species)
│               ├── quality.ts      # Auto/High/Low quality profiles + AutoQualityMonitor (pure, unit-tested)
│               ├── dispose.ts      # disposeObjectTree (engine + landing teardown)
│               ├── clouds.ts       # flyable cloud clusters in the flight corridor
│               ├── rings.ts        # Ring Challenge spawning, hit test, next-ring selection + highlight
│               ├── ringGuide.ts    # arrow pointing (smoothly) at the next ring
│               ├── ringBurst.ts    # star-burst particles (custom ShaderMaterial)
│               ├── waterBurst.ts   # surfacing droplet particles (copy of ringBurst, retuned)
│               ├── splash.ts       # skimming spray particles (PointsMaterial – fade is broken)
│               ├── audio.ts        # WindAudio (filtered noise) + SoundEffects (ring chime)
│               ├── highscore.ts    # localStorage best score ("bird-flight-best-score")
│               └── storedData.ts   # registry of every localStorage key (Privacy panel), readStoredData, clearStoredData
├── attached_assets/           # the two feature-request prompts the user pasted into Replit Agent (history only)
├── .agents/memory/            # Replit Agent's lessons-learned notes (read these!)
├── .replit, .replitignore     # Replit workspace config
├── vercel.json                # Vercel static deploy config + security headers (also served by `vite preview`)
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
                                   {handDetected, pitch, roll, walk, boost, brake, takeoffHold, backflip,
                                    flickNearMiss, landmarks}
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
  7. Hold for `max(BOOT_READY_HOLD_MS 550, BOOT_MIN_DURATION_MS 1100 − elapsed)`. The minimum is 0 under reduced motion. This hold is the only added time in the whole boot: it lets the typed lines finish and READY register, and adds at most ~1.1 s.
  8. If `loadCalibration()` returns a valid saved calibration and the landing's **Recalibrate** didn't set `forceCalibrationRef`: apply it (`tracker.applyCalibration`, the calibration points ref, step 5, `calibrationRestored`), set the boot's calibration line to `saved`, and call `requestTakeoff()` (guide or straight to takeoff, from `'requesting'`). Otherwise switch to `'calibrating'`, starting from the saved sensitivity if there is one.

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
  | (engine constructor or `start()` threw, e.g. no WebGL, set directly in `handleStartFlying`) | `engine-start-failed` |

  Each kind has its own text in `STARTUP_ERROR_MESSAGES`. `needsReload` is set when a code chunk import failed (the engine, or the tracking module while `chunkImport` is true). Chromium caches a failed dynamic `import()` for the page's lifetime, so retrying in place can't work, and the boot HUD's button becomes **Reload page**.
- **Takeoff request.** Start Flying (through `handleCalibratedTakeoff`, which re-validates and `saveCalibration()`s the points and sensitivity first), the end of the keyboard boot, and the end of a hand boot with a saved calibration all call `requestTakeoff()`. It opens the guide (`guide = 'preflight'`) if `shouldAutoShowGuide(mode)`, otherwise calls `handleStartFlying()`. The guide's **Take off** stores "Don't show again" if ticked, then calls `handleStartFlying()`. Its **Back** in hand mode closes the guide and, if a saved calibration skipped the calibration screen (`flightState` still `'requesting'`), opens it (`'calibrating'`, with the saved box loaded). `startKeyboardPreflight` reaches `requestTakeoff` through `requestTakeoffRef`, since it's created first. `handleStartFlying` reads the bird/map/weather/rings/controls from `settingsRef.current`, never from its closure (a Quick start may have changed them). In keyboard mode it creates and starts `KeyboardControls` once `engine.start()` resolves.
- **Pause.** An effect keyed on `paused` calls `engine.setPaused()` and `keyboard.setPaused()`, and clears any flick hint. One window `keydown` handler takes Esc: it closes the guide (in pre-flight, as its Back), or toggles the pause menu in flight. The same handler opens the guide on `?`. A `visibilitychange` to hidden opens the pause menu. While paused the HUD is `inert`, and so is the pre-flight screen behind the pre-flight guide.
- **Recalibrate from the pause menu** (hand mode, `handleRecalibrate`): disposes the engine but keeps the session, the camera stream and the `HandTracker` (no session-id bump). It resets the HUD state and score, turns the landing backdrop back on (the engine's WebGL context is already released, so there's still one context), and switches to `'calibrating'` with the current points still loaded. Start Flying builds a new engine exactly like the first takeoff.
- **Calibration state in App.** Points live in `calibrationPointsRef` (the preview rAF and drag handlers read it). `calibrationProblems` (state plus a ref for the rAF) is recomputed with `validateCalibration(center, computeBox(corners))` on every capture, drag move and reset. `calibrationRestored` marks points loaded from storage, and `calibrationSaved` (re-read on returning to the landing) drives the landing's Recalibrate button.
- **Session ids guard async startup.** Each attempt takes `++sessionIdRef.current`, and `stopEverything()` also increments it. After every `await`, a superseded attempt (for example, the player pressed Back while the permission prompt was open) releases its own stream and tracker and returns without touching UI state.
- **One `HandTracker` per session.** It is created on the user click and reused through calibration and flight. Calibration state (center, box, sensitivity) lives **inside the tracker**. The engine only ever sees normalized `pitch`/`roll` in `-1..1`.
- **Engine options are fixed at construction.** Bird, map, weather and ring mode can't change mid-flight. Changing them means stopping and restarting.
- **Teardown.** A `pagehide` listener (registered whenever the state isn't `'landing'`) runs `handleBackToMenu()`, so closing or leaving the tab stops the camera explicitly and a back/forward-cache restore lands on the landing. An engine that can't be built or started (no WebGL) is caught in `handleStartFlying`: `resetTakeoff()` + `stopEverything()` and the `engine-start-failed` error (Reload page). `resetTakeoff()` also clears the GSAP lift on `[data-takeoff-lift]`, so a boot screen that stays mounted shows its error. `stopEverything()` bumps the session id, stops the tracker and the keyboard controls, disposes the engine, cancels the preview rAF, and stops the MediaStream tracks. Back and Stop Game both call it (`handleBackToMenu`, which also calls `resetTakeoff()` and turns the landing backdrop back on). `handleStartFlying` is guarded by `startingFlightRef`/`engineRef`, so a double click builds only one engine. It awaits the engine chunk **and** the takeoff launch animation together, checks the session id afterwards, and bails out if Back disposed the engine while `engine.start()` was awaiting. `resetTakeoff()` kills the takeoff timeline, hides the veil, and resolves the pending launch promise, so an interrupted launch never leaves `handleStartFlying` awaiting forever.
- **The landing backdrop (`LandingScene`)** is created by an effect in `App` while `landingBackdropOn` is true, and it stays alive behind the landing *and* the pre-flight screens (holding the "above the clouds" shot). In hand mode, while `flightState` is `'requesting'` (tracking loading) or `'calibrating'` it is **paused** (`setPaused(true)`): no update and no render, so it doesn't compete with MediaPipe on the main thread. Keyboard mode has no MediaPipe, so its short boot keeps the backdrop moving. Before freezing it cuts to the pre-flight shot and renders that one frame, which the canvas then holds. That matters for Quick start, which is pressed from the hero. It resumes on Back or on the error screen. `handleStartFlying` calls `disposeLandingScene()` **before** constructing `GameEngine`, so only one WebGL context is ever live. Returning from flight rebuilds it. If WebGL can't start, the constructor throws, the error is logged, and the page runs over the CSS sky gradient on `<html>`. App also keeps the backdrop's bird/world/sky in sync with `settings`, so a Quick start swap shows behind pre-flight.

---

## 6. How each system works

### 6.1 Rendering (`GameEngine.ts`)
- `WebGLRenderer({antialias, powerPreference:'high-performance'})`, with pixel ratio capped by the quality level (2 on High, 1 on Low, §6.13), sRGB output, and shadow maps on (`PCFShadowMap`: `PCFSoftShadowMap` is deprecated in r185 and fell back to it anyway).
- `PerspectiveCamera` with FOV 58, rising to 72 on boost (50 and 60 underwater), near 0.1, far 1200.
- **Sky.** An inverted sphere of radius 900 with vertex-color gradient from the `WEATHER_LOOKS` preset, plus 24 decorative cloud clusters. On Starry Night there's also a 900-point starfield that follows the bird on XZ. The sky sphere, the decorative cloud group (`skyClouds`) and the starfield all **follow the bird on XZ** every frame, so the world never flies out of the backdrop.
- **Fog.** One `FogExp2` object, mutated in place (never replaced): density 0.0068 above water. Underwater (ocean map) its colour and density come from `OCEAN_LOOKS` (§6.6), and the scene background becomes the fog colour.
- **Lights.** Hemisphere + ambient + a shadow-casting sun (1024² map, 180×180 frustum) that is **re-centered on the bird every frame**, plus an unshadowed fill light.
- **Weather.** `WEATHER_LOOKS` is one table holding sky colors, fog colors, and light colors and intensities. `OCEAN_LOOKS` (per sky) holds the water surface colours and the whole underwater look. On the ocean map `updateAtmosphere()` blends fog, background, hemisphere/ambient/sun between the two every frame (`underwaterBlend`, ~0.4 s), allocation-free.
- **Sky clouds** (`createSkyClouds`) are merged into one geometry: one draw call instead of ~100.
- **Teardown.** `dispose()` frees every geometry/material/texture (`disposeObjectTree`) and calls `renderer.forceContextLoss()`.
- **Shader precompile.** `start()` runs `renderer.compileAsync` (capped at 1.5 s) with the underwater scene made visible for that pass, under the takeoff veil, so the first dive doesn't hitch on shader compiles.
- **Screen effects.** The boost motion blur, the surfacing flash and the underwater tint are **CSS overlays in `App.tsx`**, not post-processing. There is no `EffectComposer`.

### 6.2 Flight physics and camera (`GameEngine.update`)
- **Every smoothing is frame-rate independent:** `value += (target - value) * damp(RATE, dt)` with `damp = 1 - exp(-rate·dt)` (`damping.ts`). Each rate is written as `perFrameRate(oldFactor, 60)`, so the feel at 60 FPS is exactly the old per-frame lerp, and 30/144 Hz now match it. Unit-tested in `damping.test.ts`.
- **The flight model lives in two modules** (§6.14): every number in `flightTuning.ts`, every formula in `flightModel.ts` (pure, unit-tested). The engine only wires them up.
- **Inputs are smoothed by critically damped springs** (`stepSpring`, exact closed form, frame-rate independent, ζ = 1): pitch (63% in 0.2 s) and the bank (0.15 s, inside `stepTurn`). Rolling out never overshoots past level (a guard stops a spring that would cross its target).
- **Steering and visual angles are separate.** Heading, the forward vector and movement use only the steering pitch and the turn state. The mesh rotation uses `visual*Angle`, which adds the 360° trick sweep. **Never merge these.** See `.agents/memory/decouple-visual-sweep-from-physics.md`.
- **Turning** (`stepTurn`): a coordinated turn. The yaw rate is `GAIN·tan(bank)/√(speed/9)` × the sensitivity's turn authority (√s) × a brake factor (1.1 in the air), clamped to 200°/s, then eased by a fast spring whose acceleration is capped at 400°/s². `headingYaw -= yawRate·dt`. The heading is locked (yaw rate 0) while a barrel roll is in progress. Banking never changes altitude: the model is kinematic, so a level turn holds its height exactly.
- **Visual bank** is up to ~60° flying and ~40° swimming (where the body yaws into the turn instead, `BODY_YAW_LEAD_WATER`); sensitivity scales it with the turn (capped at 70°). Max pitch is 38° × s^¼.
- **Speed.**
  - Base speed is 9 and boost is 20. Underwater they're 5 and 10.
  - Speed chases its target at `SPEED_RATE` (0.04 per frame at 60 FPS), or `UNDERWATER_SPEED_RATE` (0.02).
  - **Air brake:** target 4.5 (half of cruise; never below `MIN_FLYING_SPEED` 4) in the air, 3 swimming, at `BRAKE_SPEED_RATE`; in the air the bird also sinks `AIR_BRAKE_SINK` (1.5 m/s). Boost cancels it.
  - Collecting a ring adds a +7 pulse that decays at 9/s.
- **Altitude.**
  - Over solid ground (mountains or islands) the floor is `height + 3.5`.
  - **Islands are solid underwater.** While submerged, a move that would enter an island's footprint (`!isOverWater`) slides along the edge: it keeps only the X or only the Z part of the move, or blocks the horizontal move entirely. Before this, the solid-ground floor snapped the bird up through the surface.
  - Over open water the floor is the real seabed: `ocean.groundHeightAt(x, z) + SEABED_CLEARANCE` (1.2), so it follows the dunes, rocks and the reef slopes rising toward islands (the bird is eased up a slope near the shore, never snapped).
  - The ceiling is y = 140.
  - The bird starts at (0, 26, 0) heading +Z.
- **Camera** (`updateCamera`, allocation-free). Its yaw follows the heading on a critically damped spring (0.3 s), aimed into the turn by yawRate × 0.18 s (0.08 s under reduced motion), and is clamped to 35° from the heading so the bird never leaves the frame in a U-turn. Pitch, distance (6.5; 5 underwater; boost pulls it back 0.3 per m/s over cruise) and height (2.2; 1.7 underwater) have springs too. It looks 8 units ahead along its own direction, rolls with 22% of the bird's bank, and widens its FOV by up to 3° in tight turns; reduced motion: no roll, no turn or boost FOV kicks. It starts far and high (14 / 7) so takeoff still swoops in. On the mountain map and over islands it stays 0.8 above the ground. FOV chases at `FOV_RATE` (0.06).
  - **Ocean: the camera stays on the bird's side of the water** (`keepCameraOnBirdSide`): underwater it's kept 0.35 below the animated surface (`waterHeightAt`, the same waves the shader draws) and 0.6 above the seabed; above water it's kept 0.35 above the waves. The water is opaque, so without this a shallow-swimming bird would be hidden under it. The underwater look (fog, sky hidden, reef shown) therefore always matches the bird's `underwater` state.
  - The underwater switch uses the calm water level (0) ±0.4 hysteresis, not the waves, so skimming never flickers.
- **Hand loss.** On `handDetected: false`, `applyControls` first handles the backflip fallback. It then sets `targetPitch`/`targetRoll` to 0 and `boosting` and the brake to false, so the bird eases back to level cruise instead of latching the last input.
- **Steering settings** reach the engine at construction (`options.steering`) and live through `setSteering()`; invert flips the pitch input in `applyControls`. `setReducedMotion()` follows the OS setting live.
- **Timing.** A `THREE.Timer` (not the deprecated `Clock`), connected to the document so a hidden tab yields a zero delta; `loop` calls `timer.update().getDelta()`. `dt` is still clamped to 0.05 s, so below 20 FPS the simulation runs in slow motion.
- **Pause.** `setPaused(true)` cancels the rAF loop, so there's no update and no render and the canvas holds the last frame. It also suspends the wind `AudioContext`, and `applyControls` returns early (input can't steer, boost or start a trick behind the menu). `setPaused(false)` discards the paused time with `timer.reset()` and restarts the loop. A resize while paused re-renders the held frame once. Before `start()` has finished, `setPaused` only records the flag, and `start()` honors it (so two loops are never scheduled).
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
  4. Subtract the closed-fist offset (see **Fist steering guard**), then smooth with a frame-rate independent EMA, `damp(SMOOTHING_RATE, frameDt)` where the rate is the old 0.35 per frame at a webcam's 30 FPS. The EMA is **not updated** while the fist guard holds the steering sample.
  5. Map onto -1..1 **within the calibrated box** with `axisValue()`. Each side of the center uses its own asymmetric extent.
  6. Apply a normalized deadzone of 0.07 (7% of the calibrated half-range), rescaled so there's no jump at its edge.
  7. Apply the comfort expo, `expoCurve(v) = 0.65·v + 0.35·v³` (`HAND_EXPO`): small offsets turn gently, and with the turn model's tan(bank) the last 30% of the box gives more than half the full turn rate. The **sensitivity is no longer applied here**: it's a steering setting the engine applies to both inputs as turn authority (§6.14). (`applySensitivity` is kept in `trackingMath.ts`, unused, with its tests.)
  8. Feed the raw palm Y to the `FlickDetector`, which returns the pitch to output (the steering pitch, or the held pre-flick value).

  Before step 1's point is used for steering, it's **depth-corrected** for the air brake (`depthCorrected`): pushing the hand toward the camera moves its image away from the frame's center by the palm-size ratio, so the offset is divided by that ratio (only when > 1) and braking doesn't steer.

  The steering EMA (step 4) is the hand path's only low-pass: a time constant of ~77 ms at any tracker rate.

  Frame times come from `frameStartMs`, taken in `processFrame` when a new video frame is picked up, *before* `hands.send()`. So MediaPipe's variable inference time doesn't jitter the flick speeds or the EMA. The warm-up frame falls back to `performance.now()`.
- **Box calibration.**
  - `captureNeutralCenter()` and `captureCorner()` snapshot the smoothed point.
  - `computeBox()` (`trackingMath.ts`, pure) averages the two corners that share a side, so the left edge is the mean of `topLeft.x` and `bottomLeft.x`, and keeps a side at its default until both of its corners exist.
  - `setCorner()` sets a corner directly and backs the drag-to-fine-tune feature. `applyCalibration(data)` restores a saved center + 4 corners + palm size (the sensitivity is a steering setting now, read from `settings.steering`). `getCalibrationProblems()` runs `validateCalibration`.
  - Default box (`DEFAULT_BOX` in `trackingShared.ts`, also the calibration screen's ghost-reticle hints): x 0.24–0.76, y 0.28–0.72.
  - **Validation** (`validateCalibration`): the box must be at least `MIN_BOX_SIZE` (0.15 of the frame) on each axis, so an inside-out box with left and right swapped fails too. The center must sit inside it with at least `MIN_CENTER_MARGIN` (0.15 of the box's span) on every side. The problems are `box-too-narrow`, `box-too-short` and `center-outside`.
  - **Persistence** (`settings.ts`): `saveCalibration` writes `{version: 1, center, corners, sensitivity, handSize?}` to `bird-flight-calibration` at Start Flying (the sensitivity mirrors the steering setting, so older code still reads it). `loadCalibration` rejects anything that isn't four finite 0..1 corners plus a center, or that fails validation, clamps the sensitivity, and keeps `handSize` only if it's a sane number.
- **Air brake (palm pushed toward the camera)**, `brakeDetector.ts` (pure, unit-tested).
  - Palm size (`palmSize` in `trackingMath.ts`) is the mean side of the wrist / index-MCP / pinky-MCP triangle (aspect-corrected): it doesn't change when the fingers curl (a fist never reads as a push), and tilting the hand only makes it smaller.
  - The brake engages once the size has stayed ≥ `BRAKE_ENGAGE_RATIO` (1.25) × the calibrated size for `BRAKE_HOLD_MS` (150 ms), and releases below `BRAKE_RELEASE_RATIO` (1.15). Hand loss releases it.
  - The calibrated size is recorded at the **center capture** and saved as `handSize` in the calibration (optional field, same key, same version). Calibrations saved before it have none: the detector then takes the median of the first `BRAKE_BASELINE_MS` (2.5 s) of tracking, and brakes only after that.
- **Boost (fist).**
  - `fistRatio` is the mean fingertip-to-palm distance divided by the wrist-to-middle-MCP distance.
  - The fist closes below 0.62 and opens above 0.8, with 3 frames of hysteresis in each direction.
  - Hand loss resets `fistActive`, so boost can't come back latched when the hand reappears.
- **Fist steering guard** (`updateFistGuard`). Curling the fingers moves the knuckles, so the palm center shifts as a fist closes or opens (in the simulated hand, 0.016 of the frame, ~0.07 of a default half-box of pitch).
  - While the fist ratio changes faster than 1.5/s (measured over ≥ 60 ms), or the open/closed state is mid-hysteresis, the steering sample is **held**: the EMA isn't updated.
  - When the hand settles (90 ms without that motion), a *closing* transition stores the palm shift since the transition began (capped at 0.06 of the frame) as an offset, subtracted from the steering point while the fist stays closed. Opening clears it.
  - A hold never lasts more than 450 ms, and a hold that hit the limit isn't restarted until the fist motion stops, so steering can't freeze.
- **Backflip (upward flick)**, `flickDetector.ts` (pure, unit-tested at 15–60 Hz).
  - Everything is in **heights of the calibrated box** (`rawY / boxHeight`), not the camera frame, so the gesture scales with the range the player steers in.
  - The thresholds live in `trackingShared.ts` because the guide quotes them: `FLICK_WINDOW_MS` 250, `FLICK_MIN_RISE` 0.35 box, `FLICK_SPEED_SPAN_MS` 50, `FLICK_MIN_SPEED` 3.5 box/s, `BACKFLIP_COOLDOWN_MS` 1200.
  - Each sample gets a **short-span speed**: the rise over the most recent step back that spans ≥ 50 ms (2 frames at 30 FPS, 3 at 60), steady against single-frame jitter.
  - A backflip fires when, **over the 250 ms window**, the rise from its lowest point reaches 0.35 box **and** the peak of those speeds reaches 3.5 box/s. They're judged over the window, not on the same frame, because a flick's speed peaks mid-snap, before it has risen far enough. Requiring both on one frame made a 0.4-box flick at 60 Hz fire only 17 of 40 times.
  - Tuning (smooth snap of d box in T s peaks at ≈ 1.5·d/T): a natural half-box flick in 0.15 s peaks near 5 box/s and fires ~0.1 s in, every time from 15 to 60 Hz, even with ±10% frame jitter. A 0.2 s one fires reliably at webcam rates. Steering stays below the speed: center to the top edge in 0.35 s peaks ≈ 2.1, and even a full bottom-to-top sweep in 0.45 s (≈ 3.3) never fires at any rate. A closing fist moves the palm < 0.1 box. A threshold of 3.2 would let that 0.45 s sweep fire.
  - `FLICK_TIP_RISE` (½ box) and `FLICK_TIP_SECONDS` (0.2 s, derived as the longest a ½-box snap may take to reach the speed) are what the guide and the "Flick higher" hint recommend.
- **Pitch-spike suppression.** A flick is also a big, fast climb input. Once the current stroke's speed passes the near-miss bar (0.75 × 3.5 ≈ 2.6 box/s, above normal steering), the detector returns the pitch from just before the stroke instead of the live one.
  - A stroke that fired keeps the hold until 450 ms after it ends, which also covers the hand dropping back.
  - One that doesn't fire is released at its end, or 250 ms after it started, whichever is first, so a very fast steering sweep is delayed a fraction of a second at most.
  - The first ~50 ms before the hold engages still pass through. After the engine's orientation smoothing, the bird's pitch peaks at ~0.02 during a flick, versus > 0.5 without the hold.
- **Near-miss coaching** (`trackStroke` / `finishStroke`):
  - Each upward stroke of the raw Y (from when it starts rising by > 0.01 box between frames until it drops back 0.05 box or makes no new high for 120 ms) is scored once, when it ends.
  - A stroke that fired no backflip, rose ≥ 0.6 × 0.35 box within a window and peaked ≥ 0.75 × 3.5 box/s reports `flickNearMiss`. It's `too-slow` ("Flick faster ↑") if its speed fell further short than its rise, otherwise `too-short` ("Flick higher ↑").
  - Hints are rate-limited to one per 2.5 s and suppressed during the backflip cooldown. Steering (center to top in 0.35 s peaks ≈ 2.1 box/s) and jitter never trigger one.
  - App shows the hint for 1.8 s, only while flying and not paused.
  - **Fallback:** if the hand vanishes within 300 ms of a fast (≥ 3.5 box/s) upward stroke that had already risen half the minimum, the tracker emits `backflip: true` with `handDetected: false` (`FlickDetector.handLost`). `GameEngine.applyControls` checks `backflip` **before** its `if (!handDetected) return` guard, so don't reorder these. See `.agents/memory/gesture-fallback-before-detection-guard.md`.
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
  2. the box (dashed, faint fill), in the fault color when `overlay.invalid` (the finished calibration fails validation)
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
- **Tropical Ocean: the height field** (`oceanField.ts`, pure, unit-tested in `oceanField.test.ts`):
  - Islands: smoothstep domes on a 55-unit lattice, chosen by a deterministic `sin` hash (40% per cell), unchanged, so `isOverWater()` (the island footprint) is unchanged too.
  - Each island continues below the waterline as a **reef slope** (`ISLAND_SKIRT` 30 units): a shallow shelf, then a drop to the seabed, with rocky lumps mid-slope. So nothing floats: every island reaches the sea floor.
  - The **seabed** sits around y = −15 (two octaves of dunes ±1.5, fine ripples, lumpy rock patches from a thresholded noise).
  - `sample(x, z, out)` returns height, rockiness, "reef" context (1 on the slopes, 0 offshore) and shoreline distance, allocation-free. `groundHeight` is the solid ground; `surfaceHeight` = max(ground, water level) (the `heightAtWorld` contract); `waterHeight(x, z, t)` adds the waves.
  - **Waves** are a table of four directional sines (`WAVES`). `wavesGlsl()` generates the vertex shader's `oceanWaves()` from the same table, so the CPU mirror (skim spray, camera clamp) matches what's drawn. They're damped over the last 2.5 units of depth, so the water lies still on the beach.
  - The island cache is bounded (4096 cells).
- **Tropical Ocean: streaming and meshes** (`ocean.ts`, `waterSurface.ts`, `oceanDecor.ts`):
  - **Ground tiles** (7×7 around the bird, 120 units, 24 segments): the height field with vertex colours (green tops, dry and wet sand, pale seabed sand, rock, and pink coralline / green turf on the reef slopes). One patched Lambert material with caustics.
  - **Incremental streaming.** Crossing a tile boundary only queues work: per tile, a mesh job plus six ground-height-texture row jobs, nearest tiles first. Each frame runs jobs for at most `BUILD_BUDGET_MS` (1.5 ms), always at least one; the very first update builds everything synchronously (under the veil / landing intro). Pooled tile meshes stay hidden until rebuilt (`built`).
  - **Land-first index ranges.** Each tile's index buffer is rewritten with the triangles that reach above −0.9 first. Above water only that range is drawn (the seabed under the opaque sea costs nothing, and tiles with no land aren't drawn at all); underwater the full range is drawn, but only for the 3×3 tiles around the bird (visibility is ~60 units).
  - **The water surface** is **one** grid mesh (128 segments on High, 80 on Low; dense near the centre, ~1.5 units, sparse at the fogged rim) that follows the bird in 12-unit snaps, drawn first (`renderOrder −1`). Waves in the vertex shader (the old CPU `animateWater` vertex loop is gone; `animateWater(dt)` now only advances the shared `uTime`).
  - Its fragment shader colours by the **depth of the ground below**, read from a toroidal **ground-height texture** (512² R8, 2 units/texel, 1/8-unit steps; filled row by row by the streaming jobs): shallow turquoise → mid teal → deep blue, Fresnel toward the sky's reflect colour, a sharp sun glint, and broken, washing shore foam. **Seen from below** (`!gl_FrontFacing`): dark total-internal-reflection colour outside a ~49° Snell's window and a bright, shimmering window inside it, brightest directly above the bird.
  - **Fog early-out.** Fragments that are ≥ 99.6% fog (`(density·depth)² > FOG_CULL_EXPONENT` 5.5) write the fog colour and return, in the water shader and in every material patched by `patchOceanMaterial` (the horizon and the far reef cost almost nothing).
  - **Island decor** (`IslandDecor`): palms (curved trunk, drooping fronds that sway in the vertex shader), bushes and shore rocks, placed per island from a seeded RNG and cached per island (bounded). Three InstancedMeshes for every island within `decorRadius` (260 High / 190 Low), rebuilt every 30 units of travel. No shadow casting (the shadow pass would draw every instance again).
  - **Horizon** (`HorizonIslands`): 22 hazy silhouettes at 620–780 units plus a fog-coloured apron from 440 to 890 units, one mesh following the bird, so the horizon is one seamless haze. Hidden underwater.
  - `setSurfaceLook()` takes the water colours per sky (GameEngine from `OCEAN_LOOKS`; the landing blends them with its weather crossfade).
- **Above-water life** (`oceanLife.ts`): a pod of up to 3 dolphins leaps (3 arcs each, splashing via `WaterBurstEffect` and a quiet splash sound) every 7–15 s, 45–85 units ahead over water ≥ 6 deep, swimming across the bird's path; 8 seabirds circle 70–160 units away, gliding with bursts of wing beats (vertex shader). One InstancedMesh each; hidden and not updated underwater.
- **The shared map contract** is duck-typed rather than an interface or base class: `update(pos)` and `heightAtWorld(x, z)`. `OceanManager` adds `isOverWater`, `groundHeightAt`, `waterHeightAt`, `animateWater`, `setUnderwaterView`, `setQuality`, `setSurfaceLook`, `dispose`.
- **Underwater** (`underwater.ts` → `reef.ts`, `seaLife.ts`, `underwaterFx.ts`):
  - **Built with the engine** on the ocean map (hidden until a dive), so its shaders are precompiled at takeoff.
  - **Reef.** Nine species (branching, brain and fan coral, kelp, seaweed, anemones, rocks, starfish, shells), **one InstancedMesh each**, with a per-instance colour from a harmonious palette. Items are scattered per 120-unit tile on a jittered 2.7-unit candidate grid from a seeded RNG (the same reef every visit), sitting on the real ground height, clustered by a low-frequency noise, far denser on reef slopes (corals, anemones, fans) than offshore (kelp groves, seaweed, rocks on rock patches, sand life). Kelp is capped 1.6 below the surface. Only items within `reefRadius` (62 High / 50 Low) and under `reefDensity` (each item has a fixed random rank) are copied into the instance buffers, every 5 units of travel. Kelp, seaweed, fans and anemone tentacles sway in the vertex shader.
  - **Reef generation is prefetched**: whenever the bird is below 30 over the ocean, the 3×3 reef tiles around it are generated in half-tile jobs (~1 ms, 1.2 ms budget), only in frames where the ocean streamer is idle. A dive then only runs ≤ 6 ms of leftover work once.
  - **Creatures** (`seaLife.ts`): four fish species (sardines, yellow/blue tangs, clownfish, parrotfish; seven schools, 67 fish) flock with simple boids (cohesion toward a wandering school target, alignment, separation, a 6-unit flee from the bird, seabed/surface limits); school anchors lag behind the bird and re-form ahead when left > 60 units behind. A turtle, a manta and a shark are single merged meshes steered by `Cruiser` (orbiting the bird at their own distance and depth, keeping 9 units away). Nine jellyfish drift and pulse. **All body motion (tail wag, flippers, wing beats, bell pulse, tentacles) is in the vertex shader**; instance index comes from `gl_InstanceID`.
  - **Light** (`underwaterFx.ts`): animated **caustics** projected onto the ground and every reef/creature material (`oceanCaustic`: two layers of domain-warped sine ridges, bright at their zero crossings; upward-facing surfaces, below the water line, fading with depth), replacing the old floating hexagon rings. **Light shafts**: up to 8 soft open cones in one mesh, leaning away from the sun, swaying and pulsing, wrapped around the camera in the vertex shader and faded at the box edge. Replacing the old flat white strips.
  - **Particles**: 700 (High) / 260 (Low) marine-snow specks wrapped around the camera entirely in the vertex shader (some glow at night); 220 round, rim-lit bubbles (custom `ShaderMaterial`; the old `PointsMaterial` drew white squares), with a 46-bubble burst on each dive.
  - **The look** (`OCEAN_LOOKS`): always blue-teal water, darker and bluer with camera depth (16 units), the sky only tinting it (warmer at sunset; deep navy with bioluminescence at night: `uGlow` lights reef tips, fan rims, anemone tentacles, jellyfish and plankton). The sky dome, stars, sky clouds, flyable clouds, horizon, island decor and above-water life are hidden underwater (this was the source of the old purple/pink underwater colour and the floating teal shapes: the sunset sky dome and clouds fogged teal).
  - **Cheaper below the surface:** ground tiles stop receiving shadows (`receiveShadow` is a uniform, no recompile) and the shadow map isn't re-rendered (`shadowMap.autoUpdate = false`; refreshed on surfacing).
  - **Entry and exit.** The switch happens when the bird's depth below the calm water level crosses ±0.4 (hysteresis).

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
  - Clouds use the same two-part rule: past 60 axially, or more than 240 away. (The reef no longer spawns ahead of the bird; it's scattered per streamed tile, §6.6.)
- **On collect:**
  - score +1
  - a speed pulse
  - the chime
  - a star burst
  - `onScoreChange`, which calls `saveBestScoreIfHigher` on **every** ring
- `RingGuideArrow` floats above and ahead of the bird, in the highlight color, and turns toward `getNextRingPosition()` by slerping its quaternion (`damp(7, dt)`), so a retarget swings smoothly. It is modelled along local **+Z**: `Object3D.lookAt` (and `Matrix4.lookAt(target, eye, up)`, which it mirrors) turns a non-camera object's +Z toward the target. Before this, it was modelled along −Z and pointed *away* from the ring.
- **HUD readout.** `GameEngine.getNextRingDistance()` (straight-line, world units = meters) is written by the HUD's telemetry rAF under the ring score as `NEXT RING 84 m`, next to a marker in the highlight color; `—` when there's no target.

### 6.8 Audio (`audio.ts`)
- `WindAudio` plays 2 s of looping white noise through a lowpass filter and a gain node. Filter cutoff and gain follow a speed ratio that its own rAF feeds in with `setTargetAtTime`. Underwater (`setUnderwater`) it becomes a low muffled rumble (170–260 Hz), gliding faster (0.12 s time constant) for 0.6 s after the switch.
- `SoundEffects.playSplash('dive' | 'surface', volume)` plays swept band-passed noise (down for a dive, up when surfacing; dolphins use it at 0.12).
- `SoundEffects.playChime()` plays two sine tones, C6 then G6, with a quick attack and exponential decay.
- Two separate `AudioContext`s are created. The wind one starts in `engine.start()`, which runs from the **Start Flying** click and so satisfies the autoplay policy. `replit.md` says audio starts on "Continue", but that's outdated.

### 6.9 Particles
- **Bubbles and marine snow** live in `underwaterFx.ts` (§6.6), both custom `ShaderMaterial`s.
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
- **Settings.** `settings.ts` persists `{bird, map, weather, ringChallenge}` under `bird-flight-settings` when pre-flight begins, and validates every field on read. The landing starts from the saved choices, and **Quick start** uses them. With a saved hand calibration (`bird-flight-calibration`, §6.3), hand mode's Begin button reads "Camera · saved calibration", and a **Recalibrate hand controls** button under it begins pre-flight with `{recalibrate: true}`, which opens the calibration screen even though a saved calibration exists.

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

  It also drives the **LDG** annunciator (§6.15) from `engine.getLandingCue()` (toggling `data-state`, so no React render), and the hint under the heading tape follows the bird's state (`birdMode` from `onModeChange`): flight, landing, standing (walk/jump/takeoff keys or gestures), floating. A **Brake** badge joins Boost / Barrel Roll / Backflip / Diving.

  These use the new `GameEngine` getters: `getHeadingDegrees()` (0° is the start direction and right turns increase it), `getAltitude()` (the bird's Y), and `getSpeed()` (×1.944 to show knots). The splash and underwater overlays are unchanged. The old warm boost vignette is replaced by a HUD effect: masked conic speed streaks (opacity plus a compositor-only transform animation), a faint warm rim, and frame brackets that tighten and turn warm. Badges snap on and off with no color transition.
- **Takeoff.** `handleStartFlying` sets `launching` (which locks the calibration controls). It then awaits the engine chunk together with `playTakeoffLaunch()`: the panel lifts away, and the always-mounted pale veil (`takeoffVeilRef`, the landing intro's sky gradient, reading "Cleared for takeoff" and the bird, world and sky) fades to opaque. The landing scene is disposed and the engine built under the veil. Once `flightState` is `'flying'`, a layout effect fades the veil off the chase camera's swoop-in and staggers the `[data-flight-hud]` blocks in with `fromTo`. `clearProps` then removes GSAP's inline styles. Reduced motion uses plain crossfades.

### 6.12 Keyboard controls, pause menu and "How to fly" guide (`game/keyboardControls.ts`, `flight/PauseMenu.tsx`, `flight/FlightGuide.tsx`, `flight/guideArt.tsx`)
- **`KeyboardControls`** is framework-free and emits the same `HandControlState` through the same `handleControlState` callback as the tracker:
  - `handDetected` is always true, so the engine's hand-lost easing never applies.
  - `landmarks` and `flickNearMiss` are always null.
  - It reads `event.code` (physical keys), so WASD is ZQSD on AZERTY.
- **Keys:**
  - W/↑ climb, S/↓ dive, A/← bank left, D/→ bank right.
  - Bank ramps toward ±1 at 5/s (0.2 s to full), returns at 6/s and reverses at 9/s; pitch keeps 2.8/s up (~0.36 s), 4/s back, 6/s reversing (`KEY_*` in `flightTuning.ts`). The steering sensitivity scales every ramp by √s (`setSensitivity`, live). The rates are frame-rate independent (`rampAxis`), and a rAF emits only when something changed.
  - **Shift** (either) held = `brake`. No other binding uses Shift; the handler still ignores Ctrl/Alt/Meta combinations. Windows may offer Sticky Keys after five Shift presses in a row (an OS prompt, not the game).
  - On the ground W/S also arrive as `walk`, and Space held 0.4 s as `takeoffHold` (§6.16).
  - **Space** held = `boost`, so the engine's rising-edge barrel roll fires on each new press.
  - **F** = a one-shot `backflip` (key repeat ignored).
  - Handled keys `preventDefault` on keydown *and* keyup (Space activates a focused button on keyup), unless paused.
  - Window `blur` releases every key, and `setPaused` releases them and rests the axes at 0.
- **Pause menu** (`PauseMenu`): dark glass in the HUD style, with a flight summary (and ring score) and **Resume** (autofocused, shows `Esc`) / **How to fly** / **Back to landing**, then a **Graphics** radio group (Auto / High / Low; with Auto it shows the level in use, "Auto · Low"). GSAP fades it in unless reduced motion.
- **Guide** (`FlightGuide`):
  - Hand mode has 7 cards: Steer, Boost (close fist), Barrel roll, Backflip (quick upward flick), Air brake & tight turns (push your palm in), Land & take off, On the ground. Keyboard mode has 7: Steer (WASD/arrows), Boost + barrel roll (Space), Backflip (F), Air brake & tight turns (Shift), Land & take off, On the ground, Pause (Esc / ?). Turn rates, brake speeds and ground numbers in the copy are computed from `flightModel.ts` / `flightTuning.ts`.
  - Each card has an illustration, the input, one precise tip, and a small mono line with the exact numbers.
  - **Every number is computed from the real constants**: `trackingShared.ts` (deadzone, fist hold frames, flick and brake thresholds and the recommended `FLICK_TIP_RISE`/`FLICK_TIP_SECONDS`), `presets.ts` (speeds in knots, trick durations) and `flightTuning.ts` / `flightModel.ts` (ramps, turn rates, brake speed and sink). Change those constants, never the copy. The FlightHud "Flick higher" hint uses the same `FLICK_TIP_RISE` through `describeBoxFraction`.
  - The Backflip card: "Snap your open palm straight up about half the height of your calibrated box, in one quick motion of 0.2 s or less", with the spec "Needs ≥ 35% of your box within 250 ms, peaking > 3.5 box-heights/s · 1.2 s cooldown". Its art draws the calibrated box as a dashed rectangle, 54 units tall, so the 27-unit `ascent-guide-flick` travel reads as half of it. The Steer card says a corner is full deflection "at any sensitivity", and the Boost card says steering holds still while the fist closes.
  - **Buttons by origin:**
    - `'preflight'`: **Take off** (primary), **Back** (to calibration / to landing) and **Don't show again**
    - `'pause'`: **Back to pause menu**
    - `'hud'`: **Resume flight**
    - Esc acts as Back/close.
- **Illustrations** (`guideArt.tsx`) are inline SVG (a procedural hand glyph: finger rects that fold with `scaleY`, a thumb that rotates, a cyan palm-center dot) and HTML keycaps. They're animated only by the `ascent-guide-*` / `ascent-key-press` keyframes in `index.css`, with `transform-box: fill-box`. Under reduced motion every animation is paused on its telling pose: a per-illustration `--pose` negative delay.

---

### 6.13 Performance budget and the quality setting (`quality.ts`)
- **Budget.** Target 60 FPS on a mid-range laptop. Smoothness wins over visuals: a new effect must not raise draw calls noticeably (the ocean overhaul cut them: ~60 → ~45 above water, 97–192 → ~40–47 underwater) and must not add per-frame CPU work that scales with content.
- **Techniques in use** (follow them for new ocean content): InstancedMesh per repeated species/prop; merged static geometry (`lowPoly.ts`, `sky.ts`); all animation of shapes in vertex shaders from the shared `uTime`; per-instance distance culling by rebuilding instance lists every few units of travel; fog early-outs; land-first index ranges; incremental, time-budgeted streaming (`BUILD_BUDGET_MS`); prefetching the reef in idle frames; no allocations in hot loops (scratch vectors/matrices); shader precompile at takeoff.
- **Quality setting.** `QualitySetting` is `'auto' | 'high' | 'low'` (saved in `bird-flight-quality`, `settings.ts`); the rendered `QualityLevel` is `'high' | 'low'`. `QUALITY_PROFILES` sets: pixel ratio cap (2 / 1), reef density (1 / 0.5) and radius (62 / 50), fish density (1 / 0.55), marine snow (700 / 260), light shafts (8 / 4), caustics (on / off), decor radius (260 / 190), water grid (128 / 80) and shadow map size (1024 / 512).
- **Auto** starts at High. `AutoQualityMonitor` (pure, unit-tested) ignores the first 3 s and any frame over 0.25 s (hitches), then averages the real (unclamped) frame time over 4-second windows; the first window under 50 FPS drops the flight to Low for good (it never goes back up, to avoid oscillating). Pausing resets the window. The engine reports the drop through `onQualityChange`, and the pause menu shows it.
- `GameEngine.setQuality(setting)` applies a change live (pixel ratio, shadow map size, ocean and underwater profiles, caustics) and re-renders a held frame when paused. App keeps the setting in state + `qualityRef` and passes it at engine construction.

### 6.14 Flight tuning, steering settings and the debug overlay (`flightTuning.ts`, `flightModel.ts`, `ui/SteeringControls.tsx`, `flight/DebugOverlay.tsx`)
- **`flightTuning.ts` holds every tunable flight number**, commented with its why: the turn model (`TURN_BANK_MAX_DEG` 58, `CRUISE_TURN_RATE_DEG` 93, `TURN_REF_SPEED` 9, brake factors, `MAX_YAW_RATE_DEG` 200), spring response times (bank 0.15 s, yaw rate 0.06 s, pitch 0.2 s; `MAX_YAW_ACCEL_DEG` 400), attitude (pitch 38°, visual bank 60° / 40° swimming, body yaw), the steering ranges, keyboard ramps, the hand expo, the air brake, and the chase camera. Plain numbers, no three.js: the guide, the landing and the tests import it. Tune there, never inline.
- **`flightModel.ts`** is the pure maths: `turnRate`, `visualBank`, `maxPitchAngle`, `turnAuthority` (√s), `expoCurve`, `brakeSpeed`, the springs (`stepSpring`, `stepLimitedSpring`, `stepAngleSpring`, `springOmega` = 2.146 / response), `stepTurn` (the engine's whole turning step) and `rampAxis` (the keyboard ramp). `flightModel.test.ts` flies the same chain to check the 180° turn times, the sensitivity in keyboard mode, frame-rate independence and ≤ 2% roll-out overshoot.
- **Why √speed:** a real coordinated turn is `g·tan(bank)/v`, which gives 40°/s boosting and 180°/s braking. Softening the speed term to `1/√(v/9)` lands every target with one gain: cruise 93, boost 62, brake 145, swim 125, swim + brake 161 °/s (full input, default sensitivity).
- **Measured (headless Chromium, keyboard, sim time), 180° at full input:** cruise 6.76 → 2.27 s, boost 6.73 → 3.22 s, underwater 13.0 → 1.78 s; brake 1.61 s, underwater + brake 1.47 s; sensitivity 0.5x / 2x at cruise: 3.11 / 1.70 s. Roll-out overshoot 0 in every case; the camera trailed the heading by at most 16°.
- **Steering settings** (`SteeringSettings` in `settings.ts`: `sensitivity` 0.5–2.0, `invertPitch`) live inside the existing `bird-flight-settings` object (no new key). Settings saved before they existed load with defaults, except that the sensitivity is taken from the saved hand calibration (where the calibration slider used to keep it). Both apply to **both** control modes: sensitivity is turn authority (turn rate and visual bank ×√s, pitch range ×s^¼, keyboard ramps ×√s); invert flips climb/dive for keys and palm alike. **No steering setting is hand-only**; the only hand-only control is the calibration box itself (Recalibrate).
- **Where they're changed:** the landing's last chapter (saved with the other choices at Begin pre-flight), the pause menu (applied to the flight at once with `engine.setSteering` / `keyboard.setSensitivity`, and saved immediately), and the calibration screen's sensitivity slider (the same value).
- **Debug overlay:** `?debug=flight` in the URL (read once; nothing stored) shows state/substate, speed, yaw rate, bank, AGL, brake, surface slope, landable, the steering settings, FPS and draw calls, written into a `<pre>` ten times a second from `engine.getDebugInfo()`. Off by default.

### 6.15 Landing, standing, floating and takeoff (`birdState.ts`, `landingSurface.ts`, `landingCue.ts`, `takeoffGesture.ts`, GameEngine)
- **State machine** (`BirdStateMachine`, pure, `birdState.test.ts`): FLYING → FLARE → TOUCHDOWN → GROUNDED (or FLOATING on water) → TAKEOFF → FLYING. It only decides *when* to switch, from the inputs and facts the engine measures (`envelopeOk`, `approachOk`, AGL, surface kind); the engine runs the physics and the procedural animation for the current state. `allowsFlightTricks()` is FLYING only: boost, the barrel roll and the flying backflip are blocked in every other state (the engine checks it in `applyControls`). A boost input still held when TAKEOFF ends doesn't boost or roll until it's released (`boostSuppressed`).
- **Landing surfaces** (`landingSurface.ts`, pure): `heightFieldSurfaces` samples the ground **as drawn**: located in the map's tile grid (`groundGridSpacing`: 6 on the mountains, 5 on the ocean) and interpolated on the same triangles `PlaneGeometry` draws, with that triangle's normal (the smooth height function is up to ~2 m off on an island dome). On the ocean map water deeper than `MIN_FLOAT_DEPTH` (0.3) is water (`ocean.floatHeightAt`), and **rock tops are perches** (`PerchPoint`): computed once per island in `IslandDecor.buildIsland` by putting the rock geometry's own vertices through each rock's instance matrix (top, cap centroid and radius), cached with the island, queried with `perchesNear` (no raycasts). Trees and branches can be added later as more `PerchPoint`s. Out of scope: palm tops, the seabed, landing underwater.
- **Footprint:** the center plus 4 points 0.9 m out (`sampleFootprint`); `deviation` is how far they stray from the center's own plane, so an even slope is fine and a cliff edge or ledge isn't (`FOOTPRINT_MAX_STEP` 0.8). `isLandable`: slope ≤ 30° and no edge (a perch is always standable; water needs only no edge).
- **Landing envelope** (`evaluateLandingEnvelope`, every frame while flying; allocation-free): not underwater, not mid-trick, not too steep, no edge, feet ≤ `LANDING_MAX_AGL` (6 m) above the surface, flight path between −30° and +15°, speed ≤ brake speed + 1.2, **and the brake held**. The first failure is reported (the HUD shows "Brake to land", "Slow down", "Level off", "Descend").
- **Cue:** within `LANDING_CUE_AGL` (10 m) over landable surface the HUD's LDG block shows the AGL and the 3D reticle sits on the surface (pale; cyan once every condition holds or while landing).
- **FLARE** lasts `max(0.7, AGL / 3.2)` s (≤ 2.2): horizontal speed bleeds to 0.6 m/s and the body sinks to its rest height along (1 − u)², so the vertical speed is zero at contact. In its last 0.7 s: nose up 40°, wings forward and cupped with hard strokes, tail fanned down, legs swung forward, a whoosh. **Go-around** if the brake is released (or boost pressed), the bird goes underwater, or the surface below stops being landable: back to FLYING with a gentle climb for 1.2 s unless the player pitches.
- **TOUCHDOWN** (0.3 s; 0.15 under reduced motion): a squash (none under reduced motion), dust (mountains), grass dust or sand (islands; a softer thump on sand) or a splash on water, the body settling to 55% of the surface's tilt. The wings fold in two stages over 0.5 s from contact.
- **Standing (GROUNDED):** feet on the drawn ground (`Bird.standHeight` above it), breathing, the head looking around every 1.4–4 s, a wing ruffle every 6–12 s and a tail flick every 3–7 s (reduced motion: breathing only). **FLOATING:** the body rides `FLOAT_BODY_LIFT` above the drawn water, pitching and rolling with it (probed 0.6 m around), slow paddling.
- **Floating height is the drawn water exactly** (`WaterSurface.surfaceHeightAt`): each grid vertex around the bird is displaced the way the vertex shader does it (the shared `WAVES` table, damped by `smoothstep(0, WAVE_SHORE_DAMP_DEPTH, depth)` with the depth read from the same 8-bit ground texture, bilinear like the GPU: `GroundDepthTexture.sampleHeight`), at the shared `uTime`, then interpolated on the same triangle the GPU rasterises, on the current quality level's grid (128 or 80 segments). Waves are never switched off by quality; only the grid density changes, and the mirror follows it. `waterSurface.test.ts` pins all of this.
- **TAKEOFF** (1 s from the ground): a 0.12 s crouch, a jump (4.2 m/s up, 3 forward), 3–4 strong strokes with a sound each, legs tucking, then FLYING at ~7 m/s and a 22° climb that eases into cruise. From water: a 0.7 s run along the surface (pattering feet, small splashes) first. Inputs: keyboard **hold Space 0.4 s** (`takeoffHold` from `KeyboardControls`); hand **palm in the top 20% of the box for 0.5 s** (`RaiseHoldDetector`, tolerant of a < 0.25 s tracking dropout); floating, a **tap of Space or a fist**. Hand loss while standing or floating: it stays put and idles.
- **Camera on the surface:** closer (4.4 behind, 1.5 up); pitch follows level.
- **Integration:** Ring Challenge is unchanged (landing never scores; the next ring, the arrow and NEXT RING keep working while the bird is still: rings keep spawning ahead of its heading). Terrain streaming and the sky follow the bird in every state. Pause freezes every state (the machine isn't stepped), and Stop/Back work from all of them.

### 6.16 Ground locomotion (`groundMotion.ts`, `birdState.ts`, GameEngine)
- **Substates** (`BirdStateMachine.substate`, unit-tested): GROUNDED has IDLE, WALK, TURN, JUMP and GROUND_FLIP; FLOATING has IDLE and PADDLE. Transitions: the boost input's press → JUMP; pressed again while airborne from a JUMP → TAKEOFF from the air (`airStart`: no crouch, straight into strong strokes); the backflip input → GROUND_FLIP (at most once per `GROUND_FLIP_COOLDOWN` 0.8 s; not from a flip into a takeoff); `takeoffHold` → TAKEOFF from standing or mid-jump. What the walker reports drives the rest: `landed` → IDLE, `landed-water` → FLOATING, `landed-unstandable` and `ledge` → FLYING (event `glide`), `enter-water` → FLOATING, `exit-water` → GROUNDED. Floating: a boost press or `takeoffHold` → TAKEOFF from water; no jump or flip on water.
- **`GroundWalker`** (pure, `groundMotion.test.ts`) moves a point over the `LandingSurfaces` (so over the ground *as drawn*): walk 2 m/s forward, 0.8 back (`WALK_ACCEL` 7 m/s²), turn 90°/s on the spot or while walking; paddle 1 m/s, 0.4 back, 60°/s. The steering sensitivity scales the turn rates (√s). It stops (no jitter, no clipping) at slopes over 30° or steps up over `MAX_STEP_UP` (0.35 m: jump onto rocks and ledges), hops down drops over 0.3 m, reports a **ledge** when the ground `LEDGE_PROBE` (1.2 m) ahead is more than `LEDGE_DROP` (2 m) below the feet (the mesh draws a cliff as a 5–6 m-wide steep triangle, so a drop is a slope over ~60°), and reports wading into water ≥ 0.3 m deep or paddling onto a beach shallow and gentle enough. Jumps: gravity 11, launch 6.1 m/s (apex ~1.8 m; the ground backflip 6.6 m/s), gravity halved near the apex while the wings flutter; in the air it can't move into ground above its feet; it lands on whatever is below (a ledge, a rock top, the sea).
- **Engine:** `updateOnSurface` runs the walker for GROUNDED / FLOATING, copies its position and heading to the bird, and feeds its event to the state machine. Events: a jump or flip launches the walker (with a wing-stroke sound), a jump landing squashes softly (none under reduced motion) with a thump, a glide sets flying speed 6 m/s and a slight dive and lowers the flight floor to the bird (it relaxes back to 3.5 m), wading in splashes. Standing height (feet on the drawn ground, `settleOnSurface`) is skipped mid-jump, when the walker owns the height.
- **Animation:** walking swings the legs alternately (`STEPS_PER_SECOND` 4.2 at full speed), bobs the head like a pigeon and sways the body (no bob or sway under reduced motion), leaning into a curve; turning on the spot takes small stepping hops; jumps open the wings halfway with a fast flutter at the apex and dangle the legs; the ground backflip sweeps 360° of pitch in 0.9 s with strong strokes; paddling kicks faster and leaves small rippling rings of droplets every 0.4 s (a third `WaterBurstEffect` style).
- **Camera on the ground and water:** the surface chase camera (4.4 behind, 1.5 up, looking just past the bird) follows walking and turning with the same springs; after `CAMERA_IDLE_DELAY` (3 s) of standing or floating with no input it drifts at 14°/s to a 3/4 side view (125° round), and any input brings it back behind on a 0.35 s spring (no drift under reduced motion). It stays `CAMERA_SURFACE_CLEARANCE` (0.6) above whatever is drawn under it (ground, water, rock top).
- **Hand input on the ground:** the tracker emits `walk` = the palm's offset below the box center (after the deadzone and expo), so a palm low in the box walks forward, faster the lower it is; tilting left/right turns. There is no backward walking by hand. The fist (boost) jumps; a second fist while airborne takes off; the upward flick is the ground backflip (the same detector and thresholds as in flight); raising the palm into the top of the box and holding 0.5 s takes off. A fast raise into the top can also count as a flick (a backflip): raise it steadily.
- **Controls, both modes:**

  | | Keyboard | Hand |
  |---|---|---|
  | **Air:** climb / dive | W/↑ · S/↓ (swapped by Invert) | palm up / down in the box (swapped by Invert) |
  | bank and turn | A/← · D/→ | palm left / right |
  | boost + barrel roll | hold Space (each press rolls) | close your fist |
  | backflip | F | quick upward flick |
  | air brake (and land, low) | hold Shift | push your open palm toward the camera |
  | pause / guide | Esc / ? | Esc / ? (keyboard) |
  | **Ground:** walk | W/↑ forward, S/↓ back (slow) | palm low in the box (forward only) |
  | turn | A/D (on the spot or curving) | palm left / right |
  | jump | tap Space | close your fist |
  | take off | Space again in the air, or hold Space 0.4 s | fist again in the air, or palm in the top 20% for 0.5 s |
  | backflip | F | quick upward flick |
  | brake | — (Shift does nothing) | — |
  | **Water (floating):** paddle | W forward, S back (slow) | palm low |
  | turn | A/D | palm left / right |
  | take off (run) | tap or hold Space | fist, or raise and hold |

  Invert only swaps climb/dive in the air; walking and paddling keep W = forward and palm low = forward (inverting them would collide with the raise-and-hold takeoff).
- **Keyboard taps are latched:** a Space press is reported for at least one emission (`boostTapQueued`), so a quick tap jumps, rolls or takes off from water even when the key goes down and up between two frames.
- **Known limits (v1):** no landing on palm or tree tops, the seabed, or underwater; rock tops are perches but the bird can't walk up onto one (jump); creatures don't react to a standing bird; on the mountain map slopes rarely exceed 35°, so ledges (and glides off them) are mostly found on the steep island domes and tall rocks; no backward walking by hand; the ground is not slope-limited downhill below ~60° (it hops or glides); the walker samples the drawn ground at its center and footprint, so a very thin spike between samples could be stepped through.

## 7. Coding conventions and patterns

- **Keep game code framework-free.** Anything in `src/game/` is plain TypeScript and three.js with no React imports. React talks to it through constructor options, a few `get*/is*` getters, `applyControls()`, and callbacks.
- **Use one manager class per system**, with the same lifecycle: `constructor(scene)`, then `update(dt, birdPosition, forward, …)` every frame, then `dispose()`. `GameEngine.update` calls them in order. New systems should follow this shape.
- **Pool and stream around the bird.** Objects spawn ahead of the bird along `forward` and are reused through `visible = false` and a pool array. They're recycled once they're some distance *behind* along their spawn-time forward, **or** beyond a max distance from the bird. Always include the distance cap, or a U-turn can fill the pool with unreachable objects and stop spawning. Terrain and ocean tiles are keyed by `"x,z"` strings.
- **Tune with constants at the top of each file**, in `UPPER_SNAKE_CASE` with a comment explaining the *why*. Change these rather than inlining magic numbers.
- **Smoothing is per second, never per frame.** Use `x += (target - x) * damp(RATE, dt)` from `damping.ts`. When you port an old per-frame factor, write the rate as `perFrameRate(factor, referenceFps)` so its origin stays visible. For slerps, use `quaternion.slerp(target, damp(RATE, dt))`.
- **Keep testable logic pure.** Tracking math (`trackingMath.ts`), the flick detector (`flickDetector.ts`) and ring selection and hit tests (`rings.ts` exports) have no MediaPipe or DOM dependency, so Vitest can run them in Node. New gesture or scoring logic should follow that pattern and come with a `*.test.ts` next to it.
- **Generate assets procedurally.** Meshes are built from three primitives with `flatShading: true`, textures from `<canvas>`, and sound from Web Audio. There are no binary assets, and it's worth keeping it that way.
- **Comments are dense and explain intent**, often pointing to `.agents/memory/*`. Match that density in `src/game/`.
- **Style:**
  - 2-space indent, single quotes, semicolons, trailing commas, about 120 columns.
  - Prettier is installed but there's no config file, so defaults apply apart from the quote style already used in the code.
  - There's no ESLint. Unit tests are Vitest (`pnpm test`), for the pure modules only. There are no component or browser tests.
- **Imports.** Use the `@/` alias for `src`. Use `import * as THREE from 'three'`. Put `type` imports inline, as in `import { Bird, type BirdType }`.
- **React style.** One big `App` function component. Every handler is wrapped in `useCallback`. Refs mirror state that the long-lived tracker closure needs to read, such as `barrelRollingRef`. Styling is Tailwind utility classes with inline styles for gradients. There's no component library: the shadcn scaffold was removed. Theme tokens such as `bg-card` and `text-primary` still come from `index.css`.
- **Verification habit:** always run `pnpm test` and `pnpm run build` from the root (the build also typechecks, tests included), and check visual changes in a real browser with a webcam.
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
- **Ring guidance + controls feel PR:** the arrow pointed at the *nearest* ring (and, being modelled along −Z, actually pointed *away* from it); frame-rate-dependent lerps and `THREE.Clock` (#1, #16); the fist nudging steering, the flick pitch spike, unvalidated calibration and the sensitivity gain (#2); no tests (#20, partly); the frame-relative, window-averaged flick (#29).
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
1. ~~**Frame-rate-dependent feel.**~~ Every lerp is now `damp(rate, dt)`, tuned to match the old per-frame factors at 60 FPS (the tracker EMA at 30). Still open: `dt` is clamped to 0.05, so below 20 FPS everything runs in slow motion.
2. ~~**Gestures that interfere with steering.**~~ Fixed: the fist steering guard, flick pitch suppression, calibration validation, and the sensitivity response curve (§6.3). Remaining edge: the fist guard's closed-fist offset is capped at 0.06 of the frame, so a hand with a much bigger knuckle shift would still nudge steering by the excess. The flick hold lets the first ~50 ms of a flick's climb through (≈ 0.02 of pitch at the bird).
3. ~~**Reef items float mid-water.**~~ Fixed in the ocean overhaul: a streamed seabed, reef slopes under every island, and the reef scattered on the real ground height (§6.6). Remaining: reef items stand upright on slopes (not tilted to the ground normal), and the creatures' `Cruiser`s don't avoid islands (they're kept above the ground only).
4. The skimming splash particles don't fade (the `PointsMaterial` issue in §6.9).
31. **Landing, ground and hand gestures are verified headlessly and in unit tests only.** The brake gesture, the raise-and-hold takeoff and walking by hand have not been tried with a real webcam yet (see the PR checklist), nor in Safari.
5. **Surface-level island pop.** A bird skimming *above* the water that flies into an island is still lifted to `height + 3.5` in one frame. Near the shore that's about 3.5 units. Only the underwater case was fixed.

### Robustness and UX
6. ~~**No keyboard fallback, and no pause.**~~ Keyboard mode and the pause menu now exist. There is still **no touch or gamepad input**, so mobile is effectively unsupported.
7. ~~**Tall cards get clipped.**~~ Fixed in the landing redesign. The menu card is gone, and the pre-flight cards sit in `PreflightLayer` (a `fixed overflow-y-auto` scroller around a `min-h-full` flex box), so a tall card starts at the top and scrolls. At 1280×720 the two-column calibration card (522 px) fits without scrolling, and the landing chapters are `min-h-svh`, so they grow instead of clipping.
8. **Cryptic load-error detail.** When a MediaPipe file 404s, the detail under the friendly message is minified MediaPipe internals such as `TypeError: jt is not a function`. The friendly message is correct, but the detail line doesn't help users.
9. **The SPA rewrite hides missing MediaPipe files.** The SPA rewrites on Vercel and Replit return `index.html` for any missing file. If the `mediapipe/hands/` files were ever missing from a deploy, MediaPipe would receive HTML and fail. The startup error screen now reports this.
28. **A failed chunk import can't be retried in place.** Chromium caches a failed dynamic `import()` for the page's lifetime. So when the engine or tracking chunk fails to download, the boot HUD offers **Reload page** instead of Try Again. Other failures (camera, MediaPipe wasm/model loads) keep Try Again. Recovery after a denied camera is verified; recovery after a MediaPipe asset failure is not.
29. **Flick detection at low tracker rates.** The flick is reliable from 15 Hz up (unit-tested with ±10% frame jitter). Around 10 Hz a 0.15 s flick fires only about half the time, because a single 100 ms step averages away its peak speed, and slower (0.2 s) flicks need ≥ 30 Hz to be dependable. Headless SwiftShader in flight runs the tracker at ~15 Hz at 640×360, and at less at larger viewports.
30. **Security headers are Vercel-only.** `vercel.json` (and `vite preview`) send the CSP and the other headers; the Replit static deploy and the dev server don't. The game still makes no third-party requests there, but there's no CSP backstop.

### Performance
10. **The React app re-renders at the tracker rate.** `onUpdate` calls `setHandDetected`, `setBoosting` and `setStatusText` on every MediaPipe frame (about 30/s). Each call re-renders the whole `App` during flight. React bails out of identical values, but any change re-renders App and the HUD. The flight telemetry avoids this (refs plus rAF), and boot progress re-renders at most once per whole percent.
11. **Per-frame allocations.** `GameEngine.update`, the ocean, reef, sea life and underwater effects are now allocation-free in their per-frame paths. Rings, clouds, splash and the ring guide still create `new THREE.Vector3()` / `.clone()` in hot loops.
12. ~~**Leaky disposal.**~~ `GameEngine.dispose()` now frees every geometry, material and texture in the scene and calls `renderer.forceContextLoss()`.
13. ~~**Unbounded cache.**~~ The island cache (4096 cells), the island decor cache and the reef tile cache (30 tiles) are all bounded.
14. **Main-thread stutter.** The ocean now streams incrementally (≤ 1.5 ms of tile work per frame, §6.6), but the **mountain map's** `TerrainManager` still builds a whole row of 7 tiles in one frame. MediaPipe also runs on the main thread, alongside a WebGL render with PCF shadows.
15. **Large downloads.** The entry chunk is ~995 kB (290 kB gzip: React, three, GSAP, and the ocean surface/decor the landing scene uses). MediaPipe's JS and the engine are now split out and only loaded at pre-flight, but each session still downloads about 13 MB of MediaPipe files.

### three.js deprecations (seen in the console on r185)
16. ~~`THREE.Clock` is deprecated in favor of `THREE.Timer`.~~ `GameEngine` uses `THREE.Timer`.
17. `PCFSoftShadowMap` is deprecated in r185; both scenes now ask for `PCFShadowMap` directly (what it fell back to), so shadows are hard-edged PCF.

### Tech debt
18. **A god component and a god class.** The screens now live in `preflight/` and `flight/`, and canvas drawing in `handPreview.ts`. `App.tsx` still owns the tracker lifecycle, the calibration state machine, boot status and the takeoff timelines. `GameEngine.update` is a roughly 190-line function.
19. **Duplication.** `ringBurst.ts` and `waterBurst.ts` are near-copies. `TerrainManager` and `OceanManager` duplicate the tiling logic with no shared interface type.
20. **No lint and no CI.** Vitest now covers `axisValue`, `applyDeadzone`, `applySensitivity`, `computeBox`, `validateCalibration`, the flick detector (30/60 Hz and sparse 15–60 Hz tracks), the ring hit test and next-ring selection, `damp`, and saved-calibration loading. Still untested: ring despawn inside `RingManager.update`, the fist steering guard (it lives in `HandTracker`, which needs MediaPipe), and `classifyStartupError`. Nothing runs the tests automatically.
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

3. ~~Make all lerps frame-rate independent with `1 - Math.exp(-k * dt)`, and use `THREE.Timer`.~~ Done.
4. ~~While the fist is closing, freeze or hold the steering sample so boosting doesn't nudge steering.~~ Done (plus a closed-fist offset).
5. ~~Validate calibration and persist it in `localStorage` so returning players can skip it.~~ Done, with Recalibrate on the landing and in the pause menu. Still open: a "use default box" quick start for first-time players.
6. ~~Make flick detection relative to the calibration box size, and suppress the pitch spike it causes.~~ Done.
7. Migrate from the legacy `@mediapipe/hands` to `@mediapipe/tasks-vision` `HandLandmarker`, which is maintained, supports a GPU delegate, and can run in a worker.

**P2: performance**

8. Throttle React updates from the tracker, sending only changed values, or move HUD status into a ref plus a small subscribed component.
9. Remove per-frame `Vector3` allocations by using scratch vectors.
10. Dispose geometries, materials and textures properly, and call `forceContextLoss()` on engine teardown.
11. ~~Generate tiles incrementally and bound `islandCache`.~~ Done for the ocean (time-budgeted jobs). Still open: the mountain terrain, and moving generation to a worker.
12. ~~Code-split: lazy-load MediaPipe and the engine.~~ Done (both load at pre-flight). Still open: consider dropping the unused `hand_landmark_full.tflite` from the build, since `modelComplexity` is 0.

**P3: visuals and gameplay**

13. Fix the splash fade by reusing the burst `ShaderMaterial`, and deduplicate the burst classes into one configurable `ParticleBurst`.
14. ~~Add a real seabed mesh, anchor reef items to it, and add an underside water surface with a Snell's-window look.~~ Done in the ocean overhaul. Still open: let the terrain streamer use the same incremental job queue as the ocean.
15. Use real soft shadows (VSM, or PCF with a larger radius), and optionally postprocessing (bloom for rings and emissive reef, real motion blur).
16. Gameplay: timed ring runs, a combo multiplier, trick scoring, collectibles underwater, day and night that changes over time, and live weather switching.
17. Allow switching bird, map or weather without re-calibrating: keep the tracker and rebuild only the engine.

**P4: code quality**

18. Add a `MapEnvironment` interface for Terrain and Ocean, split `App.tsx` into screens and hooks (`useHandTracker`, `useGameEngine`), and break `GameEngine.update` into named steps.
19. ~~Add Vitest unit tests for the tracker math and ring hit tests.~~ Done (see §9 #20 for what's left: ring despawn, the fist guard, `classifyStartupError`). Add ESLint and Prettier configs, and a GitHub Actions workflow that runs `pnpm install --frozen-lockfile && pnpm test && pnpm run build` on Linux, macOS and Windows.
20. Unify the naming (Sky Soarer vs Bird Flight), keeping the localStorage key backward-compatible.

---

## 11. Gotchas for future changes

- **Privacy is a public claim; keep every part of §12 true.** No third-party URL anywhere (scripts, styles, fonts, images, analytics, CDNs); no `fetch`/XHR/WebSocket/beacon carrying camera frames, canvases or landmarks; a new `localStorage` key goes in `STORED_DATA` (`storedData.ts`, pinned by its test) with the `bird-flight-` prefix; never store an image or landmarks.
- **The CSP is strict** (`vercel.json`, §12): no inline `<script>`/`<style>` elements, no `eval`/`new Function`, no `data:` fonts, nothing cross-origin. Inline `style` *props* are fine (React and GSAP write them through the CSSOM). Run `pnpm build && pnpm preview` and watch the console for `Refused to …` after adding a dependency.

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
- Flick thresholds are in **box heights** (`rawY / boxHeight`), and the rise and peak speed are judged **over the window**, not on one frame. If you retune them, run `pnpm test`: `flickDetector.test.ts` pins both "a natural half-box flick fires every time at 15–60 Hz" and "a 0.45 s full-range steering sweep never fires". Keep `FLICK_TIP_*` clearing both thresholds with room to spare, since the guide and the hints quote them.
- Don't add per-frame lerp factors (`x += (t - x) * 0.05`). Use `damp(rate, dt)` (§7), or a critically damped spring (`stepSpring`) where overshoot matters.
- Flight numbers belong in `flightTuning.ts` and their formulas in `flightModel.ts`. The guide, the steering controls and the tests read both, so a retune updates the copy and is re-checked by `flightModel.test.ts`.
- New steering or ground settings go **inside** `SteeringSettings` / the settings object (validated in `readSteering`), never under a new localStorage key (§12).
- Anything the bird stands on must be read **as drawn**: ground through `meshGroundHeight` on the map's tile grid, water through `floatHeightAt` (the vertex-shader mirror), rocks through perches. If you change a tile's segment count, the water grid, the waves or the depth texture encoding, the landing surfaces follow only if they keep sharing those constants (`waterSurface.test.ts`, `landingSurface.test.ts`).
- Standing and floating heights are set in `settleOnSurface`, **after** `ocean.animateWater` and `environment.update` for the frame, so they match what's rendered. Don't move them earlier.
- The engine never knows the input type. Ground and takeoff controls arrive as semantic fields of `HandControlState` (`walk`, `brake`, `takeoffHold`) that each input computes its own way; a new input fills the same fields.
- Ground and landing logic is split three ways on purpose: **when** (`birdState.ts`), **where it can move** (`groundMotion.ts`, `landingSurface.ts`) and **what it looks like** (the engine + `bird.ts` poses). Keep the first two pure and tested.
- The ring guide arrow is modelled along **+Z** because `Object3D.lookAt` aims a non-camera object's +Z at the target. The target is the *next* ring (`RingManager.getNextRingPosition()`), never the nearest, and highlight colors live only in `NEXT_RING_HIGHLIGHTS`.
- Don't move the `state.backflip` check below the `handDetected` guard in `applyControls`.
- Don't re-throw from the per-frame `hands.send()` catch. Startup failures are different: `start()` surfaces them as `TrackingStartError` so the UI can show them.
- Don't reintroduce `@mediapipe/camera_utils` or a CDN `locateFile`. The app owns the single `MediaStream`, and MediaPipe files are self-hosted. When bumping `@mediapipe/hands`, change only `package.json`, then check that the file list the plugin emits still matches what the new version requests.
- After every `await` in the startup flow, check the session id (`isCurrent()`) and release anything acquired if the attempt was superseded.
- Every pooled spawner needs a max-distance despawn as well as the "behind" check (see §7). Watch the sign of axial distances: `delta = bird - item`, so an item the bird has passed is **positive**.
- Don't "fix" the mirrored overlay or drag math without reading the two canvas-mirror memory notes. The un-mirror at draw time and the *absence* of a flip in pointer handling are both intentional.
- To flip a bird's facing direction, change the yaw offset on the outer group, never the mesh (see `three-js-mesh-orientation-fix.md`).
- When adding a map, implement `update(position)` and `heightAtWorld(x, z)`. Add `isOverWater` if it has water, and wire it in the `GameEngine` constructor.
- **Ocean shaders.** New ocean materials go through `patchOceanMaterial` (built-in `MeshLambertMaterial`: flat-shaded low poly doesn't need PBR, and Lambert is much cheaper per pixel). Give each distinct vertex snippet its own `key` (it's the program cache key); materials that share a key must share the snippet, with differences only in uniforms. Transparent materials need `fogCull: false`. GLSL `smoothstep` with `edge0 > edge1` is undefined (SwiftShader and some GPUs disagree): write `1.0 - smoothstep(lo, hi, x)`.
- **Waves live in one table** (`WAVES` in `oceanField.ts`), turned into GLSL by `wavesGlsl()`. Change them there so the CPU `waterHeight` (camera clamp, skim spray) keeps matching the drawn surface.
- **The water is opaque.** Keep the chase-camera surface clamp (`keepCameraOnBirdSide`), and keep underwater-only objects in `UnderwaterEnvironment`'s root and above-water-only ones out of the underwater view (`setUnderwaterWorld`), or they'll show through / fog into odd teal shapes.
- **Quality changes must go through the profile.** New density or cost knobs belong in `QUALITY_PROFILES` (and the Low ≤ High test), applied in `GameEngine.applyQualityLevel`.
- The WebGL scene can't be verified in most headless screenshot sandboxes. Use a real browser, or SwiftShader flags as described in §3. The fonts are self-hosted, so screenshots need no network beyond the local server.
- **Driving calibration and flight headlessly** (no real hand available):
  - Override `navigator.mediaDevices.getUserMedia` with an init script that returns a `canvas.captureStream()`.
  - On the **dev server**, `page.route` the pre-bundled `/node_modules/.vite/deps/@mediapipe_hands.js` to a stub module. It must export `Hands` and `HAND_CONNECTIONS` both as named and default exports, because Vite's CJS interop reads them off the default export. The stub's `send()` reports synthetic landmarks you control.
  - Everything else (HandTracker math, App, engine) stays real.
  - Use the production preview with the real files to check the loading percentage.
- **Measuring the ocean headlessly:** pin the quality with `localStorage['bird-flight-quality'] = 'high'` (or `'low'`) before the page loads. Under SwiftShader's ~5–10 FPS **Auto drops to Low within seconds** (correctly), which silently turns caustics off and halves the reef. Run the harness against a Vite server started with `server: { hmr: false, watch: null }` (merge it over `vite.config.ts` in a throwaway config), so editing files mid-run can't give modules new `?t=` instances; restart that server after edits. Read `renderer.info.render` (calls/triangles, shadow pass included) inside a wrapped `GameEngine.prototype.update`. SwiftShader frame times are CPU rasterisation: they scale with shaded pixels (a lit seabed filling the screen costs far more than the old empty sky dome did) and overstate fragment cost versus a GPU, so compare draw calls, triangles and `update()` ms too, and verify the feel on a real GPU.
- **Flying headlessly in keyboard mode:**
  - Press real keys with `page.keyboard.down/up`.
  - To read the bird's state without adding debug code to the product, patch the engine from the page on the dev server. `import('/src/game/GameEngine.ts')` is the same module instance the app lazy-loads, so wrapping `GameEngine.prototype.update` to stash `this` on `window` exposes `bird.group.position`, `headingYaw`, `rings.getNextRingPosition()` and the `is*`/`get*` getters. A ring autopilot works from those.
  - SwiftShader runs at ~5 FPS at 1280×720 (the sim then runs at ~¼ speed). Shrink the viewport (e.g. 800×450) for physics and flick checks, and restore it for screenshots.
  - After a hint or overlay appears, wait ~0.7 s before a screenshot: its CSS fade-in hasn't produced a frame yet.
  - Playwright's role queries don't honor `inert`, so scope locators to the open dialog.
  - Near-miss and flick thresholds are best checked deterministically: `FlickDetector` is pure, so extend `flickDetector.test.ts` (synthetic tracks at any frame rate, with jitter). The fist guard still lives in `HandTracker`: to check it outside a browser, bundle `handControls.ts` with esbuild (`--alias:@mediapipe/hands=<stub>`, `--alias:virtual:mediapipe-hands-assets=<stub>`, `--define:import.meta.env.BASE_URL='"/"'`), stub `performance.now`, and call `handleResults` with synthetic landmarks.
  - In a browser, a simulated hand is easiest with Chromium's `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` plus the stubbed `@mediapipe/hands` deps module, whose `send()` evaluates a scripted `window.__handPose(now)` → `{x, y, closure}` and builds 21 landmarks from it (curl the fingertips toward the palm for a fist, and drop the MCPs slightly to reproduce the real palm-center shift). Wrap `HandTracker.prototype.handleResults` and `FlickDetector.prototype.update` from `import('/src/game/…')` to record outputs. After editing a module, restart the dev server before such runs: HMR gives edited modules `?t=` URLs, so a plain `import('/src/game/X.ts')` then gets a *second* module instance and the patches don't reach the app.

---

## 12. Privacy

The game is going public with privacy claims. This section is what the code guarantees, how it was verified, and what to keep true.

**The claims** (shown in the UI as `CAMERA_PRIVACY_NOTE`, `src/ui/privacy.tsx`): "Your camera never leaves your device. Hand tracking runs entirely in your browser, nothing is recorded or uploaded."

**Camera data stays in the page.**
- `App.handleContinueToCalibration` makes the only `getUserMedia` call (`{ video: 480×360, facingMode: 'user' }, audio: false`) and puts the stream on a hidden `<video>`.
- Frames go to `HandTracker.processFrame` → `hands.send({ image: video })`, i.e. the MediaPipe wasm in this tab. Landmarks come back through `onResults` and only ever reach `HandControlState` (engine steering, the preview canvas, HUD state).
- The two preview canvases (`drawHandPreview`) are drawn and never read back: no `toDataURL`, `toBlob`, `getImageData`, `captureStream` or `MediaRecorder` anywhere in `src/`.
- The only network code is `downloadMeter.ts`, which *observes* MediaPipe's own GET downloads under `mediapipe/hands/` while the model loads. There is no `WebSocket`, `sendBeacon`, `EventSource`, `RTCPeerConnection` or POST anywhere.

**Network.** Every request is a same-origin GET. Hand mode: `/`, the entry JS + CSS, ~6 woff2 font files, `handControls-*.js`, `damping-*.js`, `GameEngine-*.js`, and from `/mediapipe/hands/`: `hands_solution_packed_assets_loader.js`, `hands_solution_simd_wasm_bin.js`, `hands.binarypb`, `hands_solution_packed_assets.data`, `hands_solution_simd_wasm_bin.wasm`, `hand_landmark_lite.tflite`. Keyboard mode: the same minus `handControls` and everything under `mediapipe/`. No analytics, tracking, ads, CDNs or third-party scripts.

**Storage.** Only `localStorage`, all keys prefixed `bird-flight-` and listed in `STORED_DATA` (`src/game/storedData.ts`): `settings` (bird/map/sky/rings/input, steering: sensitivity + invert), `calibration` (5 points in 0..1, a sensitivity and the palm's apparent size, one number), `best-score`, `guide-dismissed`, `quality`. No cookies, sessionStorage, IndexedDB, Cache Storage or service worker. The **Privacy** panel shows each key with its raw value; **Clear my data** (`clearStoredData`) removes every `bird-flight-*` key and App resets its in-memory copies (`handlePrivacyCleared`).

**Camera lifecycle.**
- Requested only from the **Begin pre-flight** / **Quick start** / **Recalibrate hand controls** click (hand mode). Keyboard mode never calls `getUserMedia`.
- Stopped (`track.stop()` on every track) by: Back (boot, calibration, guide), Stop Game, Back to landing (pause menu), every startup error (`releaseLocal`), an engine load or start failure (`stopEverything`), a superseded attempt, unmount, and `pagehide` (tab close / navigation). Pause-menu **Recalibrate** keeps it on, deliberately (it goes straight back to the live calibration feed).

**Where the note and the panel appear.** `PrivacyNote` sits under **Begin pre-flight** on the landing's last chapter (hand mode: the camera sentence; keyboard mode: a no-camera sentence) and in the boot HUD while the browser asks for the camera (hand mode). Both have the **Privacy** link to `PrivacyPanel` (rendered by App, `privacyOpen`; Esc closes it, captured before App's own Esc handling; a takeoff closes it).

**Security headers** (`vercel.json`, every path; also served by `vite preview`):

| Header | Value | Why |
|---|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob: mediastream:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'` | Nothing can load from, or send to, another origin. `'wasm-unsafe-eval'` is the one relaxation: MediaPipe compiles its wasm (it needs no `unsafe-eval`; its loaders are same-origin `<script>` tags). `data:` images: the grain overlay's inline SVG. |
| Permissions-Policy | `camera=(self), microphone=(), geolocation=(), display-capture=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()` | Camera for this origin only (no iframe can use it); everything else off. |
| Referrer-Policy | `no-referrer` | No URL leaks to anyone. |
| X-Content-Type-Options | `nosniff` | |
| X-Frame-Options | `DENY` | Legacy twin of `frame-ancestors 'none'` (no clickjacking around the camera prompt). |
| Cross-Origin-Opener-Policy | `same-origin` | |

Vercel adds HSTS itself. Vercel *preview* deployments inject the Vercel toolbar (`vercel.live`), which this CSP blocks; that only affects previews.

**Verified** (privacy PR, headless Chromium + SwiftShader, fake camera, `pnpm preview` with the real headers and real MediaPipe files): 41 scripted checks, all passing. Landing, hand calibration, hand flight (saved calibration, three flights in one page), a blocked `.tflite`, WebGL refused at takeoff, keyboard flight and the Privacy panel: zero third-party requests, only GETs, no WebSocket/beacon/RTC, no CSP violations, no console errors; exactly one `getUserMedia` (video only, with user activation) per hand session and none in keyboard mode; zero live tracks after Back, Stop Game, Back to landing, the tracking error, the engine-start error and `pagehide`; storage holds only the listed keys; Clear my data empties them. `storedData.test.ts` pins the key list and that values stay small and image-free.
