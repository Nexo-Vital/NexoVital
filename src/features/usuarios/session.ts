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

/**
 * Seeded accounts advertised on the login screen. This is only a shortcut that
 * fills the form: the credentials still travel through POST /auth/login, so the
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
    descripcion: 'Opera la sala de operaciones CRUE',
    email: 'rangel@nexovital.co',
    password: 'rangel123',
  },
  {
    rol: 'ADMIN_CENTRO_AYUDA',
    label: 'Administrador de centro de ayuda',
    groupLabel: 'Administradores de centro de ayuda',
    descripcion: 'Opera la sala de operaciones CRUE',
    email: 'centro@nexovital.co',
    password: 'centro123',
  },
  {
    rol: 'ADMIN_ACOPIO',
    label: 'Administrador de centro de acopio',
    descripcion: 'Gestiona el inventario y las donaciones del centro de acopio',
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
    descripcion: 'Solicita una ambulancia y reporta emergencias',
    email: 'ciudadano@nexovital.co',
    password: 'ciudadano123',
  },
];

interface SessionState {
  user: Usuario | null;
  role: RolUsuario | null;
  token: string | null;
  login: (email: string, password: string) => Promise<Usuario>;
  logout: () => void;
}

/** Rehydrates the store from the persisted token + session on app load. */
function readStoredSession(): Pick<SessionState, 'user' | 'role' | 'token'> {
  const token = getToken();
  const user = getSession();
  if (!token || !user) {
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
  logout: () => {
    clearToken();
    clearSession();
    set({ user: null, role: null, token: null });
  },
}));
