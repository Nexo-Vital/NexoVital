import { useEffect, useRef } from 'react';
import { getSession, getToken, SESSION_KEY, TOKEN_KEY } from '@/services/apiClient';
import { useSessionStore } from './session';

/**
 * Honest explanation for a DESYNCED session, never a permission problem.
 *
 * This machinery is kept as defence in depth. The session now lives in per-tab
 * `sessionStorage`, so another tab can no longer replace this tab's
 * `nexovital.token` / `nexovital.session`: the cross-tab overwrite that
 * motivated this message is structurally impossible. It is kept for the
 * residual case where this tab's persisted copy drifts from the in-memory one.
 * If that happens, `apiFetch` would authenticate with a token that is not this
 * screen's, and the backend would answer `403 ACCESO_DENEGADO`, whose text ("No
 * tiene permisos para este recurso") is misleading: the user did not lose a
 * role, the screen is simply holding an older session. This is the truthful
 * replacement.
 */
export const SESSION_CHANGED_MESSAGE =
  'Tu sesión cambió en otra pestaña o expiró. Vuelve a iniciar sesión para continuar.';

/**
 * True when the in-memory session still owns the persisted credentials.
 *
 * The store keeps THIS tab's session in memory, while `apiFetch` authenticates
 * with whatever token `sessionStorage` currently holds. Because that storage is
 * scoped per tab, another tab can no longer overwrite it, so this is a
 * defence-in-depth check: it still catches this tab's persisted copy drifting
 * from memory. When the two disagree, any request from this screen would travel
 * with a token that is not its own. A signed-out store has nothing to protect
 * and is treated as in sync.
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
 * Watches the session keys through the `storage` event, kept as defence in
 * depth. Since the session moved to per-tab `sessionStorage`, another tab can no
 * longer change these keys under a mounted screen: the event only reaches
 * documents that share this tab's storage area (for example an iframe). The
 * listener stays bound so a drift inside this tab still reaches `onChanged`,
 * and unrelated storage writes (map filter, theme) never trigger it.
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
