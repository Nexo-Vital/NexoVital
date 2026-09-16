import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import type { RolUsuario } from '@/types/domain';
import { useSessionStore } from './session';

/** Route guard: redirects to the login screen when there is no session. */
export function RequireAuth() {
  const token = useSessionStore((state) => state.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
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
