import { useEffect, useState } from 'react';
import { isDemoMode } from '@/services/apiClient';
import type { CentroAyuda, Zona } from '@/types/domain';
import { fetchMapa, mapaToCentros } from './map-api';

export interface MapData {
  /** Centers to draw: the fallback fixtures in demo mode, the backend's otherwise. */
  centros: CentroAyuda[];
  /** Active zones. Only the backend provides them; the fixtures declare none. */
  zonas: Zona[];
  /** True while the backend request is in flight (never true in demo mode). */
  loading: boolean;
  /** Honest failure message; the fixtures are NEVER substituted on error. */
  error: string | null;
}

const NO_DATA: MapData = { centros: [], zonas: [], loading: false, error: null };

/**
 * Resolves the map's zones and aid centers for the three role screens.
 *
 * The demo flag is the ONLY switch, the same discipline `apiClient` uses: with
 * the flag on it returns `fallbackCentros` (the fixtures, exactly as today) and
 * no network path runs; with the flag off it requests `GET /api/v1/mapa`. A
 * failed request is REPORTED, never replaced by fixtures — an unreachable
 * backend must not be faked with mock data.
 */
export function useMapData(fallbackCentros: CentroAyuda[]): MapData {
  const demo = isDemoMode();
  const [remote, setRemote] = useState<MapData>(() => ({ ...NO_DATA, loading: !demo }));

  useEffect(() => {
    if (demo) {
      return;
    }
    let active = true;
    setRemote((current) => ({ ...current, loading: true, error: null }));
    fetchMapa()
      .then((mapa) => {
        if (!active) {
          return;
        }
        setRemote({ centros: mapaToCentros(mapa), zonas: mapa.zonas, loading: false, error: null });
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setRemote({ ...NO_DATA, error: 'No se pudo cargar el mapa.' });
      });
    return () => {
      active = false;
    };
  }, [demo]);

  if (demo) {
    return { centros: fallbackCentros, zonas: [], loading: false, error: null };
  }
  return remote;
}
