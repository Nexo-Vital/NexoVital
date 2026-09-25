import { useEffect, useMemo, useRef } from 'react';
import { isDemoMode } from '@/services/apiClient';
import type { RealtimePort } from '@/shared/realtime';
import type { CentroAyuda } from '@/types/domain';
import { fetchInventario } from './inventory-api';
import { useInventarioStore } from './inventory-store';
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
 */
export function useInventario(centros: CentroAyuda[], port: RealtimePort | null): void {
  const demo = isDemoMode();
  const hydrate = useInventarioStore((state) => state.hydrate);

  // Lista de ids memoizada: el efecto debe correr cuando un centro aparece o se
  // va, nunca en cada render.
  const centroIds = useMemo(() => centros.map((centro) => centro.id).join(','), [centros]);
  const loaded = useRef<Set<string>>(new Set());

  useSuministrosSync(demo ? null : port);

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
  }, [demo, centroIds, hydrate]);
}
