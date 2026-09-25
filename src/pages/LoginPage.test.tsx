import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useThemeStore } from '@/features/tema/theme-store';
import { DEMO_USERS, useSessionStore } from '@/features/usuarios/session';
import { SESSION_KEY, TOKEN_KEY } from '@/services/apiClient';
import LoginPage from './LoginPage';

const ADMIN = {
  id: 'usr-1',
  nombre: 'Rangel Dev',
  email: 'rangel@nexovital.co',
  rol: 'ADMIN_CENTRO_AYUDA',
};

/** Citizen account, whose role now lands on the citizen map. */
const CIUDADANO = {
  id: 'usr-ciudadano',
  nombre: 'Ciudadano Uno',
  email: 'ciudadano@nexovital.co',
  rol: 'CIUDADANO',
};

/** Seeded profile of a role, or a loud failure when the seed changed shape. */
function seededProfile(rol: 'CIUDADANO' | 'CONDUCTOR') {
  const profile = DEMO_USERS.find((candidate) => candidate.rol === rol);
  if (!profile) {
    throw new Error(`seed data changed: expected a seeded ${rol} profile`);
  }
  return profile;
}

/** Profiles the login panel offers: the MVP personas, citizen and driver. */
const MVP_PROFILES = DEMO_USERS.filter(
  (profile) => profile.rol === 'CIUDADANO' || profile.rol === 'CONDUCTOR',
);

/** Citizen row: a single MVP role, so it is not inside a collapsed role group. */
const DEMO_PROFILE = seededProfile('CIUDADANO');
/** Driver row: it lives inside the "Conductores de ambulancia" group. */
const OTHER_PROFILE = seededProfile('CONDUCTOR');

/** Characters typed by the autofill: both credentials, one keystroke per delay. */
const TYPED_CHARACTERS = DEMO_PROFILE.email.length + DEMO_PROFILE.password.length;
/** Must match TYPE_DELAY_MS in LoginPage. */
const TYPE_DELAY_MS = 20;
/** Instant the last character lands on screen; the submit follows one delay later. */
const TYPING_MS = (TYPED_CHARACTERS - 1) * TYPE_DELAY_MS;
/** Enough runway for the final delay, the fetch and the redirect. */
const AUTOFILL_BUDGET_MS = TYPED_CHARACTERS * TYPE_DELAY_MS + 200;

/**
 * Minimal Response stand-in: apiClient only reads status, ok, headers.get and
 * json(), so the tests never depend on a global fetch/Response implementation.
 */
function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const entries = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => entries.get(name.toLowerCase()) ?? null },
    json: async () => body,
  } as unknown as Response;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The demo row for an email, located through the accessible name it declares. */
function profileRow(email: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(escapeRegExp(email)) });
}

/** jsdom has no matchMedia preference plumbing; drive reduced motion directly. */
function mockReducedMotion(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
}

