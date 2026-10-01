import { ClipboardList } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import { fetchHistorialSolicitudes } from '@/features/conductor/history-api';
import { REQUEST_STATE_LABEL_ES } from '@/features/solicitudes/request-status';
import { formatDateTime } from '@/lib/format';
import type { SolicitudAmbulancia } from '@/types/domain';

interface DriverHistoryPageProps {
  /** Injectable for tests; defaults to the real backend read. */
  fetchHistorial?: () => Promise<SolicitudAmbulancia[]>;
}

/** Honest fallback when the backend failure carries no readable message. */
const LOAD_ERROR = 'No se pudo cargar el historial de servicios.';

/**
 * Driver service history, mounted at `/conductor/solicitudes`. It reads the
 * requests the backend actually assigned to this driver's unit (newest first)
 * and shows, per service: its state, when it was requested, where the scene was
 * and whether arrival was declared.
 *
 * The `null` body the backend answers for a driver without a unit arrives here
 * as an empty list, so it renders the empty state instead of crashing. Loading,
 * empty and error are three explicit states; a failed read shows the server's
 * own message and never invents services.
 */
export default function DriverHistoryPage({
  fetchHistorial = fetchHistorialSolicitudes,
}: DriverHistoryPageProps = {}) {
  const [items, setItems] = useState<SolicitudAmbulancia[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchHistorial()
      .then((rows) => {
        if (active) {
          setItems(rows);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(failure instanceof Error && failure.message ? failure.message : LOAD_ERROR);
        }
      });
    return () => {
      active = false;
    };
  }, [fetchHistorial]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-y-auto bg-nv-mint text-nv-navy">
      <header>
        <h1 className="font-semibold text-2xl tracking-tight">Solicitudes</h1>
        <p className="mt-1 text-nv-navy-400 text-sm">Historial de servicios de tu ambulancia</p>
      </header>

      {error !== null && (
        <p
          role="alert"
          className="rounded-nv-md border border-nv-red-600/40 bg-white px-4 py-3 text-nv-red-600 text-sm"
        >
          {error}
        </p>
      )}

      {error === null && items === null && (
        <p role="status" className="text-nv-navy-400 text-sm">
          Cargando historial…
        </p>
      )}

      {error === null && items !== null && items.length === 0 && (
        <div className="grid flex-1 place-items-center rounded-nv-lg border border-nv-line bg-white p-8 text-center shadow-nv-card">
          <div className="flex flex-col items-center gap-2">
            <ClipboardList className="size-8 text-nv-navy-400" aria-hidden />
            <p className="font-medium text-nv-navy">Todavía no tienes servicios</p>
            <p className="text-nv-navy-400 text-sm">
              Aquí verás los servicios que haya atendido tu ambulancia.
            </p>
          </div>
        </div>
      )}

      {error === null && items !== null && items.length > 0 && (
        <ul aria-label="Historial de servicios" className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="historial-solicitud"
              className="flex flex-wrap items-center justify-between gap-3 rounded-nv-lg border border-nv-line bg-white p-5 shadow-nv-card"
            >
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-sm">{REQUEST_STATE_LABEL_ES[item.estado]}</span>
                <span className="text-nv-navy-400 text-sm">
                  {item.zonaId ||
                    (item.ubicacion ? formatCoordinates(item.ubicacion) : 'Sin ubicación')}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1 text-right text-sm">
                <time dateTime={item.solicitadaEn} className="text-nv-navy-400">
                  Solicitada: {formatDateTime(item.solicitadaEn)}
                </time>
                {item.llegadaEn ? (
                  <time dateTime={item.llegadaEn} className="text-ok">
                    Llegada declarada: {formatDateTime(item.llegadaEn)}
                  </time>
                ) : (
                  <span className="text-nv-navy-400">Sin llegada declarada</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
