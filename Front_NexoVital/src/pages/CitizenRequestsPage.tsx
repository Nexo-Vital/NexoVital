import { Ambulance, CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import {
  listarMisSolicitudes,
  listarMisSolicitudesAtendidas,
} from '@/features/solicitudes/solicitud-api';
import { formatDateTime } from '@/lib/format';
import type { SolicitudAmbulancia } from '@/types/domain';

interface CitizenRequestsPageProps {
  /** Injectable for tests; default to the real backend reads. */
  fetchActivas?: () => Promise<SolicitudAmbulancia[]>;
  fetchAtendidas?: () => Promise<SolicitudAmbulancia[]>;
}

interface Listas {
  activas: SolicitudAmbulancia[];
  atendidas: SolicitudAmbulancia[];
}

const LOAD_ERROR = 'No se pudieron cargar tus solicitudes.';

/** Citizen-facing state of a request, in the same words the map rail uses. */
function estadoCiudadano(solicitud: SolicitudAmbulancia): string {
  switch (solicitud.estado) {
    case 'PENDING':
      return 'Buscando ambulancia';
    case 'ASSIGNED':
      return solicitud.llegadaEn ? 'La ambulancia llegó' : 'Ambulancia en camino';
    case 'CONFIRMED':
      return 'Llegada confirmada';
    case 'TAKEN':
      return 'Atendida';
    default:
      return 'Cerrada';
  }
}

function FilaSolicitud({ solicitud }: { solicitud: SolicitudAmbulancia }) {
  const atendida = solicitud.estado === 'TAKEN';
  return (
    <li
      data-testid={atendida ? 'solicitud-atendida' : 'solicitud-activa'}
      className="flex flex-wrap items-center justify-between gap-3 rounded-nv-lg border border-nv-line bg-white p-5 shadow-nv-card"
    >
      <div className="flex flex-col gap-1">
        <span className={atendida ? 'font-semibold text-ok text-sm' : 'font-semibold text-sm'}>
          {estadoCiudadano(solicitud)}
        </span>
        <span className="text-nv-navy-400 text-sm">
          {solicitud.ubicacion ? formatCoordinates(solicitud.ubicacion) : 'Sin ubicación'}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1 text-right text-sm">
        <time dateTime={solicitud.solicitadaEn} className="text-nv-navy-400">
          Solicitada: {formatDateTime(solicitud.solicitadaEn)}
        </time>
        {solicitud.llegadaEn && (
          <time dateTime={solicitud.llegadaEn} className="text-nv-navy-400">
            Llegada: {formatDateTime(solicitud.llegadaEn)}
          </time>
        )}
      </div>
    </li>
  );
}

function Seccion({
  titulo,
  vacio,
  solicitudes,
}: {
  titulo: string;
  vacio: string;
  solicitudes: SolicitudAmbulancia[];
}) {
  return (
    <section aria-label={`Solicitudes ${titulo.toLowerCase()}`} className="flex flex-col gap-3">
      <h2 className="font-semibold text-lg">{titulo}</h2>
      {solicitudes.length === 0 ? (
        <p className="rounded-nv-lg border border-nv-line bg-white p-5 text-nv-navy-400 text-sm shadow-nv-card">
          {vacio}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {solicitudes.map((solicitud) => (
            <FilaSolicitud key={solicitud.id} solicitud={solicitud} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Mis solicitudes": the citizen's active and attended requests (EP-04.F2.US11). */
export default function CitizenRequestsPage({
  fetchActivas = listarMisSolicitudes,
  fetchAtendidas = listarMisSolicitudesAtendidas,
}: CitizenRequestsPageProps = {}) {
  const [listas, setListas] = useState<Listas | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchActivas(), fetchAtendidas()])
      .then(([activas, atendidas]) => {
        if (active) {
          setListas({ activas, atendidas });
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
  }, [fetchActivas, fetchAtendidas]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-y-auto bg-nv-mint text-nv-navy">
      <header className="flex items-center gap-3">
        <Ambulance className="size-7 text-nv-navy" aria-hidden />
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Mis solicitudes</h1>
          <p className="mt-1 text-nv-navy-400 text-sm">Tus solicitudes de ambulancia</p>
        </div>
      </header>

      {error !== null && (
        <p
          role="alert"
          className="rounded-nv-md border border-nv-red-600/40 bg-white px-4 py-3 text-nv-red-600 text-sm"
        >
          {error}
        </p>
      )}

      {error === null && listas === null && (
        <p role="status" className="text-nv-navy-400 text-sm">
          Cargando solicitudes…
        </p>
      )}

      {error === null && listas !== null && (
        <>
          <Seccion
            titulo="Activas"
            vacio="No tienes solicitudes activas."
            solicitudes={listas.activas}
          />
          <Seccion
            titulo="Atendidas"
            vacio="Todavía no tienes solicitudes atendidas."
            solicitudes={listas.atendidas}
          />
          {listas.atendidas.length > 0 && (
            <p className="flex items-center gap-2 text-nv-navy-400 text-sm">
              <CircleCheck className="size-4 text-ok" aria-hidden />
              Una solicitud atendida ya no figura entre las activas.
            </p>
          )}
        </>
      )}
    </div>
  );
}
