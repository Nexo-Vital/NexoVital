import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SolicitudAmbulancia } from '@/types/domain';
import CitizenRequestsPage from './CitizenRequestsPage';

function solicitud(id: string, estado: SolicitudAmbulancia['estado'], llegadaEn?: string) {
  return {
    id,
    emergenciaId: '',
    ubicacion: { lat: 4.73, lng: -74.08 },
    estado,
    centroAyudaId: '',
    zonaId: '',
    tipo: '',
    solicitadaEn: '2026-01-02T10:00:00.000Z',
    timeoutEn: '2026-01-02T10:01:00.000Z',
    ambulanciasNotificadas: ['A-07'],
    notifiedCount: 1,
    ambulanciasRechazaron: [],
    ambulanciaAsignadaId: estado === 'PENDING' ? null : 'A-07',
    ...(llegadaEn ? { llegadaEn } : {}),
  } satisfies SolicitudAmbulancia;
}

describe('CitizenRequestsPage (EP-04.F2.US11)', () => {
  afterEach(cleanup);

  it('shows the attended request under Atendidas and not among the active ones', async () => {
    const fetchActivas = vi.fn().mockResolvedValue([solicitud('S-ACTIVA', 'ASSIGNED')]);
    const fetchAtendidas = vi
      .fn()
      .mockResolvedValue([solicitud('S-ATENDIDA', 'TAKEN', '2026-01-02T10:20:00.000Z')]);

    render(<CitizenRequestsPage fetchActivas={fetchActivas} fetchAtendidas={fetchAtendidas} />);

    const atendidas = await screen.findByRole('region', { name: 'Solicitudes atendidas' });
    const fila = within(atendidas).getByTestId('solicitud-atendida');
    expect(within(fila).getByText('Atendida')).toBeInTheDocument();
    expect(within(fila).getByText(/^Llegada:/)).toHaveAttribute(
      'dateTime',
      '2026-01-02T10:20:00.000Z',
    );

    const activas = screen.getByRole('region', { name: 'Solicitudes activas' });
    expect(within(activas).queryByTestId('solicitud-atendida')).not.toBeInTheDocument();
    expect(within(activas).getByText('Ambulancia en camino')).toBeInTheDocument();
  });

  it('names each active state the way the citizen sees it', async () => {
    render(
      <CitizenRequestsPage
        fetchActivas={vi
          .fn()
          .mockResolvedValue([
            solicitud('S-1', 'PENDING'),
            solicitud('S-2', 'ASSIGNED', '2026-01-02T10:20:00.000Z'),
            solicitud('S-3', 'CONFIRMED', '2026-01-02T10:20:00.000Z'),
          ])}
        fetchAtendidas={vi.fn().mockResolvedValue([])}
      />,
    );

    const activas = await screen.findByRole('region', { name: 'Solicitudes activas' });
    expect(within(activas).getAllByTestId('solicitud-activa')).toHaveLength(3);
    expect(within(activas).getByText('Buscando ambulancia')).toBeInTheDocument();
    expect(within(activas).getByText('La ambulancia llegó')).toBeInTheDocument();
    expect(within(activas).getByText('Llegada confirmada')).toBeInTheDocument();
    expect(screen.getByText('Todavía no tienes solicitudes atendidas.')).toBeInTheDocument();
  });

  it('shows both empty states when the citizen has no requests', async () => {
    render(
      <CitizenRequestsPage
        fetchActivas={vi.fn().mockResolvedValue([])}
        fetchAtendidas={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(await screen.findByText('No tienes solicitudes activas.')).toBeInTheDocument();
    expect(screen.getByText('Todavía no tienes solicitudes atendidas.')).toBeInTheDocument();
  });

  it('shows the server message when a read fails and invents nothing', async () => {
    render(
      <CitizenRequestsPage
        fetchActivas={vi.fn().mockResolvedValue([])}
        fetchAtendidas={vi.fn().mockRejectedValue(new Error('Sin conexión con el servidor.'))}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión con el servidor.');
    expect(screen.queryByRole('region', { name: 'Solicitudes atendidas' })).not.toBeInTheDocument();
  });
});
