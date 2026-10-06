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

  it('declares no screen for the platform and supply-center administrators', () => {
    const admins: RolUsuario[] = ['ADMIN_ACOPIO', 'ADMIN_PLATAFORMA'];
    for (const role of admins) {
      expect(ROLE_HOME[role]).toBeNull();
      expect(resolveRoleHome(role)).toBeNull();
      expect(hasRoleHome(role)).toBe(false);
    }
  });

  it('maps the citizen to the citizen map', () => {
    expect(ROLE_HOME.CIUDADANO).toBe('CITIZEN_MAP');
    expect(resolveRoleHome('CIUDADANO')).toBe('CITIZEN_MAP');
    expect(hasRoleHome('CIUDADANO')).toBe(true);
  });

  it('sends the help-center administrator to their own variant of the map', () => {
    expect(ROLE_HOME.ADMIN_CENTRO_AYUDA).toBe('CENTER_ADMIN_MAP');
    expect(resolveRoleHome('ADMIN_CENTRO_AYUDA')).toBe('CENTER_ADMIN_MAP');
    expect(hasRoleHome('ADMIN_CENTRO_AYUDA')).toBe(true);
  });

  it('treats a missing or unknown role as having no destination', () => {
    expect(resolveRoleHome(null)).toBeNull();
    expect(hasRoleHome(null)).toBe(false);
    // A role outside the current contract (e.g. a future backend role) must not
    // inherit a screen by default.
    expect(resolveRoleHome('INSPECTOR' as RolUsuario)).toBeNull();
  });

  it('derives the blocked-role message from the role name', () => {
    expect(roleWithoutHomeMessage('CIUDADANO')).toBe(
      'El perfil Ciudadano todavía no tiene una pantalla en esta versión.',
    );
  });
});
