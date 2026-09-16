import { create } from 'zustand';
import type { RolUsuario, Usuario } from '@/types/domain';

/**
 * In-memory mock session. No backend yet: `login(role)` fabricates a user and a
 * token so route guards and role-aware panels can be exercised. The real
 * implementation will call POST /auth/login and persist the JWT.
 */
const MOCK_USERS: Record<RolUsuario, Usuario> = {
  ADMIN_PLATAFORMA: {
    id: 'usr-platform',
    nombre: 'Platform Admin',
    email: 'platform@nexovital.co',
    rol: 'ADMIN_PLATAFORMA',
  },
  ADMIN_CENTRO_AYUDA: {
    id: 'usr-help-center',
    nombre: 'Help Center Admin',
    email: 'help.center@nexovital.co',
    rol: 'ADMIN_CENTRO_AYUDA',
  },
  ADMIN_ACOPIO: {
    id: 'usr-supply',
    nombre: 'Supply Center Admin',
    email: 'supply@nexovital.co',
    rol: 'ADMIN_ACOPIO',
  },
  CONDUCTOR: {
    id: 'usr-driver',
    nombre: 'Ambulance Driver',
    email: 'driver@nexovital.co',
    rol: 'CONDUCTOR',
  },
  CIUDADANO: {
    id: 'usr-citizen',
    nombre: 'Citizen',
    email: 'citizen@nexovital.co',
    rol: 'CIUDADANO',
  },
};

/** Roles available from the dev picker on the login screen. */
export const DEV_ROLES: RolUsuario[] = [
  'ADMIN_CENTRO_AYUDA',
  'CONDUCTOR',
  'ADMIN_ACOPIO',
  'ADMIN_PLATAFORMA',
];

interface SessionState {
  user: Usuario | null;
  role: RolUsuario | null;
  token: string | null;
  login: (role: RolUsuario) => void;
  logout: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  role: null,
  token: null,
  login: (role) =>
    set({
      user: MOCK_USERS[role],
      role,
      token: `mock.${role.toLowerCase()}`,
    }),
  logout: () => set({ user: null, role: null, token: null }),
}));

export { MOCK_USERS };
