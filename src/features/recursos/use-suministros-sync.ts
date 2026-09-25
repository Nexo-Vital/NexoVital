import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import { fromWireInventario } from './inventory-api';
import { useInventarioStore } from './inventory-store';

/**
 * Se suscribe a `/topic/suministros` y hace UPSERT de cada item acreditado en el
 * estado de inventario, para que una donación hecha en otro cliente actualice el
 * semáforo en todos los conectados. El frame es el `ItemInventarioDto` desnudo
 * que el backend publica tras el commit; no hay envoltorio.
 *
 * La validación pasa por `fromWireInventario`, que traduce el `semaforo`
 * español y descarta los frames malformados en vez de romper la UI.
 */
export function useSuministrosSync(port: RealtimePort | null): void {
  const upsert = useInventarioStore((state) => state.upsert);

  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe(DESTINATIONS.suministros, (payload) => {
      const item = fromWireInventario(payload);
      if (item) {
        upsert(item);
      }
    });
  }, [port, upsert]);
}
