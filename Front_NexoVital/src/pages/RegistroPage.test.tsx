import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import { ApiError } from '@/services/apiClient';
import RegistroPage, {
  normalizarPlaca,
  OPCIONES_DE_ROL,
  validarContrasena,
  validarRegistro,
} from './RegistroPage';

const firebase = vi.hoisted(() => ({
  cuentaFirebaseActual: vi.fn(),
  establecerContrasenaFirebase: vi.fn(),
  logoutFirebase: vi.fn(),
}));

const api = vi.hoisted(() => ({ registrarCuenta: vi.fn() }));

vi.mock('@/services/firebase', async (original) => ({
  ...(await original<typeof import('@/services/firebase')>()),
  cuentaFirebaseActual: firebase.cuentaFirebaseActual,
  establecerContrasenaFirebase: firebase.establecerContrasenaFirebase,
  logoutFirebase: firebase.logoutFirebase,
}));

vi.mock('@/services/apiClient', async (original) => ({
  ...(await original<typeof import('@/services/apiClient')>()),
  registrarCuenta: api.registrarCuenta,
}));

const CUENTA = { token: 'token-google', email: 'persona@gmail.com', nombre: 'Persona' };
const CLAVE = 'Segura2026';

function renderRegistro() {
  return render(
    <MemoryRouter initialEntries={['/registro']}>
      <Routes>
        <Route path="/registro" element={<RegistroPage />} />
        <Route path="/" element={<p>Inicio del rol</p>} />
        <Route path="/login" element={<p>Pantalla de login</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function escribirContrasena(user: ReturnType<typeof userEvent.setup>, clave = CLAVE) {
  await user.type(screen.getByLabelText('Crea tu contraseña'), clave);
  await user.type(screen.getByLabelText('Confirma tu contraseña'), clave);
}

describe('validarContrasena', () => {
  it('exige mínimo 8 caracteres, mayúscula, minúscula y número', () => {
    const reglas = /mínimo 8 caracteres, una mayúscula, una minúscula y un número/;
    expect(validarContrasena('Corta1', 'Corta1')).toMatch(reglas);
    expect(validarContrasena('sinmayuscula1', 'sinmayuscula1')).toMatch(reglas);
    expect(validarContrasena('SINMINUSCULA1', 'SINMINUSCULA1')).toMatch(reglas);
    expect(validarContrasena('SinNumeroAqui', 'SinNumeroAqui')).toMatch(reglas);
  });

  it('no exige símbolo', () => {
    expect(validarContrasena('Segura2026', 'Segura2026')).toBeNull();
  });

  it('exige que la confirmación coincida', () => {
    expect(validarContrasena('Segura2026', 'Segura2027')).toBe('Las contraseñas no coinciden.');
  });
});

describe('validarRegistro', () => {
  it('pide elegir un rol', () => {
    expect(validarRegistro(null, '', '', CLAVE, CLAVE)).toBe('Elige cómo vas a usar NexoVital.');
  });

  it('no pide vehículo al ciudadano ni al administrador de centro', () => {
    expect(validarRegistro('CIUDADANO', '', '', CLAVE, CLAVE)).toBeNull();
    expect(validarRegistro('ADMIN_CENTRO_AYUDA', '', '', CLAVE, CLAVE)).toBeNull();
  });

  it('exige placa con formato ABC123 y modelo al conductor', () => {
    expect(validarRegistro('CONDUCTOR', '', 'Renault', CLAVE, CLAVE)).toBe(
      'Escribe la placa del vehículo.',
    );
    expect(validarRegistro('CONDUCTOR', 'AB12', 'Renault', CLAVE, CLAVE)).toMatch(
      /tres letras y tres números/,
    );
    expect(validarRegistro('CONDUCTOR', 'abc-123', '  ', CLAVE, CLAVE)).toBe(
      'Escribe el modelo del vehículo.',
    );
    expect(validarRegistro('CONDUCTOR', 'abc 123', 'Renault Master', CLAVE, CLAVE)).toBeNull();
  });

  it('valida la contraseña para cualquier rol', () => {
    expect(validarRegistro('CIUDADANO', '', '', 'debil', 'debil')).toMatch(/mínimo 8/);
  });

  it('normaliza la placa como el backend', () => {
    expect(normalizarPlaca(' abc-123 ')).toBe('ABC123');
  });

  it('nunca ofrece administrador de plataforma ni de acopio', () => {
    const roles = OPCIONES_DE_ROL.map((opcion) => opcion.rol);
    expect(roles).toEqual(['CIUDADANO', 'ADMIN_CENTRO_AYUDA', 'CONDUCTOR']);
  });
});

describe('RegistroPage', () => {
  beforeEach(() => {
    firebase.cuentaFirebaseActual.mockResolvedValue(CUENTA);
    firebase.establecerContrasenaFirebase.mockResolvedValue(undefined);
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('sin sesión de Google vuelve al login', async () => {
    firebase.cuentaFirebaseActual.mockResolvedValue(null);
    renderRegistro();

    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });

  it('muestra el correo con el que podrá entrar', async () => {
    renderRegistro();

    expect(await screen.findByText(/Entraste con persona@gmail.com/)).toBeInTheDocument();
  });

  it('pide placa y modelo solo al conductor y no envía una placa inválida', async () => {
    const user = userEvent.setup();
    renderRegistro();

    expect(screen.queryByLabelText('Placa del vehículo')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Conductor de ambulancia/));
    await user.type(screen.getByLabelText('Placa del vehículo'), 'AB12');
    await user.type(screen.getByLabelText('Modelo del vehículo'), 'Renault Master');
    await escribirContrasena(user);
    await user.click(screen.getByRole('button', { name: /Crear mi cuenta/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('tres letras y tres números');
    expect(api.registrarCuenta).not.toHaveBeenCalled();
    expect(firebase.establecerContrasenaFirebase).not.toHaveBeenCalled();
  });

  it('no envía una contraseña que no cumple la política', async () => {
    const user = userEvent.setup();
    renderRegistro();

    await user.click(screen.getByLabelText(/^Ciudadano/));
    await escribirContrasena(user, 'sinmayuscula1');
    await user.click(screen.getByRole('button', { name: /Crear mi cuenta/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('mínimo 8 caracteres');
    expect(firebase.establecerContrasenaFirebase).not.toHaveBeenCalled();
    expect(api.registrarCuenta).not.toHaveBeenCalled();
  });

  it('guarda la contraseña en Firebase, registra al conductor y entra a su inicio', async () => {
    const user = userEvent.setup();
    const usuario = { id: 'u-1', nombre: 'Persona', email: CUENTA.email, rol: 'CONDUCTOR' };
    api.registrarCuenta.mockResolvedValue(usuario);
    renderRegistro();

    await user.click(screen.getByLabelText(/Conductor de ambulancia/));
    await user.type(screen.getByLabelText('Placa del vehículo'), 'abc-123');
    await user.type(screen.getByLabelText('Modelo del vehículo'), ' Renault Master ');
    await escribirContrasena(user);
    await user.click(screen.getByRole('button', { name: /Crear mi cuenta/ }));

    expect(await screen.findByText('Inicio del rol')).toBeInTheDocument();
    expect(firebase.establecerContrasenaFirebase).toHaveBeenCalledWith(CLAVE);
    expect(api.registrarCuenta).toHaveBeenCalledWith('token-google', {
      rol: 'CONDUCTOR',
      placa: 'ABC123',
      modelo: 'Renault Master',
    });
    await waitFor(() => expect(useSessionStore.getState().role).toBe('CONDUCTOR'));
  });

  it('si Firebase no acepta la contraseña, no registra el usuario', async () => {
    const user = userEvent.setup();
    firebase.establecerContrasenaFirebase.mockRejectedValue({ code: 'auth/email-already-in-use' });
    renderRegistro();

    await user.click(screen.getByLabelText(/^Ciudadano/));
    await escribirContrasena(user);
    await user.click(screen.getByRole('button', { name: /Crear mi cuenta/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una cuenta con contraseña para este correo',
    );
    expect(api.registrarCuenta).not.toHaveBeenCalled();
  });

  it('muestra el error del backend, por ejemplo una placa repetida', async () => {
    const user = userEvent.setup();
    api.registrarCuenta.mockRejectedValue(
      new ApiError(409, 'Ya hay un vehículo registrado con la placa ABC101.', 'PLACA_DUPLICADA'),
    );
    renderRegistro();

    await user.click(screen.getByLabelText(/Conductor de ambulancia/));
    await user.type(screen.getByLabelText('Placa del vehículo'), 'ABC101');
    await user.type(screen.getByLabelText('Modelo del vehículo'), 'Renault Master');
    await escribirContrasena(user);
    await user.click(screen.getByRole('button', { name: /Crear mi cuenta/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya hay un vehículo registrado con la placa ABC101.',
    );
    expect(useSessionStore.getState().user).toBeNull();
  });
});
