import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { ACCEPTANCE_POPUP_MS } from '@/features/ciudadano/AcceptancePopup';
import { CITIZEN_REQUEST_REASONS } from '@/features/ciudadano/citizen-request';
import { useCitizenRequestStore } from '@/features/ciudadano/citizen-request-store';
import { CENTER_LEVEL_STYLE, NOT_DECLARED_CENTER_STYLE } from '@/features/ciudadano/citizen-view';
import { useDonationStore } from '@/features/donaciones/donation';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import { MAP_FILTER_STORAGE_KEY } from '@/features/mapa/map-filter';
import { useInventarioStore } from '@/features/recursos/inventory-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { MOCK_AMBULANCIAS, MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { DESTINATIONS, type SolicitudCancelPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { GLOBALS_CSS, paletteDeclaration } from '@/test/mockup-palette';
import type {
  AmbulanceState,
  Ambulancia,
  CentroAyuda,
  Emergencia,
  InventarioItem,
  TrafficLight,
} from '@/types/domain';
import CitizenMapPage from './CitizenMapPage';

// Leaflet needs a real layout engine; stub the map so the citizen chrome is
// tested in isolation. The stub echoes the props this unit wires (the selected
// unit, its label override, the connector AND the three filtered layers) so both
// the c4 map path and the layer filter stay asserted.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: (props: {
    selectedAmbulanceId?: string | null;
    selectedCentroId?: string | null;
    changedCentroId?: string | null;
    focus?: { lat: number; lng: number } | null;
    ambulanceLabels?: Record<string, string>;
    requestConnector?: { dashed?: boolean } | null;
    request?: { position: { lat: number; lng: number }; label: string } | null;
    self?: { position: { lat: number; lng: number }; simulated: boolean; label?: string } | null;
    ambulancias?: { id: string }[];
    centros?: { id: string }[];
    emergencias?: { id: string }[];
    onClearSelection?: () => void;
    onMapClick?: (ubicacion: { lat: number; lng: number }) => void;
    onSelfDragEnd?: (ubicacion: { lat: number; lng: number }) => void;
  }) => (
    <div
      data-testid="map-canvas"
      data-selected={props.selectedAmbulanceId ?? ''}
      data-selected-centro={props.selectedCentroId ?? ''}
      data-changed-centro={props.changedCentroId ?? ''}
      data-focus={props.focus ? `${props.focus.lat},${props.focus.lng}` : ''}
      data-labels={JSON.stringify(props.ambulanceLabels ?? {})}
      data-connector={props.requestConnector ? 'yes' : 'no'}
      data-connector-dashed={props.requestConnector?.dashed === false ? 'no' : 'yes'}
      data-request={props.request ? props.request.label : ''}
      data-self={props.self ? `${props.self.position.lat},${props.self.position.lng}` : ''}
      data-self-sim={props.self?.simulated ? 'yes' : 'no'}
      data-self-label={props.self?.label ?? ''}
      data-ambulancias={JSON.stringify((props.ambulancias ?? []).map((item) => item.id))}
      data-centros={JSON.stringify((props.centros ?? []).map((item) => item.id))}
      data-emergencias={JSON.stringify((props.emergencias ?? []).map((item) => item.id))}
    >
      {/* Stands in for a click on the map BACKGROUND: the page only wires the
          callbacks, the real Leaflet bubbling is covered by the smoke/remote tests. */}
      <button
        type="button"
        data-testid="map-background"
        aria-label="map background"
        onClick={() => {
          props.onMapClick?.({ lat: 4.728, lng: -74.078 });
          props.onClearSelection?.();
        }}
      />
      {/* Stands in for a drag of the self marker, the same callback the real
          MapCanvas fires from Leaflet's `dragend`. */}
      <button
        type="button"
        data-testid="self-drag"
        aria-label="drag self"
        onClick={() => props.onSelfDragEnd?.({ lat: 4.9, lng: -74.1 })}
      />
    </div>
  ),
}));

// The map data source is the only network path in these screens; it is stubbed
// to the injected fixtures so the mocked suite keeps testing the pages without
// setting the demo flag and without touching the backend. The backend still
// sends zones in its payload, but the map does not paint them.
vi.mock('@/features/mapa/use-map-data', () => ({
  useMapData: (fallbackCentros: unknown[]) => ({
    centros: fallbackCentros,
    zonas: [],
    loading: false,
    error: null,
    refresh: () => undefined,
  }),
}));

// Inventory is loaded by its own hook (backend only); stub it so these page
// cases keep rendering the injected fixtures without touching the backend.
vi.mock('@/features/recursos/use-inventario', () => ({
  useInventario: () => undefined,
}));

// The routing client is a THIRD-PARTY network call with no msw in this repo, so
// it is mocked out for the whole file: no page test can ever reach OSRM. By
// default the returned promise never settles (no route -> the straight-line
// fallback); the AC2 case resolves it explicitly.
const { mockFetchRuta } = vi.hoisted(() => ({ mockFetchRuta: vi.fn() }));

vi.mock('@/features/mapa/routing-api', () => ({
  fetchRuta: mockFetchRuta,
}));

mockFetchRuta.mockReturnValue(new Promise(() => {}));

// Same rule for the geocoder (Photon): third party, never reached from a page
// test. The search answers with one fixed place, which is how these cases give
// the report dialog a location now that it no longer takes raw coordinates.
const REPORT_ADDRESS = {
  etiqueta: 'Calle 145 # 91-19, Suba, Bogotá',
  ubicacion: { lat: 4.7412, lng: -74.0836 },
};

vi.mock('@/features/geocodificacion/geocoding-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/geocodificacion/geocoding-api')>()),
  searchAddress: vi.fn(async () => [REPORT_ADDRESS]),
  reverseGeocode: vi.fn(async () => REPORT_ADDRESS.etiqueta),
}));

/** Gives the report dialog its location: types an address and picks the suggestion. */
async function pickReportAddress(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Escribir dirección' }));
  fireEvent.change(within(dialog).getByLabelText('Dirección'), {
    target: { value: 'Calle 145 Suba' },
  });
  fireEvent.click(await within(dialog).findByRole('button', { name: REPORT_ADDRESS.etiqueta }));
}

/**
 * Grants a real device fix through the browser API: the page's own
 * `useDeviceLocation` watcher resolves to the Suba point, which is the pickup
 * point of every request case. The fallback cases stall it instead.
 */
function grantGeolocation(): void {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (success: PositionCallback) => {
        success({
          coords: {
            latitude: 4.728,
            longitude: -74.078,
            heading: null,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
        return 1;
      },
      clearWatch: () => undefined,
    },
  });
}

/** A watcher that never reports: no fix and no denial dialog, only "no point". */
function stallGeolocation(): void {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: () => 1, clearWatch: () => undefined },
  });
}

/** Origin used by the page when the device gives no position (Suba). */
const SUBAS = { lat: 4.728, lng: -74.078 };

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function inventory(centroId: string, semaforo: TrafficLight): InventarioItem[] {
  return [
    {
      id: `${centroId}-1`,
      centroAcopioId: centroId,
      nombre: 'Trauma kits',
      disponible: 4,
      requerido: 10,
      semaforo,
      grammaticalNumber: 'plural',
    },
  ];
}

/** A center; pass `null` to leave it with nothing declared (NOT_DECLARED). */
function centro(id: string, semaforo: TrafficLight | null, lat: number, lng: number): CentroAyuda {
  return {
    id,
    nombre: `Centro ${id}`,
    ubicacion: { lat, lng },
    items: semaforo ? inventory(id, semaforo) : [],
  };
}

/** A FRONT-ONLY demo hospital: no inventory and no traffic light. */
function hospital(id: string, lat = 4.75, lng = -74.06): CentroAyuda {
  return { id, nombre: `Hospital ${id}`, tipo: 'HOSPITAL', ubicacion: { lat, lng }, items: [] };
}

/** Backend-shaped ids: the contract's `emergenciaId`/`centroAyudaId` are UUIDs. */
const PAGE_EMERGENCY_ID = '0b6f2f0e-3333-4000-8000-0000000000cc';
const PAGE_CENTRO_ID = '1c7a3a1e-4444-4000-8000-0000000000dd';

