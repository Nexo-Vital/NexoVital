import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDriverOnlineStore } from '@/features/conductor/driver-online-store';
import { useSessionStore } from '@/features/usuarios/session';
import { setToken } from '@/services/apiClient';
import DriverUnitPage from './DriverUnitPage';

/** One wire unit exactly as `GET /flota/ambulancias/mia` returns it. */
const WIRE_UNIT = {
  id: 'A-07',
  placa: 'ABC-123',
  estado: 'DISPONIBLE',
  ubicacion: { lat: 4.745, lng: -74.095 },
  zona: 'Suba',
};

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('DriverUnitPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setToken('jwt.test');
    useSessionStore.setState({
      user: {
        id: 'usr-driver',
        nombre: 'Ana Conductor',
        email: 'ana@nexovital.co',
        rol: 'CONDUCTOR',
      },
      role: 'CONDUCTOR',
      token: 'jwt.test',
    });
    useDriverOnlineStore.setState({ online: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
    useDriverOnlineStore.setState({ online: false });
  });

  it('renders the unit (plate, state, zone, position) and the driver data', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_UNIT));

    render(<DriverUnitPage />);

    expect(await screen.findByText('ABC-123')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('Suba')).toBeInTheDocument();
    expect(screen.getByText('4.7450, -74.0950')).toBeInTheDocument();

    // The signed-in driver's own data comes from the session store.
    expect(screen.getByText('Ana Conductor')).toBeInTheDocument();
    expect(screen.getByText('ana@nexovital.co')).toBeInTheDocument();
    expect(screen.getByText('Conductor de ambulancia')).toBeInTheDocument();
  });

  it('shows an explicit empty state when the driver has no unit', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, null));

    render(<DriverUnitPage />);

    expect(await screen.findByText('Sin unidad asignada')).toBeInTheDocument();
    expect(screen.queryByText('ABC-123')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the backend error message when the unit read fails', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_CONSULTA_UNIDAD',
        mensaje: 'No fue posible consultar tu unidad.',
      }),
    );

    render(<DriverUnitPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No fue posible consultar tu unidad.',
    );
    expect(screen.queryByText('Sin unidad asignada')).not.toBeInTheDocument();
  });

  it('toggles the driver connection through the shared store', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_UNIT));

    render(<DriverUnitPage />);

    expect(screen.getByText('Desconectado')).toBeInTheDocument();
    expect(useDriverOnlineStore.getState().online).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Conectarse' }));

    expect(useDriverOnlineStore.getState().online).toBe(true);
    expect(screen.getByRole('button', { name: 'Desconectarse' })).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desconectarse' }));

    expect(useDriverOnlineStore.getState().online).toBe(false);
    expect(screen.getByRole('button', { name: 'Conectarse' })).toBeInTheDocument();
  });
});
