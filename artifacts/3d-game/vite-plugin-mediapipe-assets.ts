import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Plugin } from 'vite';

// Self-hosts the MediaPipe Hands runtime files (wasm, packed graph data, .tflite models) that
// `Hands` fetches through `locateFile`. They're read straight out of the installed
// `@mediapipe/hands` package, so the version is pinned in exactly one place (package.json) and the
// game has no runtime CDN dependency. Must match `MEDIAPIPE_ASSET_DIR` in src/game/handControls.ts.
const PUBLIC_DIR = 'mediapipe/hands';

// Package files that MediaPipe never requests at runtime (`hands.js` is the bundled JS entry point).
const EXCLUDED_FILES = new Set(['hands.js', 'index.d.ts', 'package.json', 'README.md']);

// Virtual module exporting each served file's byte size, read from the same installed package. The
// tracker weights its loading percentage by these (see downloadMeter.ts), so the sizes follow the
// pinned version automatically. Typed in src/mediapipe-assets.d.ts.
const MANIFEST_MODULE_ID = 'virtual:mediapipe-hands-assets';
const RESOLVED_MANIFEST_ID = `\0${MANIFEST_MODULE_ID}`;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

function resolvePackageDir() {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve('@mediapipe/hands/package.json'));
}

function listAssetFiles(packageDir: string) {
  return fs
    .readdirSync(packageDir)
    .filter((file) => !EXCLUDED_FILES.has(file) && fs.statSync(path.join(packageDir, file)).isFile());
}

export function mediapipeAssets(): Plugin {
  const packageDir = resolvePackageDir();
  const files = new Set(listAssetFiles(packageDir));

  const sizes = Object.fromEntries([...files].map((file) => [file, fs.statSync(path.join(packageDir, file)).size]));

  return {
    name: 'mediapipe-assets',

    resolveId(id) {
      return id === MANIFEST_MODULE_ID ? RESOLVED_MANIFEST_ID : undefined;
    },

    load(id) {
      if (id !== RESOLVED_MANIFEST_ID) return undefined;
      return `export const MEDIAPIPE_FILE_SIZES = ${JSON.stringify(sizes)};`;
    },

    // Dev server: serve the files directly from node_modules (works under any BASE_PATH, since
    // only the trailing `mediapipe/hands/<file>` part of the URL is matched).
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const match = pathname.match(/\/mediapipe\/hands\/([^/]+)$/);
        if (!match || !files.has(match[1])) return next();
        const file = match[1];
        res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
        fs.createReadStream(path.join(packageDir, file)).pipe(res);
      });
    },

    // Production build: emit the files next to the bundle so any static host serves them.
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `${PUBLIC_DIR}/${file}`,
          source: fs.readFileSync(path.join(packageDir, file)),
        });
      }
    },
  };
}
