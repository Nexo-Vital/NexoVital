import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_ACCOUNTS } from '@/mocks/demo-users';
import {
  ApiError,
  getMe,
  login,
  SESSION_KEY,
  setSession,
  setToken,
  TOKEN_KEY,
} from '@/services/apiClient';
import type { Usuario } from '@/types/domain';

/**
 * Minimal Response stand-in: apiClient only reads status, ok, headers.get and
 * json(), so the test never depends on a global fetch/Response implementation.
 * Matches the style already used in LoginPage.test.tsx.
 */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** Turns on the build-time flag for a single case. */
function enableDemoMode(): void {
  vi.stubEnv('VITE_DEMO_MODE', '1');
}

describe('apiClient demo mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    // The flag is unset by default: every other suite keeps the real path.
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('signs in from the hardcoded catalog without touching the network', async () => {
    enableDemoMode();
    const account = DEMO_ACCOUNTS[0];

    const { token, usuario } = await login(account.email, account.password);

    expect(usuario).toMatchObject({
      id: account.id,
      nombre: account.nombre,
      email: account.email,
      rol: account.rol,
    });
    expect(token).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
    // Identical persisted shape to the real path, with no extra fields.
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')).toEqual(usuario);
  });

  it('rejects an email outside the catalog with the backend 401 contract', async () => {
    enableDemoMode();

    const error = await login('nobody@nexovital.co', 'nobody123').catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: 'Credenciales inválidas.',
      codigo: 'CREDENCIALES_INVALIDAS',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('rejects a catalog email paired with the wrong password', async () => {
    enableDemoMode();
    const account = DEMO_ACCOUNTS[0];

    const error = await login(account.email, 'not-the-password').catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: 'Credenciales inválidas.',
      codigo: 'CREDENCIALES_INVALIDAS',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the persisted session without touching the network', async () => {
    enableDemoMode();
    const account = DEMO_ACCOUNTS[1];
    const usuario: Usuario = {
      id: account.id,
      nombre: account.nombre,
      email: account.email,
      rol: account.rol,
    };
    setToken('demo.persisted');
    setSession(usuario);

    await expect(getMe('demo.persisted')).resolves.toEqual(usuario);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects with the backend 401 when there is no persisted session', async () => {
    enableDemoMode();

    const error = await getMe('demo.token').catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Sesión expirada o no autenticado' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the real network path when the flag is unset', async () => {
    const usuario: Usuario = {
      id: 'usr-real',
      nombre: 'Real User',
      email: 'real@nexovital.co',
      rol: 'CONDUCTOR',
    };
    fetchMock.mockResolvedValue(mockResponse(200, { token: 'jwt.real', usuario }));

    const { token } = await login(usuario.email, 'real123');

    expect(token).toBe('jwt.real');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sesiones',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: usuario.email, password: 'real123' }),
      }),
    );
  });
});
