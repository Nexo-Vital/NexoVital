import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY, TOKEN_KEY } from '@/services/apiClient';

/**
 * Role the contract does not know. Hydration has to drop any stored session
 * whose role has no screen, whether the role is unknown or a contract role this
 * build does not ship.
 */
const UNKNOWN_ROLE = {
  id: 'usr-unknown',
  nombre: 'Unknown Role',
  email: 'unknown@nexovital.co',
  rol: 'INSPECTOR',
};

const CITIZEN = {
  id: 'usr-citizen',
  nombre: 'Ciudadano Demo',
  email: 'ciudadano@nexovital.co',
  rol: 'CIUDADANO',
};

/** An administrative role that still has no screen in this version. */
const ADMIN = {
  id: 'usr-admin',
  nombre: 'Paula Méndez',
  email: 'admin@nexovital.co',
  rol: 'ADMIN_PLATAFORMA',
};

/**
 * Hydration runs once, when the store module is first imported, so each case
 * resets the module registry and imports a fresh copy after seeding storage.
 */
describe('session hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('drops a stored session whose role has no screen and clears storage', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'jwt.stale');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(UNKNOWN_ROLE));

    const { useSessionStore } = await import('./session');

    expect(useSessionStore.getState()).toMatchObject({ user: null, role: null, token: null });
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('drops a stored administrative session that has no screen', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'jwt.admin');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ADMIN));

    const { useSessionStore } = await import('./session');

    expect(useSessionStore.getState()).toMatchObject({ user: null, role: null, token: null });
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('restores a stored session whose role has a screen', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'jwt.ok');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(CITIZEN));

    const { useSessionStore } = await import('./session');

    expect(useSessionStore.getState()).toMatchObject({
      token: 'jwt.ok',
      role: 'CIUDADANO',
      user: { email: CITIZEN.email },
    });
  });
});

describe('applyServerSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('replaces the stored session with the server user and persists it', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'jwt.stale');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ADMIN));

    const { useSessionStore } = await import('./session');
    const CONDUCTOR = {
      id: 'usr-conductor',
      nombre: 'Conductor',
      email: 'conductor1@nexovital.co',
      rol: 'CONDUCTOR' as const,
    };

    useSessionStore.getState().applyServerSession('jwt.renewed', CONDUCTOR);

    expect(useSessionStore.getState()).toMatchObject({
      token: 'jwt.renewed',
      role: 'CONDUCTOR',
      user: { email: CONDUCTOR.email },
    });
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('jwt.renewed');
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({
      rol: 'CONDUCTOR',
    });
  });
});
