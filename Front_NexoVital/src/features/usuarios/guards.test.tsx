import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RolUsuario, Usuario } from '@/types/domain';
import { RequireAuth } from './guards';
import { useSessionStore } from './session';

/**
 * Minimal Response stand-in: apiClient.getMe only reads status, ok and json(),
 * so the tests never depend on a global fetch/Response implementation. Matches
 * the style already used in LoginPage.test.tsx.
 */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function usuario(rol: RolUsuario, email = 'test@nexovital.co'): Usuario {
  return { id: `usr-${rol}`, nombre: 'Test', email, rol };
}

/**
 * A destination for every role the build can render. The administrative roles
 * are absent on purpose: they have no home, so the guard must never route them
 * into a protected screen.
 */
const DESTINATION: Partial<Record<RolUsuario, string>> = {
  CONDUCTOR: 'driver-console',
  CIUDADANO: 'citizen-map',
};

function renderGuarded() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<div data-testid="protected" />} />
          <Route
            path="/home"
            element={
              <DestinationForRole destination={(role) => DESTINATION[role] ?? 'no-destination'} />
            }
          />
        </Route>
        <Route path="/login" element={<div data-testid="login-screen" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Renders a distinct screen per role so the test can assert which one won. */
function DestinationForRole({ destination }: { destination: (role: RolUsuario) => string }) {
  const role = useSessionStore((state) => state.role);
  return <div data-testid={role ? destination(role) : 'no-destination'} />;
}

function signInAs(role: RolUsuario, token = 'jwt.test') {
  useSessionStore.setState({ user: usuario(role), role, token });
}

describe('RequireAuth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('lets a valid token in and follows the role the server returned', async () => {
    signInAs('CONDUCTOR', 'jwt.valid');
    fetchMock.mockResolvedValue(mockResponse(200, usuario('CONDUCTOR')));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/"
              element={
                <DestinationForRole destination={(r) => DESTINATION[r] ?? 'no-destination'} />
              }
            />
          </Route>
          <Route path="/login" element={<div data-testid="login-screen" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('driver-console')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sesiones/actual',
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt.valid' } }),
    );
    expect(useSessionStore.getState().token).toBe('jwt.valid');
  });

  it('clears the session and redirects to /login when the token is rejected (401)', async () => {
    signInAs('ADMIN_CENTRO_AYUDA', 'jwt.expired');
    fetchMock.mockResolvedValue(mockResponse(401, { mensaje: 'expirado' }));

    renderGuarded();

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    await waitFor(() => expect(useSessionStore.getState().token).toBeNull());
    expect(sessionStorage.getItem('nexovital.token')).toBeNull();
  });

  it('lets the server role decide the destination over the stale stored role', async () => {
    // The stored session says CIUDADANO, the server says CONDUCTOR: server wins.
    signInAs('CIUDADANO', 'jwt.reassigned');
    fetchMock.mockResolvedValue(mockResponse(200, usuario('CONDUCTOR')));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route
              path="/"
              element={
                <DestinationForRole destination={(r) => DESTINATION[r] ?? 'no-destination'} />
              }
            />
          </Route>
          <Route path="/login" element={<div data-testid="login-screen" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('driver-console')).toBeInTheDocument();
    expect(screen.queryByTestId('citizen-map')).not.toBeInTheDocument();
    expect(useSessionStore.getState().role).toBe('CONDUCTOR');
  });

  it('blocks a server role outside the contract, same as at login', async () => {
    signInAs('CONDUCTOR', 'jwt.downgraded');
    // The blocked cases are a role the contract does not know (e.g. a future
    // backend role) and the administrative roles, which have no home.
    fetchMock.mockResolvedValue(mockResponse(200, usuario('INSPECTOR' as RolUsuario)));

    renderGuarded();

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('blocks an administrative server role that has no home', async () => {
    signInAs('CONDUCTOR', 'jwt.admin');
    fetchMock.mockResolvedValue(mockResponse(200, usuario('ADMIN_ACOPIO')));

    renderGuarded();

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(useSessionStore.getState().role).toBe('ADMIN_ACOPIO');
  });

  it('redirects with no token and never calls the session endpoint', async () => {
    renderGuarded();

    expect(await screen.findByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the loading state instead of the protected screen while validating', async () => {
    signInAs('CONDUCTOR', 'jwt.pending');
    let resolveFetch: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderGuarded();

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();

    resolveFetch(mockResponse(200, usuario('CONDUCTOR')));
    expect(await screen.findByTestId('protected')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-loading')).not.toBeInTheDocument();
  });
});
