import { useCallback, useEffect, useRef, useState } from 'react';
import { isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  getRealtimePort,
  type MapaElementoClase,
  type MapaElementoPayload,
  type RealtimePort,
} from '@/shared/realtime';
import type { CentroAyuda, Ubicacion, Zona } from '@/types/domain';
import { fetchMapa, type MapaCentroDto, mapaToCentros } from './map-api';

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

/**
 * The map read-model plus an on-demand refresh.
 *
 * The snapshot also carries each center's active shortage alert, whose activity
 * is a function of current stock. The inventory channel says WHEN stock changed
 * but does not carry alerts, so the owner of this hook calls `refresh` on an
 * inventory event to bring the alert projection back in sync without a reload.
 */
export interface MapDataResult extends MapData {
  refresh: () => void;
}

const NO_DATA: MapData = { centros: [], zonas: [], loading: false, error: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUbicacion(value: unknown): value is Ubicacion {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.lat === 'number' && typeof value.lng === 'number';
}

function isClase(value: unknown): value is MapaElementoClase {
  return value === 'ZONA' || value === 'CENTRO';
}

/**
 * Guards the wire element: it must carry the identity every map element shares
 * (`clase`, `id`, `nombre`, `ubicacion`). The class-specific fields
 * (`contorno`/`zonaId`/`tipo`) stay optional, so a missing one paints nothing
 * instead of rejecting the whole frame.
 */
function isElemento(value: unknown): value is MapaElementoPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isClase(value.clase) &&
    typeof value.id === 'string' &&
    typeof value.nombre === 'string' &&
    isUbicacion(value.ubicacion)
  );
}

/**
 * Upsert by identity: create when the id is unknown, merge in place when it is
 * already present. Mirrors the `fleet-store`/`emergency-store` upsert rule.
 */
function upsertById<T extends { id: string }>(items: T[], incoming: T): T[] {
  const index = items.findIndex((item) => item.id === incoming.id);
  if (index === -1) {
    return [...items, incoming];
  }
  const next = items.slice();
  next[index] = { ...next[index], ...incoming };
  return next;
}

/**
 * Reuses the REST mapper for a CENTRO element (FM-3): the element is wrapped in
 * the `MapaResponse` shape `mapaToCentros` expects, so there is no second mapper
 * to drift from `GET /api/v1/mapa`.
 *
 * The wire marks `tipo`/`zonaId` optional (they only exist on CENTRO) while the
 * REST DTO declares them required. Both survive the mapper now: `tipo` IS
 * carried through `toTipoCentroAyuda`, and `zonaId` is preserved, so a center
 * without a zone draws none instead of an invented one.
 */
function toCentro(elemento: MapaElementoPayload): CentroAyuda {
  const dto = {
    id: elemento.id,
    nombre: elemento.nombre,
    tipo: elemento.tipo ?? '',
    zonaId: elemento.zonaId,
    ubicacion: elemento.ubicacion,
  } as MapaCentroDto;
  const [centro] = mapaToCentros({ zonas: [], centros: [dto] });
  return centro;
}

/**
 * A ZONA element is a zone plus the wire discriminator, so only the zone's own
 * fields are kept: the `clase` tag must not leak into the domain list.
 */
function toZona(elemento: MapaElementoPayload): Zona {
  return {
    id: elemento.id,
    nombre: elemento.nombre,
    ubicacion: elemento.ubicacion,
    ...(elemento.contorno === undefined ? {} : { contorno: elemento.contorno }),
  };
}

/** Applies one upsert frame. A ZONA is already a `Zona`; a CENTRO goes through the mapper. */
function applyElemento(current: MapData, elemento: MapaElementoPayload): MapData {
  if (elemento.clase === 'ZONA') {
    return { ...current, zonas: upsertById(current.zonas, toZona(elemento)) };
  }
  return { ...current, centros: upsertById(current.centros, toCentro(elemento)) };
}

