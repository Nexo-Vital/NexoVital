import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMiCentro, type MiCentro } from './my-center-api';

/**
 * - `off`: the hook is disabled (another role, or the demo build with no backend);
 * - `loading`: the first read is in flight;
 * - `none`: the administrator has not created a center yet;
 * - `ready`: the center exists;
 * - `error`: the read failed, so it is unknown whether a center exists.
 */
export type MyCenterStatus = 'off' | 'loading' | 'none' | 'ready' | 'error';

export interface MyCenterState {
  status: MyCenterStatus;
  centro: MiCentro | null;
  /** Reads the center again (used by "Reintentar" after a failed read). */
  reload: () => void;
  /** Stores the center the create call just returned, without a second read. */
  setCentro: (centro: MiCentro) => void;
}

/**
 * The help-center administrator's own center. It reads
 * `GET /api/v1/centros-acopio/mio` once when enabled; a failed read is reported
 * as `error` and never as "no center", so the screen cannot offer "Crear centro"
 * to an administrator who may already have one.
 */
export function useMyCenter(enabled: boolean): MyCenterState {
  const [status, setStatus] = useState<MyCenterStatus>(enabled ? 'loading' : 'off');
  const [centro, setCentroState] = useState<MiCentro | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Invalidates a read that a newer read (or a create) has superseded. */
  const readId = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    readId.current += 1;
    if (!enabled) {
      setStatus('off');
      setCentroState(null);
      return;
    }
    const runId = readId.current;
    setStatus('loading');
    fetchMiCentro()
      .then((found) => {
        if (readId.current !== runId) {
          return;
        }
        setCentroState(found);
        setStatus(found ? 'ready' : 'none');
      })
      .catch(() => {
        if (readId.current === runId) {
          setStatus('error');
        }
      });
    return () => {
      readId.current += 1;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  const setCentro = useCallback((next: MiCentro) => {
    readId.current += 1;
    setCentroState(next);
    setStatus('ready');
  }, []);

  return { status, centro, reload, setCentro };
}
