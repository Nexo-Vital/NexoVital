import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import DriverHistoryPage from './DriverHistoryPage';

/** Two assigned requests, newest first exactly as the backend orders them. */
const WIRE_HISTORY = [
  {
    id: '8b6f2f0e-0000-4000-8000-0000000000a1',
    ubicacion: { lat: 4.745, lng: -74.095 },
    emergenciaId: null,
    estado: 'TOMADA',
    centroAyudaId: 'CA-CRUE',
    zonaId: 'Suba',
    solicitadaEn: '2026-01-02T10:00:00.000Z',
    timeoutEn: '2026-01-02T10:45:00.000Z',
    ambulanciasNotificadas: ['A-07'],
    ambulanciaAsignadaId: 'A-07',
    llegadaEn: '2026-01-02T10:20:00.000Z',
  },
  {
    id: '8b6f2f0e-0000-4000-8000-0000000000a2',
    ubicacion: { lat: 4.628, lng: -74.148 },
    emergenciaId: null,
    estado: 'ASIGNADA',
    centroAyudaId: null,
    zonaId: null,
    solicitadaEn: '2026-01-01T08:00:00.000Z',
    timeoutEn: '2026-01-01T08:45:00.000Z',
    ambulanciasNotificadas: ['A-07'],
    ambulanciaAsignadaId: 'A-07',
    llegadaEn: null,
  },
];

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('DriverHistoryPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders the service history newest first with state, time, scene and arrival', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_HISTORY));

    render(<DriverHistoryPage />);

    const rows = await screen.findAllByTestId('historial-solicitud');
    expect(rows).toHaveLength(2);

    // Order: the server's newest-first order is preserved.
    const [newest, oldest] = rows;
    expect(within(newest).getByText('Tomada')).toBeInTheDocument();
    expect(within(oldest).getByText('Asignada')).toBeInTheDocument();

    // Requested time is the server timestamp, exposed machine-readably.
    expect(within(newest).getByText(/^Solicitada:/)).toHaveAttribute(
      'dateTime',
      '2026-01-02T10:00:00.000Z',
    );
    expect(within(oldest).getByText(/^Solicitada:/)).toHaveAttribute(
      'dateTime',
      '2026-01-01T08:00:00.000Z',
    );

    // Scene: the declared zone, or the real coordinates when it has none.
    expect(within(newest).getByText('Suba')).toBeInTheDocument();
    expect(within(oldest).getByText('4.6280, -74.1480')).toBeInTheDocument();

    // Arrival: only the closed service declared it.
    expect(within(newest).getByText(/^Llegada declarada:/)).toHaveAttribute(
      'dateTime',
      '2026-01-02T10:20:00.000Z',
    );
    expect(within(oldest).getByText('Sin llegada declarada')).toBeInTheDocument();
  });

  it('shows an explicit empty state when there are no services yet', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, []));

    render(<DriverHistoryPage />);

    expect(await screen.findByText('Todavía no tienes servicios')).toBeInTheDocument();
    expect(screen.queryByTestId('historial-solicitud')).not.toBeInTheDocument();
  });

  it('treats a null body (driver without a unit) as an empty history, never a crash', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, null));

    render(<DriverHistoryPage />);

    expect(await screen.findByText('Todavía no tienes servicios')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the backend error message when the history read fails', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_CONSULTA_HISTORIAL',
        mensaje: 'No fue posible consultar el historial.',
      }),
    );

    render(<DriverHistoryPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No fue posible consultar el historial.',
    );
    expect(screen.queryByTestId('historial-solicitud')).not.toBeInTheDocument();
  });
});
