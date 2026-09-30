import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Guards the wire alert: the identity and demand fields the projection always
 * carries. A malformed frame is discarded instead of triggering a blind
 * re-read, the same discipline `fromWireInventario` follows.
 */
export function isAlertaEscasez(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.centroAcopioId === 'string' &&
    typeof value.itemId === 'string' &&
    typeof value.nombre === 'string' &&
    typeof value.cantidadSolicitada === 'number' &&
    typeof value.disponibleActual === 'number' &&
    typeof value.faltante === 'number'
  );
}

/**
 * Se suscribe a `/topic/alerts`, el canal que `recursos` publica tras el commit
 * cuando un despacho RECHAZADO crea o sube la demanda de un insumo.
 *
 * La alerta no es un estado que el front mergee: su actividad depende del stock
 * y solo la expone la proyeccion del mapa (`GET /api/v1/mapa`). Por eso este
 * canal no trae el read-model del centro — trae la senal de que cambio, y el
 * dueno del read-model lo vuelve a leer. Es el espejo de `useSuministrosSync`,
 * que hace lo mismo para el canal de inventario.
 */
export function useAlertasEscasezSync(
  port: RealtimePort | null,
  onAlertaChange?: () => void,
): void {
  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe(DESTINATIONS.alertas, (payload) => {
      if (isAlertaEscasez(payload)) {
        onAlertaChange?.();
      }
    });
  }, [port, onAlertaChange]);
}
