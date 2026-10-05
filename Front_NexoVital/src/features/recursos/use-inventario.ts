import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDemoMode } from '@/services/apiClient';
import type { RealtimePort } from '@/shared/realtime';
import { useRealtimeReconnect } from '@/shared/realtime/use-realtime-reconnect';
import type { CentroAyuda } from '@/types/domain';
import { fetchInventario } from './inventory-api';
import { useInventarioStore } from './inventory-store';
import { useAlertasEscasezSync } from './use-alertas-escasez-sync';
import { useSuministrosSync } from './use-suministros-sync';

/**
 * Carga el inventario de cada centro en el estado compartido y lo mantiene vivo:
 * con la bandera de demo apagada pide `GET
 * /api/v1/centros-acopio/{id}/inventario` una vez por centro y se suscribe a
 * `/topic/suministros`; con ella encendida NO HACE NADA (ni petición ni
 * transporte) y deja intactos los items de los fixtures que ya trae el mapa.
 *
 * Una lectura fallida no se falsea: el centro conserva sus items actuales, que
 * en modo backend significa "nada declarado todavía".
 *
 * `onReadModelChange` se dispara tras cada UPSERT de `/topic/suministros` y tras
 * cada frame de `/topic/alerts`: el consumidor puede re-leer la proyección de
 * alertas del mapa, que depende del stock o de una demanda rechazada pero no
 * viaja por el canal de inventario.
 */
export function useInventario(
  centros: CentroAyuda[],
  port: RealtimePort | null,
  onReadModelChange?: () => void,
): void {
  const demo = isDemoMode();
  const hydrate = useInventarioStore((state) => state.hydrate);

  // Lista de ids memoizada: el efecto debe correr cuando un centro aparece o se
  // va, nunca en cada render.
  const centroIds = useMemo(() => centros.map((centro) => centro.id).join(','), [centros]);
  const loaded = useRef<Set<string>>(new Set());

  useSuministrosSync(demo ? null : port, onReadModelChange);
  // Un despacho RECHAZADO no mueve el stock (el CAS revierte), pero deja o sube
  // una alerta que solo `GET /api/v1/mapa` proyecta: este canal es la señal para
  // volver a leerla, en vivo, sin esperar a un movimiento de inventario.
  useAlertasEscasezSync(demo ? null : port, onReadModelChange);

  // `/topic/suministros` no reenvía lo publicado mientras el canal estuvo caído.
  // Al volver la conexión se olvidan los centros ya leídos y se vuelve a pedir el
  // inventario de todos, para que el semáforo no se quede con un stock viejo.
  const [reconexiones, setReconexiones] = useState(0);
  const recargar = useCallback(() => {
    loaded.current.clear();
    setReconexiones((actual) => actual + 1);
  }, []);
  useRealtimeReconnect(demo ? null : port, recargar);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reconexiones` es el disparador de la relectura tras reconectar.
  useEffect(() => {
    if (demo || centroIds === '') {
      return;
    }
    for (const centroId of centroIds.split(',')) {
      if (loaded.current.has(centroId)) {
        continue;
      }
      loaded.current.add(centroId);
      fetchInventario(centroId)
        .then((items) => hydrate(centroId, items))
        .catch(() => {
          // Permite reintentar, ante un cambio de ids, un centro cuya lectura falló.
          loaded.current.delete(centroId);
        });
    }
  }, [demo, centroIds, hydrate, reconexiones]);
}
