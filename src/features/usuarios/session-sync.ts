import { useEffect, useRef } from 'react';
import { getSession, getToken, SESSION_KEY, TOKEN_KEY } from '@/services/apiClient';
import { useSessionStore } from './session';

/**
 * Honest explanation for a DESYNCED session, never a permission problem.
 *
 * `apiFetch` reads the token from localStorage on every call, so the persisted
 * copy can change under a mounted screen (the real case: another tab of the same
 * origin signs in and replaces the shared `nexovital.token` / `nexovital.session`
 * keys). The backend then answers `403 ACCESO_DENEGADO`, whose text ("No tiene
 * permisos para este recurso") is misleading: the user did not lose a role, the
 * screen is simply holding an older session. This is the truthful replacement.
 */
export const SESSION_CHANGED_MESSAGE =
  'Tu sesión cambió en otra pestaña o expiró. Vuelve a iniciar sesión para continuar.';

/**
 * True when the in-memory session still owns the persisted credentials.
 *
 * The store keeps THIS tab's session in memory, while `apiFetch` authenticates
 * with whatever token localStorage currently holds. When the two disagree, any
 * request from this screen would travel with a token that is not its own. A
 * signed-out store has nothing to protect and is treated as in sync.
 */
export function isSessionInSync(): boolean {
  const { token, user } = useSessionStore.getState();
  if (!token || !user) {
    return true;
  }
  if (getToken() !== token) {
    return false;
  }
  const persisted = getSession();
  return persisted !== null && persisted.id === user.id && persisted.rol === user.rol;
}

/** The two keys whose change means the persisted session moved. */
const WATCHED_KEYS = new Set([TOKEN_KEY, SESSION_KEY]);

/**
 * Watches the shared session keys through the `storage` event, which fires in
 * every OTHER document of the origin when one of them changes. `onChanged` runs
 * only when the change actually desyncs this tab, so unrelated storage writes
 * (map filter, theme) never trigger it.
 *
 * The listener is bound once; the latest callback is kept in a ref so an inline
 * handler does not re-subscribe on every render.
 */
export function useSessionSync(onChanged: () => void): void {
  const handlerRef = useRef(onChanged);

  useEffect(() => {
    handlerRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      // A null key means `localStorage.clear()`.
      if (event.key !== null && !WATCHED_KEYS.has(event.key)) {
        return;
      }
      if (!isSessionInSync()) {
        handlerRef.current();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
}
