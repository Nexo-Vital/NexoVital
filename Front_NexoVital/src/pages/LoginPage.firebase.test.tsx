import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSessionStore } from '@/features/usuarios/session';
import LoginPage from './LoginPage';

/**
 * Login con Firebase configurado (docker y Azure), EP-06.F2.US1 T10/T12: dos
 * pestañas, correo y contraseña validados por Firebase, Google como segunda
 * opción y "Crear cuenta" solo con Google. Firebase no se llama: se simula.
 */
const firebase = vi.hoisted(() => ({
  loginFirebase: vi.fn(),
  loginGoogleFirebase: vi.fn(),
}));

vi.mock('@/services/firebase', () => ({
  isFirebaseConfigured: () => true,
  loginFirebase: firebase.loginFirebase,
  loginGoogleFirebase: firebase.loginGoogleFirebase,
  logoutFirebase: vi.fn().mockResolvedValue(undefined),
  observarRefrescoDeToken: () => () => {},
  cuentaFirebaseActual: vi.fn().mockResolvedValue(null),
  establecerContrasenaFirebase: vi.fn(),
}));

const CIUDADANO = {
  id: 'usr-ciudadano',
  nombre: 'Ciudadano Uno',
  email: 'ciudadano@gmail.com',
  rol: 'CIUDADANO',
};

function respuesta(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** GET /sesiones/actual: responde lo que diga la prueba. */
function backendResponde(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(respuesta(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderLogin() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Inicio del rol</p>} />
          <Route path="/registro" element={<p>Pantalla de registro</p>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe('LoginPage con Firebase', () => {
  beforeEach(() => {
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('Iniciar sesión pide correo y contraseña y debajo ofrece Google', () => {
    renderLogin();

    expect(screen.getByRole('tab', { name: 'Iniciar sesión' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Usuario o correo')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeInTheDocument();
    expect(screen.queryByText(/En el MVP no hay registro/)).not.toBeInTheDocument();
  });

  it('Crear cuenta solo ofrece crear con Google', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('tab', { name: 'Crear cuenta' }));

    expect(screen.getByRole('button', { name: 'Crear cuenta con Google' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Usuario o correo')).not.toBeInTheDocument();
  });

  it('Crear cuenta con Google de una cuenta nueva lleva a elegir el rol', async () => {
    const user = userEvent.setup();
    firebase.loginGoogleFirebase.mockResolvedValue('token-google');
    backendResponde(401, { codigo: 'USUARIO_NO_REGISTRADO', mensaje: 'sin registro' });
    renderLogin();

    await user.click(screen.getByRole('tab', { name: 'Crear cuenta' }));
    await user.click(screen.getByRole('button', { name: 'Crear cuenta con Google' }));

    expect(await screen.findByText('Pantalla de registro')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('Continuar con Google de una cuenta registrada entra a su inicio', async () => {
    const user = userEvent.setup();
    firebase.loginGoogleFirebase.mockResolvedValue('token-google');
    const fetchMock = backendResponde(200, CIUDADANO);
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Continuar con Google' }));

    expect(await screen.findByText('Inicio del rol')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/sesiones/actual'),
      expect.objectContaining({ headers: { Authorization: 'Bearer token-google' } }),
    );
    expect(useSessionStore.getState().role).toBe('CIUDADANO');
  });

  it('el correo y la contraseña se validan en Firebase, no en NexoVital', async () => {
    const user = userEvent.setup();
    firebase.loginFirebase.mockResolvedValue('token-firebase');
    backendResponde(200, CIUDADANO);
    renderLogin();

    await user.type(screen.getByLabelText('Usuario o correo'), 'ciudadano@gmail.com');
    await user.type(screen.getByLabelText('Contraseña'), 'Segura2026');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Inicio del rol')).toBeInTheDocument();
    expect(firebase.loginFirebase).toHaveBeenCalledWith('ciudadano@gmail.com', 'Segura2026');
  });

  it('cerrar la ventana de Google muestra un aviso y no entra', async () => {
    const user = userEvent.setup();
    firebase.loginGoogleFirebase.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Continuar con Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cerraste la ventana de Google antes de terminar.',
    );
    expect(useSessionStore.getState().user).toBeNull();
  });
});