function renderLogin() {
  return render(
    <TooltipProvider>
      <MemoryRouter
        initialEntries={['/login']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div data-testid="home" />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Usuario o correo'), ADMIN.email);
  await user.type(screen.getByLabelText('Contraseña'), 'rangel123');
}

describe('LoginPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useSessionStore.setState({ user: null, role: null, token: null });
    useThemeStore.setState({ theme: 'system', resolvedTheme: 'light' });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('logs in against the backend, stores the session and redirects', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { token: 'jwt.real', usuario: ADMIN }));
    const user = userEvent.setup();
    renderLogin();

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sesiones',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: ADMIN.email, password: 'rangel123' }),
      }),
    );
    expect(useSessionStore.getState()).toMatchObject({
      token: 'jwt.real',
      role: 'ADMIN_CENTRO_AYUDA',
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('jwt.real');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({
      email: ADMIN.email,
    });
  });

  it('lets a citizen in and keeps the session, now that the role has a screen', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { token: 'jwt.ciudadano', usuario: CIUDADANO }));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Usuario o correo'), CIUDADANO.email);
    await user.type(screen.getByLabelText('Contraseña'), 'ciudadano123');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    // The citizen lands on their screen instead of being logged out with the
    // old "no screen in this version" message.
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState()).toMatchObject({
      token: 'jwt.ciudadano',
      role: 'CIUDADANO',
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('jwt.ciudadano');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({
      rol: 'CIUDADANO',
    });
  });

  it('shows the backend message on 401 and stays on the login screen', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Credenciales inválidas' }),
    );
    const user = userEvent.setup();
    renderLogin();

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
    expect(screen.queryByTestId('home')).not.toBeInTheDocument();
    expect(useSessionStore.getState().token).toBeNull();
  });

  it('shows the lock message with a live countdown and disables the form on 423', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(
        423,
        { codigo: 'CUENTA_BLOQUEADA', mensaje: 'Cuenta bloqueada temporalmente' },
        { 'Retry-After': '3' },
      ),
    );
    const user = userEvent.setup();
    renderLogin();

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/bloqueada/i);
    expect(alert).toHaveTextContent('3');

    expect(screen.getByLabelText('Usuario o correo')).toBeDisabled();
    expect(screen.getByLabelText('Contraseña')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('2'), {
      timeout: 3000,
    });
  });

  it('offers only the MVP profiles, each with its description', async () => {
    const user = userEvent.setup();
    renderLogin();

    // Grouped roles stay collapsed until asked, so the panel does not become a wall of rows.
    await user.click(screen.getByRole('button', { name: /Conductores de ambulancia/ }));

    for (const profile of MVP_PROFILES) {
      const row = profileRow(profile.email);
      expect(row).toBeEnabled();
      expect(within(row).getByText(profile.email)).toBeInTheDocument();
      expect(within(row).getByText(profile.descripcion)).toBeInTheDocument();
    }

    expect(screen.getAllByText('Recibe y responde solicitudes de ambulancia')).toHaveLength(5);
    expect(screen.getByText('Solicita una ambulancia y reporta emergencias')).toBeInTheDocument();

    // The seeded administrators are not offered: this panel is what the demo shows.
    expect(
      screen.queryByRole('button', { name: /Administradores de centro de ayuda/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Opera la sala de operaciones CRUE')).not.toBeInTheDocument();
    expect(screen.queryByText('Administra la plataforma y los usuarios')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Gestiona el inventario y las donaciones del centro de acopio'),
    ).not.toBeInTheDocument();
  });

  it('types the selected profile credentials and posts them to the login endpoint once', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(mockResponse(200, { token: 'jwt.real', usuario: ADMIN }));
    renderLogin();

    fireEvent.click(profileRow(DEMO_PROFILE.email));

    // First keystroke lands synchronously, the rest are driven by the timer queue.
    expect(screen.getByLabelText('Usuario o correo')).toHaveValue(DEMO_PROFILE.email.slice(0, 1));

    const progressMs = 40;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(progressMs);
    });
    expect(screen.getByLabelText('Usuario o correo')).toHaveValue(DEMO_PROFILE.email.slice(0, 3));

    // The full credential is on screen before the run submits it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TYPING_MS - progressMs);
    });
    expect(screen.getByLabelText('Usuario o correo')).toHaveValue(DEMO_PROFILE.email);
    expect(screen.getByLabelText('Contraseña')).toHaveValue(DEMO_PROFILE.password);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOFILL_BUDGET_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sesiones',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: DEMO_PROFILE.email,
          password: DEMO_PROFILE.password,
        }),
      }),
    );
    // The role comes from the mocked backend response, never from the panel.
    expect(useSessionStore.getState()).toMatchObject({ token: 'jwt.real', role: ADMIN.rol });
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('ignores a second profile click while the typewriter is running', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(mockResponse(200, { token: 'jwt.real', usuario: ADMIN }));
    renderLogin();

    // The driver role is grouped, so its rows exist only after expanding it.
    fireEvent.click(screen.getByRole('button', { name: /Conductores de ambulancia/ }));

    fireEvent.click(profileRow(DEMO_PROFILE.email));
    // Rows lock while the run is in flight, and the ref guard covers the same tick.
    expect(profileRow(OTHER_PROFILE.email)).toBeDisabled();
    fireEvent.click(profileRow(OTHER_PROFILE.email));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TYPING_MS);
    });
    // The second click never started a run, so the first profile is still the one typed.
    expect(screen.getByLabelText('Usuario o correo')).toHaveValue(DEMO_PROFILE.email);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOFILL_BUDGET_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sesiones',
      expect.objectContaining({
        body: JSON.stringify({ email: DEMO_PROFILE.email, password: DEMO_PROFILE.password }),
      }),
    );
  });

  it('fills both fields instantly when the OS asks to reduce motion', async () => {
    mockReducedMotion();
    fetchMock.mockResolvedValue(mockResponse(200, { token: 'jwt.real', usuario: ADMIN }));
    renderLogin();

    fireEvent.click(profileRow(DEMO_PROFILE.email));

    expect(screen.getByLabelText('Usuario o correo')).toHaveValue(DEMO_PROFILE.email);
    expect(screen.getByLabelText('Contraseña')).toHaveValue(DEMO_PROFILE.password);
    expect(await screen.findByTestId('home')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the labels and the error region when an autofilled login is rejected', async () => {
    mockReducedMotion();
    fetchMock.mockResolvedValue(
      mockResponse(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Credenciales inválidas' }),
    );
    renderLogin();

    fireEvent.click(profileRow(DEMO_PROFILE.email));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
    expect(screen.getByLabelText('Usuario o correo')).toHaveValue(DEMO_PROFILE.email);
    expect(screen.getByLabelText('Contraseña')).toHaveValue(DEMO_PROFILE.password);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('toggles the password visibility with a Spanish-labeled eye button', async () => {
    const user = userEvent.setup();
    renderLogin();

    const password = screen.getByLabelText('Contraseña');
    expect(password).toHaveAttribute('type', 'password');

    // Hidden by default: the control offers to reveal the password.
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(password).toHaveAttribute('type', 'text');

    // Now visible: the same control offers to hide it again.
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('renders the citizen title and the three perks in the brand panel', () => {
    renderLogin();

    expect(
      screen.getByRole('heading', { name: 'Coordinación logística para emergencias' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ambulancias cercanas, disponibles u ocupadas')).toBeInTheDocument();
    expect(screen.getByText('Centros de acopio con su semáforo de insumos')).toBeInTheDocument();
    expect(screen.getByText('Donaciones que se ven reflejadas al instante')).toBeInTheDocument();
  });

  it('shows the MVP registration notice on the sign-in card', () => {
    renderLogin();

    expect(
      screen.getByText(
        'En el MVP no hay registro: las cuentas de ciudadano y de conductor vienen precargadas.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the inline brand mark fixed across themes instead of a themed raster logo', () => {
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'light' });
    renderLogin();

    expect(screen.getByText('NexoVital')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Coordinación logística para emergencias' }),
    ).toBeInTheDocument();

    cleanup();
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' });
    renderLogin();

    // The surface is fixed: the brand mark is inline and no raster logo is
    // requested in either theme (the old files weighed hundreds of KB each).
    expect(screen.getByText('NexoVital')).toBeInTheDocument();
    expect(document.querySelector('img[src="/logo.png"]')).toBeNull();
    expect(document.querySelector('img[src="/logo-dark.png"]')).toBeNull();
  });
});
