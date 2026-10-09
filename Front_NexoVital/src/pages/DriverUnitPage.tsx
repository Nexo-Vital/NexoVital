import { Ambulance, Mail, MapPin, Power, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nvButton } from '@/components/ui/button';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import { useDriverConnection } from '@/features/conductor/use-driver-connection';
import { fetchMiAmbulancia } from '@/features/flota/fleet-api';
import { ROLE_LABEL } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import { cn } from '@/lib/utils';
import type { AmbulanceState, Ambulancia } from '@/types/domain';

/**
 * Vehicle state (the contract literal the fleet API publishes) mapped to the
 * Spanish label shown on the screen. It names the UNIT's state, which is why it
 * is separate from the driver's own vocabulary in `driver-status.ts`.
 */
const UNIT_STATE_LABEL_ES: Record<AmbulanceState, string> = {
  AVAILABLE: 'Disponible',
  ASSIGNED: 'En misión',
  EN_ROUTE: 'En ruta',
  MAINTENANCE: 'En mantenimiento',
};

/** Honest fallback when the backend failure carries no readable message. */
const LOAD_ERROR = 'No se pudo cargar tu unidad.';

/**
 * Driver's own unit, mounted at `/conductor/unidad`. It reads the unit the
 * backend assigned to this driver (`GET /api/v1/flota/ambulancias/mia`) and
 * shows its plate, state, zone and position, next to the signed-in driver's data
 * and the connection toggle. The toggle is the same connection the console
 * uses (`useDriverConnection`): against the backend it is the unit's own
 * `conectada`, changed with a REST command, so both screens show one value.
 *
 * The server answers JSON `null` for a driver without a unit, so that arrives
 * here as the explicit empty state instead of a crash. Loading, empty and error
 * are three separate states; a failed read shows the server's own message and
 * never invents a unit.
 */
export default function DriverUnitPage() {
  const user = useSessionStore((state) => state.user);
  // `undefined` = still loading, `null` = the driver has no unit, a value = the
  // unit. Three states without an extra boolean flag.
  const [unit, setUnit] = useState<Ambulancia | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // The unit the server answers a connection command with replaces the one on
  // screen, so the toggle and the unit data never disagree. This screen never
  // touches the realtime transport.
  const { online, pending, connect, disconnect } = useDriverConnection(unit, setUnit);

  useEffect(() => {
    let active = true;
    fetchMiAmbulancia()
      .then((mia) => {
        if (active) {
          setUnit(mia);
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
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-y-auto bg-nv-mint text-nv-navy">
      <header>
        <h1 className="font-semibold text-2xl tracking-tight">Mi unidad</h1>
        <p className="mt-1 text-nv-navy-400 text-sm">Tu ambulancia y tu estado de conexión</p>
      </header>

      {error !== null && (
        <p
          role="alert"
          className="rounded-nv-md border border-nv-red-600/40 bg-white px-4 py-3 text-nv-red-600 text-sm"
        >
          {error}
        </p>
      )}

      {error === null && unit === undefined && (
        <p role="status" className="text-nv-navy-400 text-sm">
          Cargando tu unidad…
        </p>
      )}

      {error === null && unit === null && (
        <div className="grid flex-1 place-items-center rounded-nv-lg border border-nv-line bg-white p-8 text-center shadow-nv-card">
          <div className="flex flex-col items-center gap-2">
            <Ambulance className="size-8 text-nv-navy-400" aria-hidden />
            <p className="font-medium text-nv-navy">Sin unidad asignada</p>
            <p className="text-nv-navy-400 text-sm">
              Aún no tienes una ambulancia asociada a tu cuenta.
            </p>
          </div>
        </div>
      )}

      {error === null && unit !== undefined && unit !== null && (
        <section
          aria-label="Datos de la unidad"
          className="flex flex-col gap-1 rounded-nv-lg border border-nv-line bg-white p-5 shadow-nv-card"
        >
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-lg">
            <Ambulance className="size-5 shrink-0 text-nv-navy" aria-hidden />
            Ambulancia {unit.placa}
          </h2>
          <dl className="flex flex-col">
            <div className="flex items-center justify-between gap-3 border-nv-line border-b py-3">
              <dt className="text-nv-navy-400 text-sm">Placa</dt>
              <dd className="font-medium text-sm">{unit.placa}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-nv-line border-b py-3">
              <dt className="text-nv-navy-400 text-sm">Estado</dt>
              <dd className="font-medium text-sm">{UNIT_STATE_LABEL_ES[unit.estado]}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-nv-line border-b py-3">
              <dt className="text-nv-navy-400 text-sm">Zona</dt>
              <dd className="font-medium text-sm">{unit.zona}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="flex items-center gap-1.5 text-nv-navy-400 text-sm">
                <MapPin className="size-4 shrink-0" aria-hidden />
                Posición
              </dt>
              <dd className="font-medium text-sm">{formatCoordinates(unit.ubicacion)}</dd>
            </div>
          </dl>
        </section>
      )}

      {user && (
        <section
          aria-label="Datos del conductor"
          className="flex flex-col gap-3 rounded-nv-lg border border-nv-line bg-white p-5 shadow-nv-card"
        >
          <h2 className="font-semibold text-lg">Tus datos</h2>
          <div className="flex items-center gap-3">
            <User className="size-5 shrink-0 text-nv-navy-400" aria-hidden />
            <div className="flex flex-col gap-px">
              <span className="text-nv-navy-400 text-xs">Nombre</span>
              <span className="font-medium text-sm">{user.nombre}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="size-5 shrink-0 text-nv-navy-400" aria-hidden />
            <div className="flex flex-col gap-px">
              <span className="text-nv-navy-400 text-xs">Correo</span>
              <span className="font-medium text-sm">{user.email}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Ambulance className="size-5 shrink-0 text-nv-navy-400" aria-hidden />
            <div className="flex flex-col gap-px">
              <span className="text-nv-navy-400 text-xs">Rol</span>
              <span className="font-medium text-sm">{ROLE_LABEL[user.rol]}</span>
            </div>
          </div>
        </section>
      )}

      <section
        aria-label="Conexión"
        className="flex flex-col gap-3 rounded-nv-lg border border-nv-line bg-white p-5 shadow-nv-card"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-lg">Conexión</h2>
          <span
            className={cn(
              'shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs',
              online ? 'bg-nv-lime text-nv-navy' : 'bg-idle/15 text-idle',
            )}
          >
            {online ? 'En línea' : 'Desconectado'}
          </span>
        </div>
        {online ? (
          <button
            type="button"
            onClick={disconnect}
            disabled={pending}
            className={nvButton({ tone: 'secondary' })}
          >
            <Power className="size-4" aria-hidden />
            Desconectarse
          </button>
        ) : (
          <button type="button" onClick={connect} disabled={pending} className={nvButton()}>
            <Power className="size-4" aria-hidden />
            Conectarse
          </button>
        )}
      </section>
    </div>
  );
}
