import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CENTER_LEVEL_STYLE, NOT_DECLARED_CENTER_STYLE } from '@/features/ciudadano/citizen-view';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { DESTINATIONS } from '@/shared/realtime';
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
// tested in isolation.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
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

  it('shows the role actions disabled with a visible note, never as dead clickables', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Pedir ambulancia' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Donar suministros' })).toBeDisabled();
    expect(screen.getByText(/Próximamente/)).toBeInTheDocument();
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
});
