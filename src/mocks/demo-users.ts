import type { RolUsuario } from '@/types/domain';

/**
 * Build-time demo catalog for the deployed build (`VITE_DEMO_MODE=1`).
 *
 * It mirrors, one to one, the ten users the backend seeds (`DataSeeder.java`,
 * design decision D2): same emails, passwords and roles. Keeping both lists in
 * sync is what makes the login screen, the demo profiles panel and the deployed
 * demo agree about who can sign in. The plaintext password exists only here and
 * in the seeder: the real backend stores it as a BCrypt hash.
 */
export interface DemoAccount {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  password: string;
}

/** Shared password for every seeded conductor, as in `DataSeeder`. */
const CONDUCTOR_PASSWORD = 'conductor123';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: 'usr-demo-rangel',
    nombre: 'Rangel Dev',
    email: 'rangel@nexovital.co',
    rol: 'ADMIN_CENTRO_AYUDA',
    password: 'rangel123',
  },
  {
    id: 'usr-demo-admin-plataforma',
    nombre: 'Admin Plataforma',
    email: 'admin@nexovital.co',
    rol: 'ADMIN_PLATAFORMA',
    password: 'admin123',
  },
  {
    id: 'usr-demo-centro-ayuda',
    nombre: 'Coordinación CRUE',
    email: 'centro@nexovital.co',
    rol: 'ADMIN_CENTRO_AYUDA',
    password: 'centro123',
  },
  {
    id: 'usr-demo-acopio',
    nombre: 'Admin Acopio Bogotá',
    email: 'acopio@nexovital.co',
    rol: 'ADMIN_ACOPIO',
    password: 'acopio123',
  },
  {
    id: 'usr-demo-ciudadano',
    nombre: 'Ciudadano Demo',
    email: 'ciudadano@nexovital.co',
    rol: 'CIUDADANO',
    password: 'ciudadano123',
  },
  {
    id: 'usr-demo-conductor-1',
    nombre: 'Conductor ABC101',
    email: 'conductor1@nexovital.co',
    rol: 'CONDUCTOR',
    password: CONDUCTOR_PASSWORD,
  },
  {
    id: 'usr-demo-conductor-2',
    nombre: 'Conductor ABC202',
    email: 'conductor2@nexovital.co',
    rol: 'CONDUCTOR',
    password: CONDUCTOR_PASSWORD,
  },
  {
    id: 'usr-demo-conductor-3',
    nombre: 'Conductor ABC303',
    email: 'conductor3@nexovital.co',
    rol: 'CONDUCTOR',
    password: CONDUCTOR_PASSWORD,
  },
  {
    id: 'usr-demo-conductor-4',
    nombre: 'Conductor ABC404',
    email: 'conductor4@nexovital.co',
    rol: 'CONDUCTOR',
    password: CONDUCTOR_PASSWORD,
  },
  {
    id: 'usr-demo-conductor-5',
    nombre: 'Conductor ABC505',
    email: 'conductor5@nexovital.co',
    rol: 'CONDUCTOR',
    password: CONDUCTOR_PASSWORD,
  },
];

/** The seeded account whose email AND password match, or `undefined`. */
export function findDemoAccount(email: string, password: string): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find((account) => account.email === email && account.password === password);
}
