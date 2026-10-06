import { create } from 'zustand';
import {
  login as apiLogin,
  clearSession,
  clearToken,
  getSession,
  getToken,
  setSession,
  setToken,
} from '@/services/apiClient';
import type { RolUsuario, Usuario } from '@/types/domain';
import { hasRoleHome } from './role-home';

/**
 * Seeded accounts advertised on the login screen. This is only a shortcut that
 * fills the form: the credentials still travel through POST /api/v1/sesiones, so the
 * server remains the single source of truth for authentication.
 */
export interface DemoUser {
  rol: RolUsuario;
  label: string;
  /** Plural label used when several seeded profiles share the role. */
  groupLabel?: string;
  /** One-line explanation of what the profile does in the system. */
  descripcion: string;
  email: string;
  password: string;
}

export const DEMO_USERS: DemoUser[] = [
  {
    rol: 'ADMIN_PLATAFORMA',
    label: 'Administrador de plataforma',
    descripcion: 'Administra la plataforma y los usuarios',
    email: 'admin@nexovital.co',
    password: 'admin123',
  },
  {
    rol: 'ADMIN_CENTRO_AYUDA',
    label: 'Administrador de centro de ayuda',
    groupLabel: 'Administradores de centro de ayuda',
    descripcion: 'Pide ambulancias y administra los insumos de su centro',
    email: 'rangel@nexovital.co',
    password: 'rangel123',
  },
  {
    rol: 'ADMIN_CENTRO_AYUDA',
    label: 'Administrador de centro de ayuda',
    groupLabel: 'Administradores de centro de ayuda',
    descripcion: 'Pide ambulancias y administra los insumos de su centro',
    email: 'centro@nexovital.co',
    password: 'centro123',
  },
  {
    rol: 'ADMIN_ACOPIO',
    label: 'Administrador de centro de acopio',
    descripcion: 'Crea y gestiona su centro, igual que el administrador de centro de ayuda',
    email: 'acopio@nexovital.co',
    password: 'acopio123',
  },
  {
    rol: 'CONDUCTOR',
    label: 'Conductor de ambulancia',
    groupLabel: 'Conductores de ambulancia',
    descripcion: 'Recibe y responde solicitudes de ambulancia',
    email: 'conductor1@nexovital.co',
    password: 'conductor123',
  },
  {
    rol: 'CONDUCTOR',
    label: 'Conductor de ambulancia',
    groupLabel: 'Conductores de ambulancia',
    descripcion: 'Recibe y responde solicitudes de ambulancia',
    email: 'conductor2@nexovital.co',
    password: 'conductor123',
  },
  {
    rol: 'CONDUCTOR',
    label: 'Conductor de ambulancia',
    groupLabel: 'Conductores de ambulancia',
    descripcion: 'Recibe y responde solicitudes de ambulancia',
    email: 'conductor3@nexovital.co',
    password: 'conductor123',
  },
  {
    rol: 'CONDUCTOR',
    label: 'Conductor de ambulancia',
    groupLabel: 'Conductores de ambulancia',
    descripcion: 'Recibe y responde solicitudes de ambulancia',
    email: 'conductor4@nexovital.co',
    password: 'conductor123',
  },
  {
    rol: 'CONDUCTOR',
    label: 'Conductor de ambulancia',
    groupLabel: 'Conductores de ambulancia',
    descripcion: 'Recibe y responde solicitudes de ambulancia',
    email: 'conductor5@nexovital.co',
    password: 'conductor123',
  },
  {
    rol: 'CIUDADANO',
    label: 'Ciudadano',
    groupLabel: 'Ciudadanos',
    descripcion: 'Solicita una ambulancia y reporta emergencias',
    email: 'ciudadano@nexovital.co',
    password: 'ciudadano123',
  },
  {
    rol: 'CIUDADANO',
    label: 'Ciudadano',
    groupLabel: 'Ciudadanos',
    descripcion: 'Solicita una ambulancia y reporta emergencias',
    email: 'ciudadano2@nexovital.co',
    password: 'ciudadano123',
  },
];

interface SessionState {
  user: Usuario | null;
  role: RolUsuario | null;
  token: string | null;
  login: (email: string, password: string) => Promise<Usuario>;
  /**
   * Replaces the session with the server-authoritative user returned by
   * GET /api/v1/sesiones/actual. The server wins over any stale localStorage
   * copy, including the role, so a revoked or re-assigned role is honoured
   * without a manual sign-out.
   */
  applyServerSession: (token: string, usuario: Usuario) => void;
  logout: () => void;
}

/** Rehydrates the store from the persisted token + session on app load. */
function readStoredSession(): Pick<SessionState, 'user' | 'role' | 'token'> {
  const token = getToken();
  const user = getSession();
  if (!token || !user) {
    return { user: null, role: null, token: null };
  }
  // Defence in depth: a stale session whose role has no screen must not survive
  // a reload. Drop it so the route guard treats the user as signed out.
  if (!hasRoleHome(user.rol)) {
    clearToken();
    clearSession();
    return { user: null, role: null, token: null };
  }
  return { user, role: user.rol, token };
}

export const useSessionStore = create<SessionState>((set) => ({
  ...readStoredSession(),
  login: async (email, password) => {
    const { token, usuario } = await apiLogin(email, password);
    setToken(token);
    setSession(usuario);
    set({ user: usuario, role: usuario.rol, token });
    return usuario;
  },
  applyServerSession: (token, usuario) => {
    setToken(token);
    setSession(usuario);
    set({ user: usuario, role: usuario.rol, token });
  },
  logout: () => {
    clearToken();
    clearSession();
    set({ user: null, role: null, token: null });
  },
}));
