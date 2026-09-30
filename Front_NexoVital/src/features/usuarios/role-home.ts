import type { RolUsuario } from '@/types/domain';

/**
 * Landing screen kind assigned to each role.
 *
 * `Record<RolUsuario, ...>` is intentional: every role in the contract has to
 * declare its destination, so adding a role without a screen is a compile-time
 * error rather than a silent fall-through to a screen that is not its own. A
 * `null` value means "this role has no screen in this version": it is blocked at
 * login and on hydration (see LoginPage, guards and session.ts). The three
 * administrative roles are `null` on purpose: this build only ships the citizen
 * and driver surfaces, so those roles cannot enter.
 */
export type RoleHomeKind = 'DRIVER_CONSOLE' | 'CITIZEN_MAP';

export const ROLE_HOME: Record<RolUsuario, RoleHomeKind | null> = {
  ADMIN_PLATAFORMA: null,
  ADMIN_CENTRO_AYUDA: null,
  ADMIN_ACOPIO: null,
  CONDUCTOR: 'DRIVER_CONSOLE',
  CIUDADANO: 'CITIZEN_MAP',
};

/**
 * Spanish role names used in user-facing messages. Exhaustive by construction
 * as well, so a new role cannot ship without a readable name.
 */
export const ROLE_LABEL: Record<RolUsuario, string> = {
  ADMIN_PLATAFORMA: 'Administrador de plataforma',
  ADMIN_CENTRO_AYUDA: 'Administrador de centro de ayuda',
  ADMIN_ACOPIO: 'Administrador de centro de acopio',
  CONDUCTOR: 'Conductor de ambulancia',
  CIUDADANO: 'Ciudadano',
};

/**
 * Destination for `role`, or `null` when the role has no screen yet. An unknown
 * runtime role (not present in the contract) also resolves to `null`, so it can
 * never inherit another role's screen by accident.
 */
export function resolveRoleHome(role: RolUsuario | null): RoleHomeKind | null {
  if (!role) {
    return null;
  }
  return ROLE_HOME[role] ?? null;
}

/** True when the role maps to a screen this build can render. */
export function hasRoleHome(role: RolUsuario | null): boolean {
  return resolveRoleHome(role) !== null;
}

/** Spanish message shown when a role authenticates but has no screen yet. */
export function roleWithoutHomeMessage(role: RolUsuario): string {
  return `El perfil ${ROLE_LABEL[role]} todavía no tiene una pantalla en esta versión.`;
}
