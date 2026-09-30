import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSession, setToken, TOKEN_KEY } from '@/services/apiClient';
import type { Usuario } from '@/types/domain';
import { useSessionStore } from './session';
import { isSessionInSync, SESSION_CHANGED_MESSAGE, useSessionSync } from './session-sync';

const CITIZEN: Usuario = {
  id: 'usr-citizen',
  nombre: 'Ciudadano Demo',
  email: 'ciudadano@nexovital.co',
  rol: 'CIUDADANO',
};

const ADMIN: Usuario = {
  id: 'usr-admin',
  nombre: 'Rangel Dev',
  email: 'rangel@nexovital.co',
  rol: 'ADMIN_CENTRO_AYUDA',
};

/** Puts BOTH the in-memory session and the persisted copy in agreement. */
function signIn(usuario: Usuario, token: string): void {
  setToken(token);
  setSession(usuario);
  useSessionStore.setState({ user: usuario, role: usuario.rol, token });
}

describe('isSessionInSync', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  afterEach(() => {
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('treats a signed-out store as in sync (nothing to protect)', () => {
    expect(isSessionInSync()).toBe(true);
    // Even a foreign persisted token with no in-memory session is not our guard.
    setToken('jwt.other');
    expect(isSessionInSync()).toBe(true);
  });

  it('stays in sync while the persisted copy matches the in-memory session', () => {
    signIn(CITIZEN, 'jwt.citizen');

    expect(isSessionInSync()).toBe(true);
  });

  it('detects a foreign token written under the mounted screen', () => {
    signIn(CITIZEN, 'jwt.citizen');
    // The exact bug: another tab logs in and overwrites the shared token.
    setToken('jwt.admin');

    expect(isSessionInSync()).toBe(false);
  });

  it('detects a persisted session that belongs to another role', () => {
    signIn(CITIZEN, 'jwt.same-token');
    // Same token, different user: the persisted session was replaced.
    setSession(ADMIN);

    expect(isSessionInSync()).toBe(false);
  });
});

describe('useSessionSync', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  afterEach(() => {
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
    vi.restoreAllMocks();
  });

  function dispatchStorage(key: string): void {
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });
  }

  it('calls back when a watched key desyncs the in-memory session', () => {
    signIn(CITIZEN, 'jwt.citizen');
    const onChanged = vi.fn();
    renderHook(() => useSessionSync(onChanged));

    // The storage event fires in THIS document in tests, so change the persisted
    // copy first, exactly as another tab would have left it.
    setToken('jwt.admin');
    dispatchStorage(TOKEN_KEY);

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated storage keys and writes that stay in sync', () => {
    signIn(CITIZEN, 'jwt.citizen');
    const onChanged = vi.fn();
    renderHook(() => useSessionSync(onChanged));

    dispatchStorage('nexovital.map-filter');
    dispatchStorage(TOKEN_KEY);

    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('session desync copy', () => {
  it('names the real cause instead of a permission problem', () => {
    expect(SESSION_CHANGED_MESSAGE).toContain('sesión');
    expect(SESSION_CHANGED_MESSAGE).toContain('iniciar sesión');
    expect(SESSION_CHANGED_MESSAGE).not.toContain('permisos');
  });
});
