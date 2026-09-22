import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY, TOKEN_KEY } from '@/services/apiClient';

const CIUDADANO = {
  id: 'usr-ciudadano',
  nombre: 'Ciudadano Uno',
  email: 'ciudadano@nexovital.co',
  rol: 'CIUDADANO',
};

const ADMIN = {
  id: 'usr-admin',
  nombre: 'Rangel Dev',
  email: 'rangel@nexovital.co',
  rol: 'ADMIN_CENTRO_AYUDA',
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
    localStorage.setItem(TOKEN_KEY, 'jwt.stale');
    localStorage.setItem(SESSION_KEY, JSON.stringify(CIUDADANO));

    const { useSessionStore } = await import('./session');

    expect(useSessionStore.getState()).toMatchObject({ user: null, role: null, token: null });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('restores a stored session whose role has a screen', async () => {
    localStorage.setItem(TOKEN_KEY, 'jwt.ok');
    localStorage.setItem(SESSION_KEY, JSON.stringify(ADMIN));

    const { useSessionStore } = await import('./session');

    expect(useSessionStore.getState()).toMatchObject({
      token: 'jwt.ok',
      role: 'ADMIN_CENTRO_AYUDA',
      user: { email: ADMIN.email },
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
    localStorage.setItem(TOKEN_KEY, 'jwt.stale');
    localStorage.setItem(SESSION_KEY, JSON.stringify(ADMIN));

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
    expect(localStorage.getItem(TOKEN_KEY)).toBe('jwt.renewed');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({
      rol: 'CONDUCTOR',
    });
  });
});
