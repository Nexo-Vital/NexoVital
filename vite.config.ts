import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { devRealtimeRelay } from './vite-plugin-dev-realtime';

// HTTPS is opt-in only: geolocation needs a secure context on a phone, but the
// default `npm run dev` stays plain HTTP. `npm run dev:https` sets this to 1.
const useDevHttps = process.env.VITE_DEV_HTTPS === '1';

const maplibreDistDir = new URL('./node_modules/maplibre-gl/dist/', import.meta.url);

/** Worker entry + its sibling chunk, served from the app root in both modes. */
const MAPLIBRE_WORKER_ASSETS = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

/**
 * Serve MapLibre's runtime-constructed tile worker at the app ROOT in both modes.
 *
 * MapLibre resolves its worker AT RUNTIME by concatenating a filename onto
 * `import.meta.url`; the URL is never a static literal, so Vite cannot detect it
 * and never emits the file. The browser then requests `/maplibre-gl-worker.mjs`,
 * which 404s — no worker means no tile parsing and the vector basemap renders
 * blank. The worker is also NOT self-contained: it imports
 * `./maplibre-gl-shared.mjs`, so both files must be served from the SAME
 * directory. Serving them at the app root matches `MAPLIBRE_WORKER_URL` and keeps
 * the relative import intact.
 *
 * - build: `generateBundle` emits both files verbatim at the output root.
 * - serve: `configureServer` serves the same files from
 *   `node_modules/maplibre-gl/dist/` as `text/javascript`. Without it, dev falls
 *   through to Vite's SPA fallback, which answers with `index.html` (`text/html`)
 *   and leaves the vector basemap blank.
 *
 * The plugin intentionally omits `apply`, so each hook runs in its own mode and
 * dev and production expose the EXACT same URLs.
 */
function maplibreWorkerAssets(): Plugin {
  return {
    name: 'nexovital:maplibre-worker-assets',
    generateBundle() {
      for (const fileName of MAPLIBRE_WORKER_ASSETS) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(fileName, maplibreDistDir), 'utf8'),
        });
      }
    },
    configureServer(server) {
      const assetNames = new Set(MAPLIBRE_WORKER_ASSETS);
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        const pathname = (req.url ?? '').split('?')[0];
        const fileName = pathname.startsWith('/') ? pathname.slice(1) : '';
        if (!assetNames.has(fileName)) {
          next();
          return;
        }
        // Read as a Buffer so the response is byte-for-byte the installed file.
        const source = readFileSync(new URL(fileName, maplibreDistDir));
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Content-Length', String(source.byteLength));
        // Vendor files change when maplibre is upgraded; never let dev cache them.
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(source);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devRealtimeRelay(),
    maplibreWorkerAssets(),
    ...(useDevHttps ? [basicSsl()] : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // MapLibre GL v6 spawns its tile worker with
    // `new Worker(new URL('./maplibre-gl-worker.mjs', import.meta.url), { type: 'module' })`.
    // Vite's dependency pre-bundling rewrites that URL into `.vite/deps/`, where the worker
    // file does not exist -> it 404s and the vector basemap renders blank (satellite, being
    // raster, still works). Excluding both keeps the worker path intact in dev.
    exclude: ['maplibre-gl', '@maplibre/maplibre-gl-leaflet'],
  },
  server: {
    // Expose the dev server on the LAN so a phone can load it (same Wi-Fi).
    // Windows will prompt to allow Node through the firewall the first time.
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
});
