import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  getMe,
  getSession,
  getToken,
  SESSION_KEY,
  setSession,
  setToken,
  TOKEN_KEY,
} from '@/services/apiClient';
import type { Usuario } from '@/types/domain';

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('apiFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('wraps a rejected fetch in the Spanish ApiError instead of leaking the browser message', async () => {
    // A down backend or no network rejects `fetch` with a native TypeError whose
    // message is English ("Failed to fetch"). It must never reach the consumer.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await apiFetch('/emergencias').catch((reason) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toBe('No se pudo conectar al servidor');
    expect(error.message).not.toBe('Failed to fetch');
    expect(error.codigo).toBeUndefined();
  });

  it('lets the backend ApiError from a !ok envelope bubble up unchanged', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_REGISTRO_EMERGENCIA',
        mensaje: 'No se pudo registrar la emergencia.',
      }),
    );

    const error = (await apiFetch('/emergencias').catch((reason) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.codigo).toBe('ERROR_REGISTRO_EMERGENCIA');
    expect(error.message).toBe('No se pudo registrar la emergencia.');
  });
});

/**
 * `getMe` has its own `fetch`, so it had the same defect `apiFetch` had: a
 * rejected fetch leaked the browser's English TypeError. Pinned here so the two
 * call sites cannot drift apart again.
 */
describe('getMe', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps a rejected fetch in the Spanish ApiError, same as apiFetch', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = (await getMe('jwt.test').catch((reason) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toBe('No se pudo conectar al servidor');
    expect(error.message).not.toBe('Failed to fetch');
  });
});

/**
 * The session is scoped PER TAB so two tabs can hold two different roles at
 * once. `localStorage` is origin-global, so storing the session there let any
 * other tab overwrite it and broke the multi-role demo. This is the regression
 * guard: it fails if the accessors ever drift back to `localStorage`.
 */
describe('session storage scope', () => {
  const USER: Usuario = {
    id: 'usr-scope',
    nombre: 'Scope Test',
    email: 'scope@nexovital.co',
    rol: 'CIUDADANO',
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('persists token and session in sessionStorage, never in localStorage', () => {
    setToken('jwt.tab');
    setSession(USER);

    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('jwt.tab');
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')).toEqual(USER);
    expect(getToken()).toBe('jwt.tab');
    expect(getSession()).toEqual(USER);

    // The origin-global store must stay untouched: another tab owns that scope.
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
