/// <reference types="@cloudflare/workers-types" />
import { REALTIME_PATH } from '../src/shared/realtime/messages';

export { RealtimeRoom } from './realtime-room';

interface Env {
  /** Static assets binding for the built SPA (see wrangler.jsonc). */
  ASSETS: Fetcher;
  /** Durable Object namespace backing the realtime relay. */
  REALTIME: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === REALTIME_PATH) {
      // One named instance so every browser shares a single room. Demo scale only.
      const id = env.REALTIME.idFromName('nexovital-crue');
      return env.REALTIME.get(id).fetch(request);
    }
    // Everything else is the SPA; the assets binding applies the
    // single-page-application fallback configured in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
