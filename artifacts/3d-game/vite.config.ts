import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { mediapipeAssets } from './vite-plugin-mediapipe-assets';

// PORT and BASE_PATH are injected by Replit (see .replit-artifact/artifact.toml); everywhere
// else (local dev, Vercel) they fall back to Vite's usual ports and a root base path.
const DEFAULT_PORT = 5173;
const DEFAULT_PREVIEW_PORT = 4173;
const DEFAULT_BASE_PATH = '/';

const rawPort = process.env.PORT;
const envPort = rawPort ? Number(rawPort) : undefined;

if (envPort !== undefined && (Number.isNaN(envPort) || envPort <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || DEFAULT_BASE_PATH;

// Replit-only dev tooling is loaded lazily and only inside a Repl, so the packages aren't
// needed (or even resolved) anywhere else.
const isReplit = process.env.REPL_ID !== undefined;
const isProduction = process.env.NODE_ENV === 'production';

const replitPlugins = isReplit
  ? [
      await import('@replit/vite-plugin-runtime-error-modal').then((m) => m.default()),
      ...(isProduction
        ? []
        : [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) => m.devBanner()),
          ]),
    ]
  : [];

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), mediapipeAssets(), ...replitPlugins],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port: envPort ?? DEFAULT_PORT,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port: envPort ?? DEFAULT_PREVIEW_PORT,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
