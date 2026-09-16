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

/**
 * Copy MapLibre's runtime-constructed tile worker into the build output ROOT.
 *
 * MapLibre resolves its worker AT RUNTIME by concatenating a filename onto
 * `import.meta.url`; the URL is never a static literal, so Vite cannot detect it
 * and never emits the file. In the built app the browser then requests
 * `/assets/maplibre-gl-worker.mjs`, which 404s — no worker means no tile parsing
 * and the vector basemap renders blank. The worker is also NOT self-contained:
 * it imports `./maplibre-gl-shared.mjs`, so both files must be served from the
 * SAME directory. Emitting them at the output root matches the app's
 * `MAPLIBRE_WORKER_URL` and keeps the relative import intact.
 */
function maplibreWorkerAssets(): Plugin {
  return {
    name: 'nexovital:maplibre-worker-assets',
    apply: 'build',
    generateBundle() {
      for (const fileName of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(fileName, maplibreDistDir), 'utf8'),
        });
      }
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
