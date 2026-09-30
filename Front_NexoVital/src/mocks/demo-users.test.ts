import { describe, expect, it } from 'vitest';
import { DEMO_USERS } from '@/features/usuarios/session';
import { DEMO_ACCOUNTS, findDemoAccount } from '@/mocks/demo-users';
import type { RolUsuario } from '@/types/domain';

const ROLES: RolUsuario[] = [
  'ADMIN_CENTRO_AYUDA',
  'ADMIN_PLATAFORMA',
  'ADMIN_ACOPIO',
  'CIUDADANO',
  'CONDUCTOR',
];

/** Both lists carry the same credentials under the same role, in any order. */
function credentials(account: { email: string; password: string; rol: RolUsuario }): string {
  return `${account.rol}|${account.email}|${account.password}`;
}

describe('demo catalog', () => {
  it('covers the five canonical roles with unique emails', () => {
    const emails = DEMO_ACCOUNTS.map((account) => account.email);
    expect(new Set(emails).size).toBe(DEMO_ACCOUNTS.length);
    expect(DEMO_ACCOUNTS).toHaveLength(11);
    expect(DEMO_ACCOUNTS.filter((account) => account.rol === 'CONDUCTOR')).toHaveLength(5);
    expect(DEMO_ACCOUNTS.filter((account) => account.rol === 'CIUDADANO')).toHaveLength(2);
    for (const rol of ROLES) {
      expect(DEMO_ACCOUNTS.some((account) => account.rol === rol)).toBe(true);
    }
  });

  it('matches the credentials advertised by the login profiles panel', () => {
    const catalog = DEMO_ACCOUNTS.map(credentials).sort();
    const panel = DEMO_USERS.map(credentials).sort();
    expect(catalog).toEqual(panel);
  });

  it('resolves only an exact email AND password match', () => {
    const account = DEMO_ACCOUNTS[0];
    expect(findDemoAccount(account.email, account.password)).toEqual(account);
    expect(findDemoAccount(account.email, 'wrong-password')).toBeUndefined();
    expect(findDemoAccount('nobody@nexovital.co', account.password)).toBeUndefined();
  });
});
