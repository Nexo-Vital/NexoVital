import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapaResponse } from '@/features/mapa/map-api';
import { setToken } from '@/services/apiClient';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import CitizenMapPage from './CitizenMapPage';

/** A live-shaped response: 2 zones and 3 Bogotá centers, with NO inventory. */
const RESPONSE: MapaResponse = {
  zonas: [
    { id: 'Z-SUBA', nombre: 'Suba', ubicacion: { lat: 4.742, lng: -74.09 } },
    { id: 'Z-KENNEDY', nombre: 'Kennedy', ubicacion: { lat: 4.628, lng: -74.148 } },
  ],
  centros: [
    {
      id: 'ORG-SUBA',
      nombre: 'Acopio Suba Norte',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.742, lng: -74.09 },
    },
    {
      id: 'ORG-GAITANA',
      nombre: 'Acopio La Gaitana',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.72, lng: -74.05 },
    },
    {
      id: 'ORG-TIBABUYES',
      nombre: 'Acopio Tibabuyes',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.73, lng: -74.1 },
    },
  ],
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/**
 * End-to-end of the new source, without the demo flag: the citizen screen has to
 * request `GET /api/v1/mapa`, paint the backend's centers as UNDECLARED (no
 * inventory is invented) and pin its zones as named point markers.
 */
describe('CitizenMapPage against /api/v1/mapa', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('paints the backend centers and zones, requesting the endpoint', async () => {
    const { container } = render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        ambulancias={[]}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    // The backend is the source: the endpoint is requested (apiFetch adds the token).
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/mapa',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );

    // No inventory in the payload: every backend center is counted as undeclared.
    expect(await screen.findByText('3 sin declarar')).toBeInTheDocument();

    // With nothing declared there is nothing to donate to, so the mock-only flow
    // stays off with its reason instead of opening an empty screen.
    expect(screen.getByRole('button', { name: 'Donar suministros' })).toBeDisabled();

    // Each zone is a named point marker, not an area.
    const zoneLabels = Array.from(container.querySelectorAll('.nv-marker--zone')).map(
      (marker) => marker.querySelector('.nv-marker__label')?.textContent,
    );
    expect(zoneLabels).toEqual(['Suba', 'Kennedy']);
  });
});
