import { describe, expect, it } from 'vitest';
import type { RolUsuario } from '@/types/domain';
import {
  hasRoleHome,
  ROLE_HOME,
  ROLE_LABEL,
  resolveRoleHome,
  roleWithoutHomeMessage,
} from './role-home';

const ROLES: RolUsuario[] = [
  'ADMIN_PLATAFORMA',
  'ADMIN_CENTRO_AYUDA',
  'ADMIN_ACOPIO',
  'CONDUCTOR',
  'CIUDADANO',
];

describe('role destinations', () => {
  it('declares a destination and a label for every contract role', () => {
    expect(Object.keys(ROLE_HOME).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...ROLES].sort());
  });

  it('maps only the three operations roles to the CRUE room', () => {
    const operations = ROLES.filter((role) => ROLE_HOME[role] === 'OPERATIONS');
    expect(operations.sort()).toEqual(['ADMIN_ACOPIO', 'ADMIN_CENTRO_AYUDA', 'ADMIN_PLATAFORMA']);
  });

  it('maps the citizen to the citizen map', () => {
    expect(ROLE_HOME.CIUDADANO).toBe('CITIZEN_MAP');
    expect(resolveRoleHome('CIUDADANO')).toBe('CITIZEN_MAP');
    expect(hasRoleHome('CIUDADANO')).toBe(true);
  });

  it('treats a missing or unknown role as having no destination', () => {
    expect(resolveRoleHome(null)).toBeNull();
    expect(hasRoleHome(null)).toBe(false);
    // A role outside the current contract (e.g. a future backend role) must not
    // inherit the operations room by default.
    expect(resolveRoleHome('INSPECTOR' as RolUsuario)).toBeNull();
  });

  it('derives the blocked-role message from the role name', () => {
    expect(roleWithoutHomeMessage('CIUDADANO')).toBe(
      'El perfil Ciudadano todavía no tiene una pantalla en esta versión.',
    );
  });
});
