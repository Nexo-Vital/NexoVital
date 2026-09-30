import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getMe } from '@/services/apiClient';
import type { RolUsuario } from '@/types/domain';
import { hasRoleHome } from './role-home';
import { useSessionStore } from './session';

/**
 * Route guard for every protected route.
 *
 * On mount it revalidates the stored token once against GET /api/v1/sesiones/actual.
 * The store hydrates synchronously from localStorage, so "looks signed in" is not
 * the same as "is signed in": this async step makes the server the source of truth
 * before any protected screen is rendered.
 *
 *   - no token            -> straight to /login, the endpoint is never called;
 *   - 200                 -> the server user replaces the stored session;
 *   - 401 / any failure   -> the session is cleared and the user goes to /login.
 *
 * A role without a screen (today CIUDADANO) is blocked on the same path as login.
 * The check runs once per app load: no intervals, no focus/visibility listeners.
 */
export function RequireAuth() {
  const token = useSessionStore((state) => state.token);
  const role = useSessionStore((state) => state.role);
  const applyServerSession = useSessionStore((state) => state.applyServerSession);
  const logout = useSessionStore((state) => state.logout);

  // `validated` is the token that already cleared the server check. Until it
  // matches the current token the guard holds the protected screen back, so the
  // user can never flash a screen they may not be allowed into.
  const [validated, setValidated] = useState<string | null>(null);

  useEffect(() => {
    if (!token || validated === token) {
      return;
    }
    let active = true;
    const validate = async () => {
      try {
        const usuario = await getMe(token);
        if (!active) {
          return;
        }
        applyServerSession(token, usuario);
        setValidated(token);
      } catch {
        if (!active) {
          return;
        }
        logout();
      }
    };
    void validate();
    return () => {
      active = false;
    };
  }, [token, validated, applyServerSession, logout]);

  // No session, or a session the server has not confirmed yet: stay on the
  // loading state (or /login when there is nothing to validate).
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (validated !== token) {
    return <AuthLoadingState />;
  }
  if (!hasRoleHome(role)) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

/**
 * Minimal honest loading state: a reduced-motion-safe skeleton with an
 * accessible status label. It renders instead of the protected screen while the
 * token is being revalidated, so there is never a flash of a screen the user may
 * not be allowed into.
 */
export function AuthLoadingState() {
  return (
    <div
      className="grid min-h-dvh place-items-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3" data-testid="auth-loading">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-muted-foreground text-sm">Validando sesión…</p>
      </div>
    </div>
  );
}

interface RequireRoleProps {
  roles: RolUsuario[];
  /** Inline usage; falls back to an <Outlet /> when rendered as a route layout. */
  children?: ReactNode;
  fallback?: ReactNode;
}

/**
 * Role guard. Used inline around role-specific panels and as a route layout.
 * The coordinator role decides WHICH panels exist; it never decides on a
 * request outcome (rule C2: first accept wins, server-side).
 */
export function RequireRole({ roles, children, fallback = null }: RequireRoleProps) {
  const role = useSessionStore((state) => state.role);
  if (!role || !roles.includes(role)) {
    return <>{fallback}</>;
  }
  return <>{children ?? <Outlet />}</>;
}