/** A citizen emergency as the backend returns it (real UUID id and zone). */
function pageEmergency(overrides: Partial<Emergencia> = {}): Emergencia {
  return {
    id: PAGE_EMERGENCY_ID,
    ubicacion: { lat: 4.728, lng: -74.078 },
    nivel: 'HIGH',
    estado: 'REPORTED',
    descripcion: 'Derrumbe en Suba',
    zonaId: 'ZONA-SUBA',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A backend-shaped aid center carrying the zone the request can fall back to. */
function backendCentro(id: string, lat: number, lng: number, zonaId = 'ZONA-CENTRO'): CentroAyuda {
  return { id, nombre: `Centro ${id}`, ubicacion: { lat, lng }, items: [], zonaId };
}

function amb(id: string, estado: AmbulanceState, latOffset = 0.01): Ambulancia {
  return {
    id,
    placa: `OVX-${id}`,
    estado,
    ubicacion: { lat: SUBAS.lat + latOffset, lng: SUBAS.lng },
    zona: 'Suba',
    driverName: `Driver ${id}`,
  };
}

/** Three available units nearest to Suba, plus the two occupied ones. */
const SEARCH_FLEET = [
  amb('A-07', 'AVAILABLE', 0.002),
  amb('A-12', 'AVAILABLE', 0.01),
  amb('A-03', 'AVAILABLE', 0.02),
  amb('A-09', 'ASSIGNED', 0.03),
  amb('A-15', 'EN_ROUTE', 0.04),
];

/** The count rendered next to a legend label. */
function legendValue(label: string): string {
  const legend = screen.getByRole('complementary', { name: 'Leyenda del mapa' });
  const row = within(legend).getByText(label).closest('li');
  if (!row) {
    throw new Error(`legend row "${label}" not found`);
  }
  return row.querySelector('b')?.textContent ?? '';
}

function renderPage(overrides: Partial<ComponentProps<typeof CitizenMapPage>> = {}) {
  return render(
    <CitizenMapPage
      port={new FakeRealtimePort()}
      ambulancias={[]}
      emergencias={[]}
      solicitudes={[]}
      centrosAyuda={[]}
      {...overrides}
    />,
  );
}

describe('CitizenMapPage', () => {
  beforeEach(() => {
    // The citizen request/relay cases run the DEMO path: pin the build flag so
    // the store publishes on the injected port instead of calling the backend.
    // The few backend cases stub it back to '0' explicitly.
    vi.stubEnv('VITE_DEMO_MODE', '1');
    // Every case starts with a real device fix (a real pickup point); the
    // fallback cases stall the watcher explicitly.
    grantGeolocation();
  });

  afterEach(() => {
    cleanup();
    useFleetStore.getState().hydrate([]);
    useEmergencyStore.getState().hydrate([]);
    useSolicitudesStore.getState().hydrate([]);
    useCitizenRequestStore.getState().reset();
    useDonationStore.getState().reset();
    useInventarioStore.getState().reset();
    // A case that flips the build-time demo flag never leaks into another one.
    vi.unstubAllEnvs();
    // The Toaster is mounted in the shells, not in this page, so the toast stack
    // is asserted through the store: reset it so a case cannot leak into another.
    useToastStore.setState({ toasts: [] });
    // The map layer filter is persisted; clear it so a case cannot leak either.
    window.localStorage.removeItem(MAP_FILTER_STORAGE_KEY);
    // Back to "no route": a case that resolved one never leaks into another.
    mockFetchRuta.mockReset();
    mockFetchRuta.mockReturnValue(new Promise(() => {}));
  });

  it('renders the header, the map, the live legend and the three rail blocks', () => {
    renderPage({
      ambulancias: [amb('AMB-01', 'AVAILABLE')],
      centrosAyuda: [centro('CA-N', 'GREEN', 4.728, -74.078)],
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Suba, Bogotá · en vivo')).toBeInTheDocument();
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    // Idle map: no center detail is open, so the map is not told to look anywhere.
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-focus', '');
    expect(screen.getByRole('complementary', { name: 'Leyenda del mapa' })).toBeInTheDocument();

    const rail = screen.getByRole('complementary', { name: 'Panel del ciudadano' });
    expect(within(rail).getByText(/Acciones de tu rol/)).toBeInTheDocument();
    expect(
      within(rail).getByRole('heading', { name: 'Ambulancias cerca de ti' }),
    ).toBeInTheDocument();
    expect(within(rail).getByRole('heading', { name: 'Centros de acopio' })).toBeInTheDocument();
  });

  it('starts the position simulation from the citizen rail and the marker reflects it', () => {
    renderPage({ ambulancias: SEARCH_FLEET });

    const map = screen.getByTestId('map-canvas');
    expect(screen.getByRole('button', { name: 'Simular posición' })).toBeInTheDocument();
    expect(map).toHaveAttribute('data-self-sim', 'no');

    fireEvent.click(screen.getByRole('button', { name: 'Simular posición' }));

    // The device fix seeds the simulation, so the marker keeps its spot and is
    // now flagged as simulated (the shared chip makes that visible).
    expect(map).toHaveAttribute('data-self-sim', 'yes');
    expect(map).toHaveAttribute('data-self', '4.728,-74.078');
    expect(screen.getByText('Simulada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recentrar simulación' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar GPS del dispositivo' })).toBeInTheDocument();
  });

  it('returns to the device GPS when the citizen stops the simulation', () => {
    renderPage({ ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-self-sim', 'yes');

    fireEvent.click(screen.getByRole('button', { name: 'Usar GPS del dispositivo' }));

    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-self-sim', 'no');
    expect(screen.queryByText('Simulada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simular posición' })).toBeInTheDocument();
  });

  it('moves the citizen position by dragging the marker while simulating', () => {
    renderPage({ ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-self', '4.728,-74.078');

    fireEvent.click(screen.getByTestId('self-drag'));

    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-self', '4.9,-74.1');
  });

  it('places the citizen by tapping the map while simulating', () => {
    // No device fix: the simulation starts at its constant seed.
    stallGeolocation();
    renderPage({ ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Simular posición' }));
    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-self', '4.653,-74.06');

    // While simulating the map tap PLACES the citizen, it does not mark a pickup
    // point (that path is only wired with the GPS denied and no simulation).
    fireEvent.click(screen.getByTestId('map-background'));

    expect(map).toHaveAttribute('data-self', '4.728,-74.078');
    expect(map).toHaveAttribute('data-self-sim', 'yes');
  });

  it('demo: hydrates the fixtures when no fleet prop is injected', () => {
    render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    // The demo build has no backend path: the fixtures ARE the fleet, exactly as
    // before, and the legend counts them.
    expect(useFleetStore.getState().units.map((unit) => unit.id)).toEqual(
      MOCK_AMBULANCIAS.map((unit) => unit.id),
    );
    expect(legendValue('Disponible')).toBe('3');
    expect(legendValue('Ocupada')).toBe('2');
  });

  it('enables "Pedir ambulancia" and "Donar suministros" when data can back them', () => {
    renderPage({
      ambulancias: [amb('A-07', 'AVAILABLE')],
      // A declared, non-stable requirement: 4/10 = 40% -> AMBER, so a donation
      // can actually move it. A stable-only center is not a donation target.
      centrosAyuda: [centro('CA-N', 'AMBER', 4.728, -74.078)],
    });

    expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Donar suministros' })).toBeEnabled();
    expect(screen.queryByText(/Próximamente/)).not.toBeInTheDocument();
  });

  it('disables "Donar suministros" with its reason when no center declares a requirement', () => {
    renderPage({ centrosAyuda: [centro('CA-N', null, 4.728, -74.078)] });

    const donate = screen.getByRole('button', { name: 'Donar suministros' });
    expect(donate).toBeDisabled();
    expect(donate).toHaveAttribute(
      'title',
      'Ningún centro declara insumos que necesiten donación.',
    );
  });

  it('starts the search and alerts the three nearest available units for real', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Pidiendo ambulancia' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Buscando ambulancia' })).toBeInTheDocument();
    expect(screen.getByText(/Buscando hace/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ambulancias avisadas' })).toBeInTheDocument();
    expect(screen.getByText('Ambulancia OVX-A-07')).toBeInTheDocument();
    expect(screen.getByText('Ambulancia OVX-A-12')).toBeInTheDocument();
    expect(screen.getByText('Ambulancia OVX-A-03')).toBeInTheDocument();
    expect(screen.getAllByText('Avisada')).toHaveLength(3);
    expect(screen.getByText(/Las ambulancias ocupadas \(A-09 y A-15\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar solicitud' })).toBeInTheDocument();

    const frame = port.published.find((entry) => entry.destination === DESTINATIONS.solicitudes);
    expect(frame?.payload).toMatchObject({
      type: 'solicitud.broadcast',
      notificadas: ['A-07', 'A-12', 'A-03'],
    });
  });

  it('asks the backend with the citizen pickup point and no zone dependence', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    const serverResponse = {
      id: '8b6f2f0e-0000-4000-8000-000000000042',
      ubicacion: { lat: 4.728, lng: -74.078 },
      emergenciaId: null,
      estado: 'PENDIENTE',
      centroAyudaId: null,
      zonaId: null,
      solicitadaEn: '2026-01-01T00:00:00.000Z',
      timeoutEn: '2026-01-01T00:45:00.000Z',
      ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
      ambulanciaAsignadaId: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, serverResponse));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const port = new FakeRealtimePort();
      renderPage({ port, ambulancias: SEARCH_FLEET });

      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

      await waitFor(() =>
        expect(useCitizenRequestStore.getState().requestId).toBe(serverResponse.id),
      );

      // Created over REST, never published on the relay.
      expect(port.published).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe('/api/v1/solicitudes');
      expect(options.method).toBe('POST');
      // The REAL pickup point: a request no longer depends on a zone, so no
      // local `REQ-…`, no `CA-CRUE` and no emergency id travel.
      // The accept window is SERVER-OWNED: the client only declares the pickup
      // point and never proposes a deadline.
      expect(JSON.parse(options.body as string)).toEqual({
        ubicacion: { lat: 4.728, lng: -74.078 },
      });

      // The rail renders the server-assigned state and its notified units.
      expect(screen.getByRole('heading', { name: 'Buscando ambulancia' })).toBeInTheDocument();
      expect(screen.getByText('Ambulancia OVX-A-07')).toBeInTheDocument();
      expect(useCitizenRequestStore.getState().notifiedIds).toEqual(
        serverResponse.ambulanciasNotificadas,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the backend mensaje on a 400 instead of a bare "Error HTTP 400"', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, {
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'El cuerpo de la solicitud no es válido: revise el formato de los datos enviados.',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderPage({
        ambulancias: SEARCH_FLEET,
        emergencias: [pageEmergency()],
        centrosAyuda: [backendCentro(PAGE_CENTRO_ID, 4.728, -74.078)],
      });

      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

      // The backend's Spanish `mensaje` reaches the rail; the bare status text
      // `apiFetch` falls back to never does.
      expect(
        await screen.findByText(
          'El cuerpo de la solicitud no es válido: revise el formato de los datos enviados.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('Error HTTP 400')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks nothing and shows the honest reason without a pickup point', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    // No device fix and no point marked on the map: the request must not send.
    stallGeolocation();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderPage({ ambulancias: SEARCH_FLEET });

      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

      expect(await screen.findByText(CITIZEN_REQUEST_REASONS.noLocation)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(useCitizenRequestStore.getState().phase).toBe('idle');
      expect(useCitizenRequestStore.getState().requestId).toBeNull();
      // The button is not dead: the map rail and the action stay available.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks the pickup point on the map when the GPS is denied and then asks', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    stallGeolocation();
    const serverResponse = {
      id: '8b6f2f0e-0000-4000-8000-000000000042',
      ubicacion: { lat: 4.728, lng: -74.078 },
      emergenciaId: null,
      estado: 'PENDIENTE',
      centroAyudaId: null,
      zonaId: null,
      solicitadaEn: '2026-01-01T00:00:00.000Z',
      timeoutEn: '2026-01-01T00:45:00.000Z',
      ambulanciasNotificadas: ['A-07'],
      ambulanciaAsignadaId: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, serverResponse));
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderPage({ ambulancias: SEARCH_FLEET });

      // The citizen marks the point on the map (no dead end without the GPS).
      fireEvent.click(screen.getByTestId('map-background'));
      expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-request', 'Punto de recogida');

      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

      await waitFor(() =>
        expect(useCitizenRequestStore.getState().requestId).toBe(serverResponse.id),
      );
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      // The accept window is SERVER-OWNED: the client only declares the pickup
      // point and never proposes a deadline.
      expect(JSON.parse(options.body as string)).toEqual({
        ubicacion: { lat: 4.728, lng: -74.078 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drives the citizen screen with the backend lifecycle on /user/queue/solicitudes', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    const serverResponse = {
      id: '8b6f2f0e-0000-4000-8000-000000000042',
      ubicacion: { lat: 4.728, lng: -74.078 },
      emergenciaId: PAGE_EMERGENCY_ID,
      estado: 'PENDIENTE',
      centroAyudaId: PAGE_CENTRO_ID,
      zonaId: 'ZONA-SUBA',
      solicitadaEn: '2026-01-01T00:00:00.000Z',
      timeoutEn: '2026-01-01T00:45:00.000Z',
      ambulanciasNotificadas: [],
      ambulanciaAsignadaId: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(201, serverResponse));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const port = new FakeRealtimePort();
      renderPage({
        port,
        ambulancias: SEARCH_FLEET,
        emergencias: [pageEmergency()],
        centrosAyuda: [backendCentro(PAGE_CENTRO_ID, 4.728, -74.078)],
      });

      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
      await waitFor(() =>
        expect(useCitizenRequestStore.getState().requestId).toBe(serverResponse.id),
      );

      // ASIGNADA (the backend's winner frame) turns the search into "accepted".
      act(() => {
        port.emit(DESTINATIONS.solicitudes, {
          solicitudId: serverResponse.id,
          emergenciaId: PAGE_EMERGENCY_ID,
          zonaId: 'ZONA-SUBA',
          estado: 'ASIGNADA',
          ambulanciasNotificadas: [],
          ambulanciaAsignadaId: 'A-12',
        });
      });

      expect(
        screen.getByRole('heading', { level: 1, name: 'Tu ambulancia va en camino' }),
      ).toBeInTheDocument();

      // CONFIRMADA closes the citizen's request.
      act(() => {
        port.emit(DESTINATIONS.solicitudes, {
          solicitudId: serverResponse.id,
          emergenciaId: PAGE_EMERGENCY_ID,
          zonaId: 'ZONA-SUBA',
          estado: 'CONFIRMADA',
          ambulanciasNotificadas: [],
          ambulanciaAsignadaId: 'A-12',
        });
      });

      expect(
        screen.getByRole('heading', { level: 1, name: 'Solicitud atendida' }),
      ).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not call the demo fallback the real location while searching', () => {
    // The GPS is denied, so the page falls back to Suba as the map reference and
    // the citizen marks the pickup point. The subtitle must say it is a
    // reference/demo point, never "Tu ubicación actual" (C6).
    stallGeolocation();
    renderPage({ ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByTestId('map-background'));
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

    expect(screen.getByText(/Ubicación de referencia \(demo\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Tu ubicación actual/)).not.toBeInTheDocument();
  });

  it('adjusts the copy when fewer than three units are available', () => {
    renderPage({
      ambulancias: [amb('A-07', 'AVAILABLE'), amb('A-12', 'AVAILABLE'), amb('A-09', 'ASSIGNED')],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

    expect(screen.getByText(/a las 2 ambulancias disponibles/)).toBeInTheDocument();
  });

  it('lists only the occupied units in the footer, never the maintenance ones', () => {
    renderPage({
      ambulancias: [
        amb('A-07', 'AVAILABLE'),
        amb('A-09', 'ASSIGNED'),
        amb('A-15', 'EN_ROUTE'),
        amb('A-21', 'MAINTENANCE'),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

    // "Ocupadas" is the busy bucket alone: a unit in maintenance is not occupied,
    // and its own bucket is already explained in the nearby list.
    const footer = screen.getByText(/Las ambulancias ocupadas/);
    expect(footer).toHaveTextContent('A-09 y A-15');
    expect(footer).not.toHaveTextContent('A-21');
  });

  it('does not start a search with no available units and says so', () => {
    renderPage({ ambulancias: [amb('A-09', 'ASSIGNED'), amb('A-15', 'EN_ROUTE')] });

    expect(
      screen.getByText('No hay ambulancias conectadas y disponibles en este momento.'),
    ).toBeInTheDocument();

    // With no available units the button is disabled with its reason visible, so
    // nothing is clickable and inert (C4).
    const requestButton = screen.getByRole('button', { name: 'Pedir ambulancia' });
    expect(requestButton).toBeDisabled();
    expect(requestButton).toHaveAttribute(
      'title',
      'No hay ambulancias conectadas y disponibles en este momento.',
    );

    fireEvent.click(requestButton);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Buscando ambulancia' })).not.toBeInTheDocument();
  });

  it('enables the request button again once a unit is available', () => {
    renderPage({ ambulancias: [amb('A-07', 'AVAILABLE')] });

    expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeEnabled();
  });

  it('cancels for real: publishes solicitud.cancel and returns to the map rail', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));

    const cancel = port.published.find(
      (entry) => (entry.payload as SolicitudCancelPayload).type === 'solicitud.cancel',
    );
    expect(cancel).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeInTheDocument();
  });

  it('ends the search when the arbiter assigns our request', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';

    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId,
        winner: 'A-12',
      });
    });

    expect(screen.queryByRole('heading', { name: 'Buscando ambulancia' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Una ambulancia aceptó' })).toBeInTheDocument();
    expect(screen.getByText(/La unidad A-12 aceptó tu solicitud/)).toBeInTheDocument();
  });

  it('announces the acceptance popup through a live region, with the real winner id', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-12' });
    });

    // The popup is the live region: a self-dismissing notice must still reach
    // screen readers, and the c4 rail underneath keeps the message permanently.
    const popup = screen.getByRole('status');
    expect(popup).toHaveAttribute('aria-live', 'polite');
    expect(
      within(popup).getByRole('heading', { name: 'Una ambulancia aceptó' }),
    ).toBeInTheDocument();
    expect(within(popup).getByText('La unidad A-12 aceptó tu solicitud.')).toBeInTheDocument();
  });

  it('closes the acceptance popup by itself after the documented lifetime', () => {
    vi.useFakeTimers();
    try {
      const port = new FakeRealtimePort();
      renderPage({ port, ambulancias: SEARCH_FLEET });
      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
      const requestId = useCitizenRequestStore.getState().requestId ?? '';
      act(() => {
        port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-12' });
      });

      act(() => {
        vi.advanceTimersByTime(ACCEPTANCE_POPUP_MS - 1);
      });
      expect(screen.getByRole('heading', { name: 'Una ambulancia aceptó' })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(
        screen.queryByRole('heading', { name: 'Una ambulancia aceptó' }),
      ).not.toBeInTheDocument();
      // The tracking rail is the permanent channel: only the popup went away.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Tu ambulancia va en camino' }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the acceptance popup early from its "Cerrar" button', () => {
    vi.useFakeTimers();
    try {
      const port = new FakeRealtimePort();
      renderPage({ port, ambulancias: SEARCH_FLEET });
      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
      const requestId = useCitizenRequestStore.getState().requestId ?? '';
      act(() => {
        port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-12' });
      });

      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

      expect(
        screen.queryByRole('heading', { name: 'Una ambulancia aceptó' }),
      ).not.toBeInTheDocument();
      // The request itself is untouched: "Cerrar" dismisses the notice only.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Tu ambulancia va en camino' }),
      ).toBeInTheDocument();
      expect(useCitizenRequestStore.getState().phase).toBe('accepted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show the popup when the acceptance belongs to another request', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-OTHER',
        winner: 'A-12',
      });
    });

    expect(
      screen.queryByRole('heading', { name: 'Una ambulancia aceptó' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Pidiendo ambulancia' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Buscando ambulancia' })).toBeInTheDocument();
  });

  it('does not show the popup without an active search', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'A-12',
      });
    });

    expect(
      screen.queryByRole('heading', { name: 'Una ambulancia aceptó' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
  });

  it('shows the c4 tracking rail with the assigned unit real data and its two actions', () => {
    const port = new FakeRealtimePort();
    // The real fixture carries A-07's driver, plate, model and type.
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-07' });
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tu ambulancia va en camino' }),
    ).toBeInTheDocument();

    const rail = screen.getByRole('complementary', { name: 'Panel del ciudadano' });
    const steps = within(rail).getByRole('list', { name: 'Progreso de tu solicitud' });
    const stepItems = within(steps).getAllByRole('listitem');
    expect(stepItems.map((item) => item.textContent)).toEqual([
      'Solicitada',
      'Aceptada',
      'En camino',
      'Llegó',
    ]);
    // Step 3 ("En camino") is the active one, and only that one.
    expect(stepItems[2]).toHaveAttribute('aria-current', 'step');
    expect(stepItems[1]).not.toHaveAttribute('aria-current');

    // "Aceptada" also names a step, so the chip is the one outside the stepper.
    const chips = within(rail)
      .getAllByText('Aceptada')
      .filter((node) => !steps.contains(node));
    expect(chips).toHaveLength(1);
    expect(within(rail).getByText(/hace \d+ s/)).toBeInTheDocument();

    expect(within(rail).getByText('Carlos Pérez')).toBeInTheDocument();
    expect(within(rail).getByText('Conductor de la ambulancia')).toBeInTheDocument();
    for (const [label, value] of [
      ['Placa', 'WNR-418'],
      ['Modelo', 'Renault Master 2023'],
      ['Tipo', 'Básica (TAB)'],
    ]) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
      expect(within(rail).getByText(value)).toBeInTheDocument();
    }

    // No phone number exists in the domain yet, so the call action is disabled
    // with its reason instead of being a button that does nothing.
    const call = within(rail).getByRole('button', { name: 'Llamar al conductor' });
    expect(call).toBeDisabled();
    expect(call).toHaveAttribute(
      'title',
      'Aún no hay un número de contacto en los datos de la unidad.',
    );
    expect(within(rail).getByRole('button', { name: 'Cancelar solicitud' })).toBeEnabled();
  });

  it('labels the assigned unit with its ETA and draws the solid connector to the citizen', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-07' });
    });

    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-selected', 'A-07');
    expect(map.getAttribute('data-labels')).toMatch(/"A-07":"WNR-418 · \d+ min"/);
    expect(map).toHaveAttribute('data-connector', 'yes');
    // A live mission draws the connector solid, not dashed (`C.c4`).
    expect(map).toHaveAttribute('data-connector-dashed', 'no');
  });

  it('keeps the arrival clock fixed at acceptance while the elapsed counter runs', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T09:40:00.000Z'));
      const port = new FakeRealtimePort();
      renderPage({ port, ambulancias: MOCK_AMBULANCIAS });

      fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
      const requestId = useCitizenRequestStore.getState().requestId ?? '';
      act(() => {
        port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-07' });
      });

      const rail = screen.getByRole('complementary', { name: 'Panel del ciudadano' });
      const arrival = within(rail).getByText(/llega \d+:\d{2}/).textContent;
      expect(within(rail).getByText('hace 0 s')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(180_000);
      });

      // The arrival clock is anchored to the acceptance instant, so it does NOT
      // advance with the clock (C3); the "hace N s" counter DOES keep running.
      expect(within(rail).getByText(/llega \d+:\d{2}/).textContent).toBe(arrival);
      expect(within(rail).getByText('hace 3 min')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels for real from the c4 rail and returns to the map rail', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-07' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));

    const cancel = port.published.find(
      (entry) => (entry.payload as SolicitudCancelPayload).type === 'solicitud.cancel',
    );
    expect(cancel?.payload).toEqual({ type: 'solicitud.cancel', requestId });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Una ambulancia aceptó' }),
    ).not.toBeInTheDocument();
  });

  it('drops a cancelled request from the CRUE registry, not only from the driver inbox', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    expect(useSolicitudesStore.getState().items.some((item) => item.id === requestId)).toBe(true);

    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.cancelled', requestId });
    });

    // The coordinator must not keep seeing as pending a request nobody asked for.
    expect(useSolicitudesStore.getState().items.some((item) => item.id === requestId)).toBe(false);
  });

  it('reflects the loaded data in the summary chips and the legend counts', () => {
    renderPage({
      ambulancias: [
        amb('AMB-1', 'AVAILABLE'),
        amb('AMB-2', 'EN_ROUTE'),
        amb('AMB-3', 'ASSIGNED'),
        amb('AMB-4', 'MAINTENANCE'),
      ],
      centrosAyuda: [
        centro('CA-1', 'GREEN', 4.728, -74.078),
        centro('CA-2', 'AMBER', 4.73, -74.08),
        centro('CA-3', 'RED', 4.74, -74.09),
        centro('CA-4', null, 4.75, -74.1),
      ],
    });

    expect(screen.getByText('1 centro estable')).toBeInTheDocument();
    expect(screen.getByText('1 en alerta')).toBeInTheDocument();
    expect(screen.getByText('1 crítico')).toBeInTheDocument();
    expect(screen.getByText('1 sin declarar')).toBeInTheDocument();

    expect(legendValue('Estable')).toBe('1');
    expect(legendValue('En alerta')).toBe('1');
    expect(legendValue('Crítico')).toBe('1');
    expect(legendValue('Sin declarar')).toBe('1');
    expect(legendValue('Disponible')).toBe('1');
    expect(legendValue('Ocupada')).toBe('2');
  });

  it('paints the legend center swatches from the shared marker palette', () => {
    renderPage({ centrosAyuda: [centro('CA-1', 'RED', 4.728, -74.078)] });

    const legend = screen.getByRole('complementary', { name: 'Leyenda del mapa' });
    const swatchOf = (label: string) =>
      within(legend).getByText(label).closest('li')?.querySelector('span');

    // Anchored to the mockup tokens and their values in :root, never to
    // CENTER_LEVEL_STYLE comparing against itself.
    expect(CENTER_LEVEL_STYLE.critical.bg).toBe('var(--nv-red)');
    expect(swatchOf('Estable')?.getAttribute('style')).toContain('var(--nv-lime)');
    expect(swatchOf('Crítico')?.getAttribute('style')).toContain('var(--nv-red)');
    // "Sin declarar" reads NOT_DECLARED_CENTER_STYLE, not a hardcoded `bg-idle`.
    expect(NOT_DECLARED_CENTER_STYLE.bg).toBe('var(--nv-idle)');
    expect(swatchOf('Sin declarar')?.getAttribute('style')).toContain(NOT_DECLARED_CENTER_STYLE.bg);
    expect(GLOBALS_CSS).toContain(paletteDeclaration('lime'));
    expect(GLOBALS_CSS).toContain(paletteDeclaration('red'));

    // The critical summary chip reads the same red as the pin, not a second one.
    const chip = screen.getByText('1 crítico').closest('li');
    expect(chip?.getAttribute('style')).toContain('var(--nv-red)');
  });

  it('AC2: shows the real hospital count in the legend, without faking a traffic light', () => {
    renderPage({
      centrosAyuda: [
        centro('CA-1', 'GREEN', 4.728, -74.078),
        hospital('HOSP-1', 4.75, -74.055),
        hospital('HOSP-2', 4.622, -74.13),
      ],
    });

    // The count comes from the data (2 hospitals), never from a constant.
    expect(legendValue('Hospitales')).toBe('2');
    // A hospital has no inventory, so it is NOT an undeclared supply center
    // (FH-3): it must not inflate "Sin declarar".
    expect(legendValue('Sin declarar')).toBe('0');
    expect(legendValue('Estable')).toBe('1');
  });

  it('lists the units nearest to the citizen first, with their availability', () => {
    renderPage({
      ambulancias: [
        amb('AMB-FAR', 'AVAILABLE', 0.2),
        amb('AMB-NEAR', 'AVAILABLE', 0.005),
        amb('AMB-MID', 'EN_ROUTE', 0.05),
      ],
    });

    const rail = screen.getByRole('complementary', { name: 'Panel del ciudadano' });
    const rows = within(rail)
      .getAllByText(/^Ambulancia /)
      .map((node) => node.textContent);
    expect(rows).toEqual([
      'Ambulancia OVX-AMB-NEAR',
      'Ambulancia OVX-AMB-MID',
      'Ambulancia OVX-AMB-FAR',
    ]);
    expect(within(rail).getAllByText('Disponible')).toHaveLength(2);
    expect(within(rail).getAllByText('Ocupada')).toHaveLength(1);
  });

  it('updates the live legend when the realtime layer pushes a new unit', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: [amb('AMB-1', 'AVAILABLE')] });

    expect(legendValue('Disponible')).toBe('1');

    act(() => {
      port.emit(DESTINATIONS.flota, {
        type: 'fleet.upsert',
        unit: amb('AMB-9', 'AVAILABLE', 0.02),
      });
    });

    expect(legendValue('Disponible')).toBe('2');
  });

  /** Walks the citizen from a search to an accepted request won by A-07. */
  function acceptRequest(port: FakeRealtimePort): string {
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.taken', requestId, winner: 'A-07' });
    });
    return requestId;
  }

  function citizenRail() {
    return screen.getByRole('complementary', { name: 'Panel del ciudadano' });
  }

  it('AC2: shows the REAL routed duration when a route resolves', async () => {
    const port = new FakeRealtimePort();
    mockFetchRuta.mockResolvedValue({
      geometria: [
        [4.72, -74.078],
        [4.724, -74.078],
        [4.728, -74.078],
      ],
      distanciaKm: 1.1,
      duracionMin: 7.44,
    });
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    acceptRequest(port);

    const rail = citizenRail();
    // 7.44 min from OSRM wins over the ~3 min straight-line estimate.
    expect(await within(rail).findByText('7 min')).toBeInTheDocument();
    expect(within(rail).queryByText('3 min')).not.toBeInTheDocument();
  });

  it('AC3: keeps the straight-line ETA when no route is available', async () => {
    const port = new FakeRealtimePort();
    // The default routing mock never settles: the honest fallback stays.
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    acceptRequest(port);

    const rail = citizenRail();
    expect(await within(rail).findByText('3 min')).toBeInTheDocument();
    expect(within(rail).queryByText('7 min')).not.toBeInTheDocument();
  });

  it('shows the arrival dialog with the real unit data, then the c5 panel once dismissed', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    const requestId = acceptRequest(port);

    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId,
        ambulanceId: 'A-07',
      });
    });

    // The CRUE registry consumed the new event: the arrival milestone is recorded.
    expect(
      useSolicitudesStore.getState().items.find((item) => item.id === requestId)?.llegadaEn,
    ).toBeDefined();

    // The dialog asks for an answer and carries the REAL unit data.
    const dialog = screen.getByRole('dialog', { name: 'Confirmar llegada' });
    expect(
      within(dialog).getByRole('heading', { name: 'Tu ambulancia llegó' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Carlos Pérez marcó que llegó a tu ubicación con la ambulancia WNR-418. ¿Está contigo?',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('WNR-418')).toBeInTheDocument();
    expect(within(dialog).getByText('Renault Master 2023 · Básica (TAB)')).toBeInTheDocument();

    // The dispute flow is not built: the action is disabled with its reason.
    const dispute = within(dialog).getByRole('button', { name: 'No la veo' });
    expect(dispute).toBeDisabled();
    expect(dispute).toHaveAttribute('title', 'El flujo de disputa todavía no está construido.');
    expect(
      within(dialog).getByText(/cuando el flujo de disputa esté construido/),
    ).toBeInTheDocument();

    // A real modal makes the page behind it inert; dismissing it reveals the c5
    // rail with the "Llegó" chip, the real arrival clock and the step-4 stepper.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByRole('dialog', { name: 'Confirmar llegada' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tu ambulancia llegó' }),
    ).toBeInTheDocument();
    const rail = citizenRail();
    const steps = within(rail).getByRole('list', { name: 'Progreso de tu solicitud' });
    const stepItems = within(steps).getAllByRole('listitem');
    expect(stepItems.map((item) => item.textContent)).toEqual([
      'Solicitada',
      'Aceptada',
      'En camino',
      'Llegó',
    ]);
    expect(stepItems[3]).toHaveAttribute('aria-current', 'step');
    // "Llegó" also names a step, so the chip is the one outside the stepper.
    const chips = within(rail)
      .getAllByText('Llegó')
      .filter((node) => !steps.contains(node));
    expect(chips).toHaveLength(1);
    expect(within(rail).getByText('hora de llegada')).toBeInTheDocument();
    expect(within(rail).getByText(/^\d{1,2}:\d{2}$/)).toBeInTheDocument();
  });

  it('lets the citizen leave a false arrival: dismiss the dialog, then cancel from c5', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    const requestId = acceptRequest(port);

    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId,
        ambulanceId: 'A-07',
      });
    });

    // Dismissing never confirms: the request is untouched and still "arrived".
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Confirmar llegada' })).getByRole('button', {
        name: 'Cerrar',
      }),
    );
    expect(screen.queryByRole('dialog', { name: 'Confirmar llegada' })).not.toBeInTheDocument();
    expect(useCitizenRequestStore.getState().phase).toBe('arrived');
    expect(
      port.published.some(
        (entry) => (entry.payload as { type?: string }).type === 'solicitud.confirmar',
      ),
    ).toBe(false);

    // The c5 rail offers the existing cancellation as the honest exit.
    const rail = citizenRail();
    fireEvent.click(within(rail).getByRole('button', { name: 'Cancelar solicitud' }));

    const cancel = port.published.find(
      (entry) => (entry.payload as SolicitudCancelPayload).type === 'solicitud.cancel',
    );
    expect(cancel?.payload).toEqual({ type: 'solicitud.cancel', requestId });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
  });

  it('dismisses the arrival dialog with Escape without confirming', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    const requestId = acceptRequest(port);

    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId,
        ambulanceId: 'A-07',
      });
    });

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Confirmar llegada' })).not.toBeInTheDocument();
    expect(useCitizenRequestStore.getState().phase).toBe('arrived');
  });

  it('keeps the arrival dialog open: it asks for an answer instead of closing itself', () => {
    vi.useFakeTimers();
    try {
      const port = new FakeRealtimePort();
      renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
      const requestId = acceptRequest(port);
      act(() => {
        port.emit(DESTINATIONS.solicitudes, {
          type: 'request.arrived',
          requestId,
          ambulanceId: 'A-07',
        });
      });

      // The acceptance notice does close itself; the arrival dialog must not.
      act(() => {
        vi.advanceTimersByTime(ACCEPTANCE_POPUP_MS + 1000);
      });

      expect(
        screen.queryByRole('heading', { name: 'Una ambulancia aceptó' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Confirmar llegada' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes the confirmation and closes in c6 only when the relay echoes it', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    const requestId = acceptRequest(port);
    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId,
        ambulanceId: 'A-07',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sí, ya llegó' }));

    // The citizen only publishes; the request closes on the relay's echo.
    const confirm = port.published.find(
      (entry) => (entry.payload as { type?: string }).type === 'solicitud.confirmar',
    );
    expect(confirm?.payload).toEqual({ type: 'solicitud.confirmar', requestId });
    expect(screen.getByRole('dialog', { name: 'Confirmar llegada' })).toBeInTheDocument();

    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId });
    });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Solicitud atendida' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Confirmar llegada' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Confirmaste la llegada. Tu solicitud quedó cerrada.'),
    ).toBeInTheDocument();

    const rail = citizenRail();
    expect(within(rail).getByRole('heading', { name: 'Solicitud atendida' })).toBeInTheDocument();
    expect(
      within(rail).getByText('Ya no figura entre tus solicitudes activas'),
    ).toBeInTheDocument();

    const timeline = within(rail).getByRole('list', { name: 'Línea de tiempo de tu solicitud' });
    const entries = within(timeline).getAllByRole('listitem');
    expect(entries).toHaveLength(4);
    expect(entries[0].textContent).toMatch(/^Pediste una ambulancia\d{1,2}:\d{2}$/);
    expect(entries[1].textContent).toMatch(
      /^Carlos Pérez aceptó con la ambulancia WNR-418\d{1,2}:\d{2}$/,
    );
    expect(entries[2].textContent).toMatch(/^La ambulancia llegó\d{1,2}:\d{2}$/);
    expect(entries[3].textContent).toMatch(/^Confirmaste la llegada\d{1,2}:\d{2}$/);

    // The CRUE registry consumed the confirmation: the request is CONFIRMED.
    expect(useSolicitudesStore.getState().items.find((item) => item.id === requestId)?.estado).toBe(
      'CONFIRMED',
    );

    // "Volver al mapa" drops the closed request and restores the map rail.
    fireEvent.click(within(rail).getByRole('button', { name: 'Volver al mapa' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
  });

  it('does not reset the arrival or the confirmation when the events repeat', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: MOCK_AMBULANCIAS });
    const requestId = acceptRequest(port);

    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId,
        ambulanceId: 'A-07',
      });
    });
    const arrivedAt = useCitizenRequestStore.getState().arrivedAt;
    act(() => {
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId,
        ambulanceId: 'A-07',
      });
    });
    expect(useCitizenRequestStore.getState().arrivedAt).toBe(arrivedAt);

    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId });
    });
    const confirmedAt = useCitizenRequestStore.getState().confirmedAt;
    act(() => {
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId });
    });
    expect(useCitizenRequestStore.getState().confirmedAt).toBe(confirmedAt);
    expect(useCitizenRequestStore.getState().phase).toBe('closed');
  });

  it('opens a center detail when its rail row is clicked', () => {
    renderPage({ centrosAyuda: MOCK_CENTROS_AYUDA });

    const rail = citizenRail();
    fireEvent.click(within(rail).getByRole('button', { name: /Acopio La Gaitana/ }));

    expect(screen.getByRole('heading', { level: 1, name: 'Centro de acopio' })).toBeInTheDocument();
    expect(screen.getByText('Seleccionaste Acopio La Gaitana en el mapa')).toBeInTheDocument();
    expect(screen.getByTestId('map-canvas')).toHaveAttribute(
      'data-selected-centro',
      'CA-LA-GAITANA',
    );
    // The detail looks at ITS center: the map focus is the opened center's point.
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-focus', '4.72,-74.05');
  });

  it('AC-U1: a map background click closes the open center detail', () => {
    renderPage({ centrosAyuda: MOCK_CENTROS_AYUDA });

    const rail = citizenRail();
    fireEvent.click(within(rail).getByRole('button', { name: /Acopio La Gaitana/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Centro de acopio' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('map-background'));

    // The panel released the UI: the detail is gone, the map title and the
    // citizen rail are back, and the map is told to highlight no center.
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Centro de acopio' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-selected-centro', '');
    expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeInTheDocument();
  });

  it('cancels the donation picker without opening a center or donating', () => {
    renderPage({ ambulancias: MOCK_AMBULANCIAS, centrosAyuda: MOCK_CENTROS_AYUDA });

    fireEvent.click(screen.getByRole('button', { name: 'Donar suministros' }));
    const picker = screen.getByRole('complementary', { name: 'Elegir centro de donación' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancelar' }));

    expect(
      screen.queryByRole('complementary', { name: 'Elegir centro de donación' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Centro de acopio' }),
    ).not.toBeInTheDocument();
    // The citizen rail is back, nothing was chosen and nothing was donated.
    expect(screen.getByRole('button', { name: 'Donar suministros' })).toBeInTheDocument();
    expect(useDonationStore.getState().updated).toEqual({});
  });

  it('walks the mock donation flow c7 -> c8 -> c9 and mutates the front state', () => {
    // The local mutation is the DEMO branch: pin it so the case keeps asserting
    // fixtures instead of the backend write.
    vi.stubEnv('VITE_DEMO_MODE', '1');
    renderPage({ ambulancias: MOCK_AMBULANCIAS, centrosAyuda: MOCK_CENTROS_AYUDA });

    // c7: "Donar suministros" does NOT choose a center — it opens the picker and
    // waits. The mockup's Suba Norte is offered, but nothing is selected yet.
    fireEvent.click(screen.getByRole('button', { name: 'Donar suministros' }));

    expect(
      screen.queryByRole('heading', { level: 1, name: 'Centro de acopio' }),
    ).not.toBeInTheDocument();
    const picker = screen.getByRole('complementary', { name: 'Elegir centro de donación' });
    expect(within(picker).getByText('Acopio Suba Norte')).toBeInTheDocument();
    expect(within(picker).getByText('Acopio La Gaitana')).toBeInTheDocument();
    // Tibabuyes is green (90%), so it still has a gap and is offered too.
    expect(within(picker).getByText('Acopio Tibabuyes')).toBeInTheDocument();

    // The citizen chooses Suba Norte; only now does the c7 detail open.
    fireEvent.click(within(picker).getByRole('button', { name: /Acopio Suba Norte/ }));

    expect(screen.getByRole('heading', { level: 1, name: 'Centro de acopio' })).toBeInTheDocument();
    expect(screen.getByText('Seleccionaste Acopio Suba Norte en el mapa')).toBeInTheDocument();
    expect(screen.getByTestId('map-canvas')).toHaveAttribute(
      'data-selected-centro',
      'CA-SUBA-NORTE',
    );

    const detail = citizenRail();
    expect(within(detail).getByRole('heading', { name: 'Insumos del centro' })).toBeInTheDocument();
    expect(within(detail).getByText('12 de 60 bidones')).toBeInTheDocument();
    expect(within(detail).getByText('18 de 40 kits')).toBeInTheDocument();
    expect(
      within(detail).getByText(
        'El color del centro es el de su insumo más escaso. Hoy lo que más necesita es agua potable.',
      ),
    ).toBeInTheDocument();

    // c8: the dialog lists only the SCARCE items by scarcity and previews the
    // result with the mockup's specific unit.
    fireEvent.click(within(detail).getByRole('button', { name: 'Donar a este centro' }));

    const dialog = screen.getByRole('dialog', { name: 'Donar a Acopio Suba Norte' });
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual(['INV-SN-1', 'INV-SN-2', 'INV-SN-4', 'INV-SN-3']);
    expect(within(dialog).getByText('12 → 52 de 60')).toBeInTheDocument();
    expect(within(dialog).getByText('bidones de 5 L')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Pasa a alerta: todavía le faltan kits de higiene.'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar donación' }));

    // c9: the toast, the updated card and the recalculated counts.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('El semáforo de Acopio Suba Norte se actualizó para todos'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Donaste 40 bidones de agua potable. Suba Norte pasó de crítico a alerta.'),
    ).toBeInTheDocument();

    const after = citizenRail();
    expect(within(after).getByText('Antes estaba en crítico')).toBeInTheDocument();
    expect(within(after).getByText('+40')).toBeInTheDocument();
    expect(within(after).getByText('52 de 60 bidones')).toBeInTheDocument();
    expect(
      within(after).getByText(
        'El color del centro es el de su insumo más escaso. Ahora lo que más necesita son kits de higiene.',
      ),
    ).toBeInTheDocument();
    expect(within(after).getByRole('button', { name: 'Donar a este centro' })).toBeInTheDocument();
    expect(within(after).getByRole('button', { name: 'Volver al mapa' })).toBeInTheDocument();

    expect(screen.getByTestId('map-canvas')).toHaveAttribute(
      'data-changed-centro',
      'CA-SUBA-NORTE',
    );
    expect(screen.getByText('1 centro estable')).toBeInTheDocument();
    expect(screen.getByText('2 en alerta')).toBeInTheDocument();
    expect(screen.getByText('0 críticos')).toBeInTheDocument();
    expect(legendValue('En alerta')).toBe('2');
    expect(legendValue('Crítico')).toBe('0');

    // "Volver al mapa" restores the citizen rail; the donated state persists.
    fireEvent.click(within(after).getByRole('button', { name: 'Volver al mapa' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 centro estable')).toBeInTheDocument();
    expect(screen.getByText('2 en alerta')).toBeInTheDocument();
  });

  it('reports an affected zone from the rail and publishes it in demo mode', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');
    try {
      const port = new FakeRealtimePort();
      renderPage({ port });

      fireEvent.click(screen.getByRole('button', { name: 'Reportar zona afectada' }));
      const dialog = screen.getByRole('dialog', { name: 'Reportar zona afectada' });
      fireEvent.change(within(dialog).getByLabelText('Tipo de emergencia'), {
        target: { value: 'LANDSLIDE' },
      });
      fireEvent.change(within(dialog).getByLabelText('Comentario'), {
        target: { value: 'Derrumbe en Suba' },
      });
      await pickReportAddress(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));

      await waitFor(() => expect(useEmergencyStore.getState().items).toHaveLength(1));
      expect(useEmergencyStore.getState().items[0]).toMatchObject({
        tipo: 'LANDSLIDE',
        nivel: 'MEDIUM',
        estado: 'REPORTED',
        descripcion: 'Derrumbe en Suba',
        zonaId: '',
      });

      // FW-5: the demo build publishes through the port, like the CRUE does.
      const frame = port.published.find((entry) => entry.destination === DESTINATIONS.emergencias);
      expect(frame?.payload).toMatchObject({
        type: 'emergency.upsert',
        emergency: { estado: 'REPORTED', zonaId: '' },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('confirms the citizen exactly once after the report succeeds in demo mode', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');
    try {
      renderPage({ port: new FakeRealtimePort() });

      fireEvent.click(screen.getByRole('button', { name: 'Reportar zona afectada' }));
      const dialog = screen.getByRole('dialog', { name: 'Reportar zona afectada' });
      fireEvent.change(within(dialog).getByLabelText('Tipo de emergencia'), {
        target: { value: 'LANDSLIDE' },
      });
      fireEvent.change(within(dialog).getByLabelText('Comentario'), {
        target: { value: 'Derrumbe en Suba' },
      });
      await pickReportAddress(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));

      await waitFor(() => expect(useEmergencyStore.getState().items).toHaveLength(1));

      // One toast per submit, and it must NOT claim a server round-trip: in demo
      // mode there is no backend, so it only speaks about registration.
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe(
        'Reporte registrado. Los centros de ayuda cercanos lo verán en el mapa.',
      );
      expect(toasts[0].tone).toBe('ok');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('leaves no toast when the report fails against the backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_REGISTRO_EMERGENCIA',
        mensaje: 'No se pudo registrar la emergencia.',
      }),
    );
    vi.stubEnv('VITE_DEMO_MODE', '0');
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'Reportar zona afectada' }));
      const dialog = screen.getByRole('dialog', { name: 'Reportar zona afectada' });
      fireEvent.change(within(dialog).getByLabelText('Tipo de emergencia'), {
        target: { value: 'LANDSLIDE' },
      });
      fireEvent.change(within(dialog).getByLabelText('Comentario'), {
        target: { value: 'Derrumbe en Suba' },
      });
      await pickReportAddress(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));

      await within(dialog).findByText('No se pudo registrar la emergencia.');

      // The dialog owns the error feedback; a failure must raise no toast.
      expect(useToastStore.getState().toasts).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('generates distinct ids for two demo reports made from the same store', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');
    try {
      renderPage({ port: new FakeRealtimePort() });

      const submitReport = async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Reportar zona afectada' }));
        const dialog = screen.getByRole('dialog', { name: 'Reportar zona afectada' });
        fireEvent.change(within(dialog).getByLabelText('Tipo de emergencia'), {
          target: { value: 'LANDSLIDE' },
        });
        fireEvent.change(within(dialog).getByLabelText('Comentario'), {
          target: { value: 'Derrumbe en Suba' },
        });
        await pickReportAddress(dialog);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      };

      // Both reports share the same initial store: `nextEmergencyId` used to
      // return `EMG-001` twice and the store's merge-by-id dropped the first.
      await submitReport();
      await submitReport();

      const ids = useEmergencyStore.getState().items.map((item) => item.id);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows the backend error message without closing the report dialog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_REGISTRO_EMERGENCIA',
        mensaje: 'No se pudo registrar la emergencia.',
      }),
    );
    vi.stubEnv('VITE_DEMO_MODE', '0');
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'Reportar zona afectada' }));
      const dialog = screen.getByRole('dialog', { name: 'Reportar zona afectada' });
      fireEvent.change(within(dialog).getByLabelText('Tipo de emergencia'), {
        target: { value: 'LANDSLIDE' },
      });
      fireEvent.change(within(dialog).getByLabelText('Comentario'), {
        target: { value: 'Derrumbe en Suba' },
      });
      await pickReportAddress(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));

      expect(
        await within(dialog).findByText('No se pudo registrar la emergencia.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Reportar zona afectada' })).toBeInTheDocument();
      expect(useEmergencyStore.getState().items).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('EP-02.F1.US2: reads the emergencies again when the channel comes back after a drop', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    const reportedWhileOffline = {
      id: '3f0c1f1e-5c0a-4d39-9d0b-0d3b7a1c2e11',
      ubicacion: { lat: 4.74, lng: -74.08 },
      tipo: 'INCENDIO',
      nivel: 'ALTO',
      estado: 'REGISTRADA',
      descripcion: 'Incendio reportado durante el corte',
      zonaId: null,
      createdAt: '2026-10-05T10:00:00Z',
    };
    let emergencias: unknown[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const body = String(input).endsWith('/emergencias') ? emergencias : [];
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const port = new FakeRealtimePort();
      renderPage({ port, emergencias: undefined });
      const reads = () =>
        fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/emergencias')).length;
      await waitFor(() => expect(reads()).toBe(1));
      expect(useEmergencyStore.getState().items).toHaveLength(0);

      // The broker does not replay what was published while the channel was down.
      emergencias = [reportedWhileOffline];
      act(() => port.setState('STALE'));
      act(() => port.setState('CONNECTED'));

      await waitFor(() => expect(useEmergencyStore.getState().items).toHaveLength(1));
      expect(useEmergencyStore.getState().items[0]).toMatchObject({
        id: reportedWhileOffline.id,
        tipo: 'FIRE',
        nivel: 'HIGH',
      });
      expect(reads()).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens a single GPS watcher although the report dialog is always mounted', () => {
    const watchPosition = vi.fn().mockReturnValue(1);
    const clearWatch = vi.fn();
    Object.defineProperty(window.navigator, 'geolocation', {
      value: { watchPosition, clearWatch },
      configurable: true,
    });
    try {
      renderPage();

      // The page owns the one high-accuracy watcher; the always-mounted report
      // dialog reuses it through the `location` prop instead of opening a second.
      expect(watchPosition).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.navigator, 'geolocation', {
        value: undefined,
        configurable: true,
      });
    }
  });

  /** Layer ids as the MapCanvas mock received them (`data-<layer>` attribute). */
  function mapLayerIds(
    attribute: 'data-centros' | 'data-ambulancias' | 'data-emergencias',
  ): string[] {
    const raw = screen.getByTestId('map-canvas').getAttribute(attribute);
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  it('AC1: draws an emergency that arrives over the realtime channel on the citizen map', () => {
    const port = new FakeRealtimePort();
    renderPage({ port });

    act(() => {
      port.emit(DESTINATIONS.emergencias, {
        type: 'emergency.upsert',
        emergency: {
          id: 'EMG-RT-1',
          ubicacion: { lat: 4.73, lng: -74.08 },
          nivel: 'ALTO',
          estado: 'REGISTRADA',
          descripcion: 'Incendio en Suba',
          zonaId: null,
          createdAt: '2026-01-01T09:40:00.000Z',
        },
      });
    });

    // The store kept the live alert...
    expect(useEmergencyStore.getState().items.map((item) => item.id)).toEqual(['EMG-RT-1']);
    // ...and the citizen map is now handed that same emergency to paint.
    expect(mapLayerIds('data-emergencias')).toEqual(['EMG-RT-1']);
  });

  it('AC2: draws the citizen own report on their map right after submitting', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');
    try {
      renderPage({ port: new FakeRealtimePort() });

      fireEvent.click(screen.getByRole('button', { name: 'Reportar zona afectada' }));
      const dialog = screen.getByRole('dialog', { name: 'Reportar zona afectada' });
      fireEvent.change(within(dialog).getByLabelText('Tipo de emergencia'), {
        target: { value: 'LANDSLIDE' },
      });
      fireEvent.change(within(dialog).getByLabelText('Comentario'), {
        target: { value: 'Derrumbe en Suba' },
      });
      await pickReportAddress(dialog);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar' }));

      // The local upsert lands before publishing, so the report is painted at once.
      await waitFor(() => expect(useEmergencyStore.getState().items).toHaveLength(1));
      const reportedId = useEmergencyStore.getState().items[0].id;
      expect(mapLayerIds('data-emergencias')).toEqual([reportedId]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('draws the two map layers by default and shows every toggle pressed', () => {
    renderPage({
      ambulancias: [amb('AMB-1', 'AVAILABLE')],
      centrosAyuda: [centro('CA-1', 'GREEN', 4.728, -74.078)],
    });

    // The current behaviour is preserved: nothing is filtered out of the box.
    expect(mapLayerIds('data-ambulancias')).toEqual(['AMB-1']);
    expect(mapLayerIds('data-centros')).toEqual(['CA-1']);

    expect(screen.getByRole('button', { name: 'Centros (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Ambulancias (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Zones are point reports, not a map layer: no toggle exists for them.
    expect(screen.queryByRole('button', { name: /^Zonas/ })).not.toBeInTheDocument();
  });

  it('AC1: isolates the ambulances on the map when the centers layer is off', () => {
    renderPage({
      ambulancias: [amb('AMB-1', 'AVAILABLE')],
      centrosAyuda: [centro('CA-1', 'GREEN', 4.728, -74.078)],
    });

    // "Solo ambulancias": centers are turned off, one toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Centros (1)' }));

    expect(screen.getByRole('button', { name: 'Centros (1)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The map receives the ambulances and NO center.
    expect(mapLayerIds('data-ambulancias')).toEqual(['AMB-1']);
    expect(mapLayerIds('data-centros')).toEqual([]);
  });

  it('AC2: keeps a hidden layer event in the store and paints it once the filter is lifted', () => {
    const port = new FakeRealtimePort();
    renderPage({ port, ambulancias: [amb('AMB-1', 'AVAILABLE')] });

    // Hide the ambulance layer: the map is handed no unit at all...
    fireEvent.click(screen.getByRole('button', { name: 'Ambulancias (1)' }));
    expect(mapLayerIds('data-ambulancias')).toEqual([]);

    // ...but a realtime event for that hidden layer still reaches the store.
    act(() => {
      port.emit(DESTINATIONS.flota, {
        type: 'fleet.upsert',
        unit: amb('AMB-9', 'AVAILABLE', 0.02),
      });
    });

    // The alert is NOT lost: the store kept it (count grew to 2) while the map
    // still draws nothing for the hidden layer.
    expect(useFleetStore.getState().units.map((unit) => unit.id)).toContain('AMB-9');
    expect(screen.getByRole('button', { name: 'Ambulancias (2)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(mapLayerIds('data-ambulancias')).toEqual([]);

    // Lifting the filter reveals the unit that arrived while it was hidden.
    fireEvent.click(screen.getByRole('button', { name: 'Ambulancias (2)' }));
    expect(mapLayerIds('data-ambulancias')).toEqual(['AMB-1', 'AMB-9']);
  });

  it('persists the filter choice so a remount re-reads it', () => {
    const view = renderPage({ ambulancias: [amb('AMB-1', 'AVAILABLE')] });

    fireEvent.click(screen.getByRole('button', { name: 'Ambulancias (1)' }));
    expect(screen.getByRole('button', { name: 'Ambulancias (1)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(mapLayerIds('data-ambulancias')).toEqual([]);

    view.unmount();
    renderPage({ ambulancias: [amb('AMB-1', 'AVAILABLE')] });

    // The choice survived the remount: still off, still nothing drawn.
    expect(screen.getByRole('button', { name: 'Ambulancias (1)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(mapLayerIds('data-ambulancias')).toEqual([]);
  });
});