/**
 * Reduces one /topic/map.events frame onto the current state. The key is
 * `clase:id` (FM-4): zones and centers live in separate lists, so a ZONA and a
 * CENTRO that share an id never overwrite each other. A frame with an unexpected
 * shape is discarded unchanged, the same way the fleet/emergency consumers do.
 */
function applyMapaPayload(current: MapData, payload: Record<string, unknown>): MapData {
  if (payload.type === 'mapa.elemento.upsert') {
    return isElemento(payload.elemento) ? applyElemento(current, payload.elemento) : current;
  }
  if (payload.type === 'mapa.elemento.delete') {
    const clase = payload.clase;
    const id = payload.id;
    if (!isClase(clase) || typeof id !== 'string') {
      return current;
    }
    if (clase === 'ZONA') {
      return { ...current, zonas: current.zonas.filter((zona) => zona.id !== id) };
    }
    return { ...current, centros: current.centros.filter((centro) => centro.id !== id) };
  }
  return current;
}

/**
 * Resolves the map's zones and aid centers for the three role screens.
 *
 * The demo flag is the ONLY switch, the same discipline `apiClient` uses: with
 * the flag on it returns `fallbackCentros` (the fixtures, exactly as today) and
 * no network path runs; with the flag off it requests `GET /api/v1/mapa` and
 * subscribes to `/topic/map.events` on top of that snapshot (FM-2).
 *
 * The subscription is the receiving half: the snapshot gives late joiners the
 * current state and every later delta is UPSERTed in place. The port is injected
 * for tests; when omitted it resolves `getRealtimePort()` lazily INSIDE the
 * effect — and only off demo mode — so demo mode never even constructs a
 * transport.
 */
export function useMapData(fallbackCentros: CentroAyuda[], port?: RealtimePort): MapDataResult {
  const demo = isDemoMode();
  const [remote, setRemote] = useState<MapData>(() => ({ ...NO_DATA, loading: !demo }));
  // Monotonic id of the latest snapshot read: a response from an older read (or
  // from an unmounted hook) is discarded instead of overwriting newer state.
  const readId = useRef(0);

  // Snapshot half: reads `GET /api/v1/mapa` and maps it into the domain. Exposed
  // as `refresh`, and re-run by the effect below on mount and on a demo flip.
  const load = useCallback(() => {
    if (demo) {
      return;
    }
    const runId = readId.current + 1;
    readId.current = runId;
    setRemote((current) => ({ ...current, loading: true, error: null }));
    fetchMapa()
      .then((mapa) => {
        if (readId.current !== runId) {
          return;
        }
        setRemote({ centros: mapaToCentros(mapa), zonas: mapa.zonas, loading: false, error: null });
      })
      .catch(() => {
        if (readId.current !== runId) {
          return;
        }
        setRemote({ ...NO_DATA, error: 'No se pudo cargar el mapa.' });
      });
  }, [demo]);

  useEffect(() => {
    if (demo) {
      return;
    }
    load();
    return () => {
      // Invalidate any in-flight read when the hook unmounts or the mode flips.
      readId.current += 1;
    };
  }, [demo, load]);

  // Subscription half: the snapshot gives late joiners the current state and
  // every later delta is UPSERTed in place. Kept apart from the snapshot read so
  // `refresh` never drops the live subscription (which would miss any event
  // published during the re-subscribe gap).
  useEffect(() => {
    if (demo) {
      return;
    }
    const realtime = port ?? getRealtimePort();
    return realtime.subscribe(DESTINATIONS.mapa, (payload) => {
      if (!isRecord(payload)) {
        return;
      }
      setRemote((current) => applyMapaPayload(current, payload));
    });
  }, [demo, port]);

  if (demo) {
    return { centros: fallbackCentros, zonas: [], loading: false, error: null, refresh: load };
  }
  return { ...remote, refresh: load };
}
