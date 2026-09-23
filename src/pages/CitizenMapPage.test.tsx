import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCEPTANCE_POPUP_MS } from '@/features/ciudadano/AcceptancePopup';
import { useCitizenRequestStore } from '@/features/ciudadano/citizen-request-store';
import { CENTER_LEVEL_STYLE, NOT_DECLARED_CENTER_STYLE } from '@/features/ciudadano/citizen-view';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { DESTINATIONS, type SolicitudCancelPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { GLOBALS_CSS, paletteDeclaration } from '@/test/mockup-palette';
import type {
  AmbulanceState,
  Ambulancia,
  CentroAyuda,
  InventarioItem,
  TrafficLight,
} from '@/types/domain';
import CitizenMapPage from './CitizenMapPage';

// Leaflet needs a real layout engine; stub the map so the citizen chrome is
// tested in isolation. The stub echoes the props this unit wires (the selected
// unit, its label override and the connector) so the c4 map path stays asserted.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: (props: {
    selectedAmbulanceId?: string | null;
    ambulanceLabels?: Record<string, string>;
    requestConnector?: { dashed?: boolean } | null;
  }) => (
    <div
      data-testid="map-canvas"
      data-selected={props.selectedAmbulanceId ?? ''}
      data-labels={JSON.stringify(props.ambulanceLabels ?? {})}
      data-connector={props.requestConnector ? 'yes' : 'no'}
      data-connector-dashed={props.requestConnector?.dashed === false ? 'no' : 'yes'}
    />
  ),
}));

/** Origin used by the page when the device gives no position (Suba). */
const SUBAS = { lat: 4.728, lng: -74.078 };

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
  afterEach(() => {
    cleanup();
    useFleetStore.getState().hydrate([]);
    useEmergencyStore.getState().hydrate([]);
    useSolicitudesStore.getState().hydrate([]);
    useCitizenRequestStore.getState().reset();
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
    expect(screen.getByRole('complementary', { name: 'Leyenda del mapa' })).toBeInTheDocument();

    const rail = screen.getByRole('complementary', { name: 'Panel del ciudadano' });
    expect(within(rail).getByText(/Acciones de tu rol/)).toBeInTheDocument();
    expect(
      within(rail).getByRole('heading', { name: 'Ambulancias cerca de ti' }),
    ).toBeInTheDocument();
    expect(within(rail).getByRole('heading', { name: 'Centros de acopio' })).toBeInTheDocument();
  });

  it('enables "Pedir ambulancia" while "Donar suministros" stays disabled with its note', () => {
    renderPage({ ambulancias: [amb('A-07', 'AVAILABLE')] });

    expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Donar suministros' })).toBeDisabled();
    expect(screen.getByText(/Próximamente/)).toBeInTheDocument();
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
    expect(screen.getByText('Ambulancia A-07')).toBeInTheDocument();
    expect(screen.getByText('Ambulancia A-12')).toBeInTheDocument();
    expect(screen.getByText('Ambulancia A-03')).toBeInTheDocument();
    expect(screen.getAllByText('Avisada')).toHaveLength(3);
    expect(screen.getByText(/Las ambulancias ocupadas \(A-09 y A-15\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar solicitud' })).toBeInTheDocument();

    const frame = port.published.find((entry) => entry.destination === DESTINATIONS.solicitudes);
    expect(frame?.payload).toMatchObject({
      type: 'solicitud.broadcast',
      notificadas: ['A-07', 'A-12', 'A-03'],
    });
  });

  it('does not call the demo fallback the real location while searching', () => {
    // jsdom has no geolocation, so the page uses the Suba fallback. The subtitle
    // must say it is a reference/demo point, never "Tu ubicación actual" (C6).
    renderPage({ ambulancias: SEARCH_FLEET });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

    expect(screen.getByText(/Ubicación de referencia \(demo\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Tu ubicación actual/)).not.toBeInTheDocument();
  });

  it('adjusts the copy when fewer than three units are available', () => {
    renderPage({
      ambulancias: [amb('A-07', 'AVAILABLE'), amb('A-12', 'AVAILABLE'), amb('A-09', 'ASSIGNED')],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Pedir ambulancia' }));

    expect(screen.getByText(/a las 2 ambulancias disponibles más cercanas/)).toBeInTheDocument();
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

    expect(screen.getByText('No hay ambulancias disponibles en este momento.')).toBeInTheDocument();

    // With no available units the button is disabled with its reason visible, so
    // nothing is clickable and inert (C4).
    const requestButton = screen.getByRole('button', { name: 'Pedir ambulancia' });
    expect(requestButton).toBeDisabled();
    expect(requestButton).toHaveAttribute(
      'title',
      'No hay ambulancias disponibles en este momento.',
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

    expect(within(rail).getByText('Carlos Pérez Gómez')).toBeInTheDocument();
    expect(within(rail).getByText('Conductor de la ambulancia')).toBeInTheDocument();
    for (const [label, value] of [
      ['Unidad', 'A-07'],
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
    expect(map.getAttribute('data-labels')).toMatch(/"A-07":"A-07 · \d+ min"/);
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
    expect(legendValue('En mantenimiento')).toBe('1');
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
    expect(rows).toEqual(['Ambulancia AMB-NEAR', 'Ambulancia AMB-MID', 'Ambulancia AMB-FAR']);
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
        'Carlos Pérez Gómez marcó que llegó a tu ubicación con la ambulancia A-07, placa WNR-418. ¿Está contigo?',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('A-07 · WNR-418')).toBeInTheDocument();
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
    expect(entries[1].textContent).toMatch(/^Carlos Pérez Gómez aceptó con la A-07\d{1,2}:\d{2}$/);
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
});
