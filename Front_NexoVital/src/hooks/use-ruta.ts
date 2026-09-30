import { useEffect, useState } from 'react';
import { fetchRuta, type Ruta } from '@/features/mapa/routing-api';
import type { Ubicacion } from '@/types/domain';

/** Endpoints closer than this are the same point: there is no route to draw. */
const SAME_POSITION_EPSILON = 1e-6;

/**
 * Real street route between two positions (the assigned unit and the citizen).
 *
 * Returns `null` — and performs NO network call — when either position is
 * missing or the two are effectively identical. Any failure (timeout, non-`Ok`
 * code, malformed body) also resolves to `null` instead of throwing into render,
 * so the caller keeps the straight connector (AC3). A response that arrives
 * after the inputs changed is ignored, so stale coordinates can never overwrite
 * a newer route.
 */
export function useRuta(origen: Ubicacion | null, destino: Ubicacion | null): Ruta | null {
  const [ruta, setRuta] = useState<Ruta | null>(null);

  // Primitive dependencies: a fresh object literal on every render must not
  // re-trigger the effect while the coordinates are unchanged.
  const fromLat = origen?.lat ?? null;
  const fromLng = origen?.lng ?? null;
  const toLat = destino?.lat ?? null;
  const toLng = destino?.lng ?? null;

  useEffect(() => {
    // Clearing through an updater keeps the same state when there is nothing to
    // clear, so mounting the hook does not schedule an extra render.
    const clear = () => setRuta((current) => (current === null ? current : null));
    if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
      clear();
      return;
    }
    if (
      Math.abs(fromLat - toLat) < SAME_POSITION_EPSILON &&
      Math.abs(fromLng - toLng) < SAME_POSITION_EPSILON
    ) {
      clear();
      return;
    }

    let active = true;
    fetchRuta({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }).then(
      (next) => {
        if (active) {
          setRuta(next);
        }
      },
      () => {
        // A routing failure is not an error state: it is the honest fallback.
        if (active) {
          clear();
        }
      },
    );

    return () => {
      active = false;
    };
  }, [fromLat, fromLng, toLat, toLng]);

  return ruta;
}
