import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import {
  conectarMiAmbulancia,
  declararDisponibilidadMiAmbulancia,
  desconectarMiAmbulancia,
} from '@/features/flota/fleet-api';
import { isDemoMode } from '@/services/apiClient';
import type { Ambulancia } from '@/types/domain';
import { useDriverOnlineStore } from './driver-online-store';

/** Shown when a command fails and the server gave no readable reason. */
const CONNECTION_ERROR = 'No fue posible cambiar el estado de tu ambulancia. Inténtalo de nuevo.';

/** Why "Desconectarse" is unavailable while the driver attends a request. */
export const DISCONNECT_BLOCKED_REASON = 'Finaliza el servicio para desconectarte.';

export interface DriverConnection {
  /** Whether the driver is connected to the service. */
  online: boolean;
  /** True while a command of this hook is in flight against the backend. */
  pending: boolean;
  /**
   * True when the SERVER owns the connection: off demo mode and with a unit
   * that carries `conectada`. False in demo mode and for a unit that does not
   * carry the field, where the connection is the local toggle it always was.
   */
  serverManaged: boolean;
  connect: () => void;
  disconnect: () => void;
  /**
   * Declares the unit available (`true`) or out of service (`false`) on the
   * server. Only meaningful when `serverManaged`; otherwise it does nothing and
   * the caller keeps its own local state.
   */
  declareAvailability: (disponible: boolean) => void;
}

/**
 * The driver's connection to the service (EP-04.F2.US1, D3).
 *
 * Against the backend the connection is DATA of the unit: only a connected unit
 * receives new requests, and the server changes it both on the driver's command
 * and when the driver's last realtime session ends. So this hook never keeps its
 * own truth there:
 *   - `online` is the unit's `conectada`, exactly as the server last reported
 *     it (REST read, command response or `/topic/flota` frame);
 *   - `connect` / `disconnect` are REST commands, and the unit the server
 *     answers with is handed to `onServerUnit` so the owner of the unit adopts
 *     it. The same change also arrives on `/topic/flota`.
 *
 * A unit in a mission cannot be disconnected: the server answers 409
 * `SOLICITUD_EN_CURSO` and its message is shown as is.
 *
 * The same holds for the unit's availability ("Disponible" / "Fuera de
 * servicio"): it is the unit's `estado` on the server, changed with a command,
 * and the answer is adopted the same way. Only an available unit receives a
 * request, so the server has to know it.
 *
 * Demo mode has no backend, and a unit without `conectada` comes from a source
 * that does not know the field; both keep the local toggle of
 * `useDriverOnlineStore`.
 *
 * The value is mirrored into the store so every other driver screen shows the
 * same connection without reading the unit again.
 */
export function useDriverConnection(
  unit: Ambulancia | null | undefined,
  onServerUnit?: (unit: Ambulancia) => void,
): DriverConnection {
  const localOnline = useDriverOnlineStore((state) => state.online);
  const goOnline = useDriverOnlineStore((state) => state.goOnline);
  const goOffline = useDriverOnlineStore((state) => state.goOffline);
  const setOnline = useDriverOnlineStore((state) => state.setOnline);
  const [pending, setPending] = useState(false);

  const serverConectada = unit?.conectada;
  const serverManaged = !isDemoMode() && typeof serverConectada === 'boolean';
  const online = serverManaged ? serverConectada === true : localOnline;

  useEffect(() => {
    if (serverManaged) {
      setOnline(serverConectada === true);
    }
  }, [serverManaged, serverConectada, setOnline]);

  // The latest callback is read from a ref so the two commands keep a stable
  // identity even when the owner passes a new function on every render.
  const onServerUnitRef = useRef(onServerUnit);
  useEffect(() => {
    onServerUnitRef.current = onServerUnit;
  }, [onServerUnit]);
  // Guards against a double click: two commands in flight would only race.
  const pendingRef = useRef(false);
  // A command that resolves after the screen is gone must not set state.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runCommand = useCallback(
    (command: () => Promise<Ambulancia | null>) => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = true;
      setPending(true);
      command()
        .then((unidad) => {
          if (unidad === null) {
            return;
          }
          // The server's unit is the truth: adopt it instead of guessing the
          // outcome from which button was pressed.
          onServerUnitRef.current?.(unidad);
          if (typeof unidad.conectada === 'boolean') {
            setOnline(unidad.conectada);
          }
        })
        .catch((error: unknown) => {
          toast(
            error instanceof Error && error.message ? error.message : CONNECTION_ERROR,
            'error',
          );
        })
        .finally(() => {
          pendingRef.current = false;
          if (mountedRef.current) {
            setPending(false);
          }
        });
    },
    [setOnline],
  );

  const connect = useCallback(() => {
    if (serverManaged) {
      runCommand(conectarMiAmbulancia);
      return;
    }
    goOnline();
  }, [serverManaged, runCommand, goOnline]);

  const disconnect = useCallback(() => {
    if (serverManaged) {
      runCommand(desconectarMiAmbulancia);
      return;
    }
    goOffline();
  }, [serverManaged, runCommand, goOffline]);

  const declareAvailability = useCallback(
    (disponible: boolean) => {
      if (serverManaged) {
        runCommand(() => declararDisponibilidadMiAmbulancia(disponible));
      }
    },
    [serverManaged, runCommand],
  );

  return { online, pending, serverManaged, connect, disconnect, declareAvailability };
}
