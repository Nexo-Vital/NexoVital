import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapaResponse } from '@/features/mapa/map-api';
import { setToken } from '@/services/apiClient';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import CitizenMapPage from './CitizenMapPage';

/** A live-shaped response: 2 zones and 3 Bogotá centers, with NO inventory. */
const RESPONSE: MapaResponse = {
  zonas: [
    {
      id: 'Z-SUBA',
      nombre: 'Suba',
      ubicacion: { lat: 4.742, lng: -74.09 },
      contorno: [
        { lat: 4.79, lng: -74.1 },
        { lat: 4.795, lng: -74.05 },
        { lat: 4.755, lng: -74.032 },
        { lat: 4.7, lng: -74.05 },
      ],
    },
    {
      id: 'Z-KENNEDY',
      nombre: 'Kennedy',
      ubicacion: { lat: 4.628, lng: -74.148 },
      contorno: [
        { lat: 4.665, lng: -74.16 },
        { lat: 4.66, lng: -74.115 },
        { lat: 4.6, lng: -74.105 },
        { lat: 4.575, lng: -74.135 },
      ],
    },
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

/** The `.nv-marker` wrapper whose label matches, or a thrown error. */
function markerByLabel(container: HTMLElement, label: string): HTMLElement {
  const marker = Array.from(container.querySelectorAll<HTMLElement>('.nv-marker')).find(
    (element) => element.querySelector('.nv-marker__label')?.textContent === label,
  );
  if (!marker) {
    throw new Error(`marker ${label} not found`);
  }
  return marker;
}

/** The zone-area polygons currently painted on the map. */
function zoneAreas(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('path.nv-zone-area'));
}

/**
 * End-to-end of the new source, without the demo flag: the citizen screen has to
 * request `GET /api/v1/mapa`, paint the backend's centers as UNDECLARED (no
 * inventory is invented) and paint the opened center's zone as its area contour.
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

  it('paints the backend centers, and no zone until a center is opened', async () => {
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

    // Default view: the mockup's map has no zones.
    expect(zoneAreas(container)).toEqual([]);

    // Opening a center paints ITS zone (resolved through zonaId) as a polygon
    // built from the contour the backend publishes.
    fireEvent.click(markerByLabel(container, 'Suba Norte'));
    expect(zoneAreas(container)).toHaveLength(1);
  });
});
