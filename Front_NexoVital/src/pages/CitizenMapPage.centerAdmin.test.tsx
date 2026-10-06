import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDonationStore } from '@/features/donaciones/donation';
import type { MapaResponse } from '@/features/mapa/map-api';
import { useInventarioStore } from '@/features/recursos/inventory-store';
import { setToken } from '@/services/apiClient';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import CitizenMapPage from './CitizenMapPage';

// The page can trigger third-party requests (routing, geocoding); `msw` is not
// wired in this repo, so both clients are mocked and this file never performs
// real network I/O beyond the stubbed `fetch` for the backend.
vi.mock('@/features/mapa/routing-api', () => ({
  fetchRuta: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/features/geocodificacion/geocoding-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/geocodificacion/geocoding-api')>()),
  searchAddress: vi.fn().mockResolvedValue([]),
  reverseGeocode: vi.fn().mockResolvedValue('Calle 145, Suba'),
}));

const CENTRO_ID = 'ORG-RINCON';
const OTRO_CENTRO_ID = 'ORG-SUBA';

const AGUA = {
  id: 'ITEM-AGUA',
  centroAcopioId: CENTRO_ID,
  nombre: 'Agua potable',
  disponible: 20,
  requerido: 60,
  semaforo: 'ROJO',
};
const COBIJAS = {
  id: 'ITEM-COBIJAS',
  centroAcopioId: CENTRO_ID,
  nombre: 'Cobijas',
  disponible: 0,
  requerido: 30,
  semaforo: 'ROJO',
};

/** The administrator's center exactly as `GET /centros-acopio/mio` returns it. */
const MI_CENTRO = {
  id: CENTRO_ID,
  nombre: 'Centro Rincón',
  ubicacion: { lat: 4.75, lng: -74.06 },
  items: [AGUA, COBIJAS],
};

const MAPA_SIN_MI_CENTRO: MapaResponse = {
  zonas: [],
  centros: [
    {
      id: OTRO_CENTRO_ID,
      nombre: 'Acopio Suba Norte',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Suba',
      ubicacion: { lat: 4.742, lng: -74.09 },
    },
  ],
};

const MAPA_CON_MI_CENTRO: MapaResponse = {
  zonas: [],
  centros: [
    ...MAPA_SIN_MI_CENTRO.centros,
    {
      id: CENTRO_ID,
      nombre: 'Centro Rincón',
      tipo: 'CENTRO_ACOPIO',
      ubicacion: MI_CENTRO.ubicacion,
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

const SIN_CENTRO = mockResponse(404, {
  codigo: 'CENTRO_NO_REGISTRADO',
  mensaje: 'Todavía no has creado tu centro.',
});

interface BackendOptions {
  /** Answer of `GET /centros-acopio/mio`. */
  miCentro: () => Response;
  /** Answer of the `POST` routes, by URL suffix. */
  post?: (url: string, body: unknown) => Response;
}

/** A tiny backend: routes the stubbed `fetch` by method and URL. */
function backend(fetchMock: ReturnType<typeof vi.fn>, options: BackendOptions) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return Promise.resolve(options.post?.(url, body) ?? mockResponse(500, {}));
    }
    if (url.endsWith('/centros-acopio/mio')) {
      return Promise.resolve(options.miCentro());
    }
    if (url.endsWith(`/centros-acopio/${CENTRO_ID}/inventario`)) {
      return Promise.resolve(mockResponse(200, [AGUA, COBIJAS]));
    }
    if (url.includes('/inventario')) {
      return Promise.resolve(mockResponse(200, []));
    }
    if (url.endsWith('/mapa')) {
      const tieneCentro = options.miCentro().status === 200;
      return Promise.resolve(
        mockResponse(200, tieneCentro ? MAPA_CON_MI_CENTRO : MAPA_SIN_MI_CENTRO),
      );
    }
    return Promise.resolve(mockResponse(200, []));
  });
}

function renderAdmin() {
  return render(
    <CitizenMapPage
      centerAdmin
      port={new FakeRealtimePort()}
      ambulancias={[]}
      emergencias={[]}
      solicitudes={[]}
      centrosAyuda={[]}
    />,
  );
}

function roleActions() {
  return screen.getByRole('region', { name: 'Acciones de tu rol' });
}

function myCenterRail() {
  return screen.getByRole('complementary', { name: 'Panel de mi centro' });
}

/** The POST calls the page made, as `[url, parsedBody]`. */
function posts(fetchMock: ReturnType<typeof vi.fn>): [string, unknown][] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url, init]) => [String(url), JSON.parse(String((init as RequestInit).body))]);
}

/**
 * The help-center administrator's variant of the citizen map (EP-03.F1.US1):
 * the same screen, with "Donar suministros" replaced by the action on their own
 * center.
 */
describe('CitizenMapPage as the help-center administrator', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useInventarioStore.getState().reset();
    useDonationStore.setState({ updated: {} });
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('keeps the citizen actions and offers "Crear centro" while there is no center', async () => {
    backend(fetchMock, { miCentro: () => SIN_CENTRO });
    renderAdmin();

    expect(
      await within(roleActions()).findByRole('button', { name: 'Crear centro' }),
    ).toBeEnabled();
    expect(within(roleActions()).getByText(/Administrador de centro/)).toBeInTheDocument();
    expect(
      within(roleActions()).getByRole('button', { name: 'Pedir ambulancia' }),
    ).toBeInTheDocument();
    expect(
      within(roleActions()).getByRole('button', { name: 'Reportar zona afectada' }),
    ).toBeInTheDocument();
    // The one action that is replaced.
    expect(screen.queryByRole('button', { name: 'Donar suministros' })).not.toBeInTheDocument();
  });

  it('opens the creation form from "Crear centro"', async () => {
    backend(fetchMock, { miCentro: () => SIN_CENTRO });
    renderAdmin();

    fireEvent.click(await within(roleActions()).findByRole('button', { name: 'Crear centro' }));

    const dialog = screen.getByRole('dialog', { name: 'Crear centro' });
    expect(within(dialog).getByLabelText('Nombre del centro')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Escribir dirección' })).toBeInTheDocument();
    // Supplies are optional: the list starts empty and grows on demand.
    expect(within(dialog).queryByLabelText('Insumo 1')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Agregar un insumo' })).toBeInTheDocument();
  });

  it('never offers "Crear centro" when the center could not be read', async () => {
    let fallar = true;
    backend(fetchMock, {
      miCentro: () =>
        fallar ? mockResponse(500, { mensaje: 'Falló' }) : mockResponse(200, MI_CENTRO),
    });
    renderAdmin();

    const retry = await within(roleActions()).findByRole('button', {
      name: 'Reintentar consulta de mi centro',
    });
    expect(screen.queryByRole('button', { name: 'Crear centro' })).not.toBeInTheDocument();

    fallar = false;
    fireEvent.click(retry);

    expect(
      await within(roleActions()).findByRole('button', { name: 'Administrar mi centro' }),
    ).toBeEnabled();
  });

  it('shows the center, its location and each supply from "Administrar mi centro"', async () => {
    backend(fetchMock, { miCentro: () => mockResponse(200, MI_CENTRO) });
    renderAdmin();

    fireEvent.click(
      await within(roleActions()).findByRole('button', { name: 'Administrar mi centro' }),
    );

    const rail = myCenterRail();
    expect(within(rail).getByRole('heading', { name: 'Centro Rincón' })).toBeInTheDocument();
    expect(await within(rail).findByText('Cerca de Calle 145, Suba')).toBeInTheDocument();
    expect(within(rail).getByText('20 de 60')).toBeInTheDocument();
    expect(within(rail).getByText('0 de 30')).toBeInTheDocument();
    expect(within(rail).getByText(/2 insumos · 20 unidades en total/)).toBeInTheDocument();
    // Nothing to withdraw from an empty supply.
    expect(
      within(rail).getByRole('button', { name: 'Retirar unidades de Cobijas' }),
    ).toBeDisabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Mi centro' })).toBeInTheDocument();
  });

  it('withdraws 12 of 20 through the dispatch and shows the 8 that are left', async () => {
    backend(fetchMock, {
      miCentro: () => mockResponse(200, MI_CENTRO),
      post: () => mockResponse(200, { ...AGUA, disponible: 8 }),
    });
    renderAdmin();
    fireEvent.click(
      await within(roleActions()).findByRole('button', { name: 'Administrar mi centro' }),
    );

    fireEvent.click(
      within(myCenterRail()).getByRole('button', { name: 'Retirar unidades de Agua potable' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Retirar Agua potable' });
    fireEvent.change(within(dialog).getByLabelText('Cantidad a retirar'), {
      target: { value: '12' },
    });
    expect(within(dialog).getByTestId('withdraw-preview')).toHaveTextContent('Quedarán 8 de 60.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirar 12' }));

    // The rail is hidden from the accessibility tree while the modal is open,
    // so the new quantity is awaited on the screen and the rail read afterwards.
    expect(await screen.findByText('8 de 60')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([
      [
        `/api/v1/centros-acopio/${CENTRO_ID}/inventario/despacho`,
        { itemId: AGUA.id, cantidad: 12 },
      ],
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Retirar Agua potable' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('never lets the withdrawal exceed what the center has', async () => {
    backend(fetchMock, { miCentro: () => mockResponse(200, MI_CENTRO) });
    renderAdmin();
    fireEvent.click(
      await within(roleActions()).findByRole('button', { name: 'Administrar mi centro' }),
    );
    fireEvent.click(
      within(myCenterRail()).getByRole('button', { name: 'Retirar unidades de Agua potable' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Retirar Agua potable' });

    fireEvent.change(within(dialog).getByLabelText('Cantidad a retirar'), {
      target: { value: '999' },
    });

    expect(within(dialog).getByRole('button', { name: 'Retirar 20' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('withdraw-preview')).toHaveTextContent('Quedarán 0 de 60.');
  });

  it('adds a new supply and lists it in the center', async () => {
    const alimentos = {
      id: 'ITEM-ALIMENTOS',
      centroAcopioId: CENTRO_ID,
      nombre: 'Alimentos',
      disponible: 5,
      requerido: 100,
      semaforo: 'ROJO',
    };
    backend(fetchMock, {
      miCentro: () => mockResponse(200, MI_CENTRO),
      post: () => mockResponse(201, alimentos),
    });
    renderAdmin();
    fireEvent.click(
      await within(roleActions()).findByRole('button', { name: 'Administrar mi centro' }),
    );
    // Wait for the inventory read, so the rail already lists the two supplies.
    await within(myCenterRail()).findByText('20 de 60');

    fireEvent.click(within(myCenterRail()).getByRole('button', { name: 'Agregar insumo' }));
    const dialog = screen.getByRole('dialog', { name: 'Agregar insumo' });
    fireEvent.change(within(dialog).getByLabelText('Insumo'), { target: { value: 'Alimentos' } });
    fireEvent.change(within(dialog).getByLabelText('Tengo hoy'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Máximo que necesita'), {
      target: { value: '100' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar insumo' }));

    expect(await screen.findByText('5 de 100')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([
      [
        '/api/v1/centros-acopio/mio/inventario',
        { nombre: 'Alimentos', disponible: 5, requerido: 100 },
      ],
    ]);
  });

  it('rejects a supply the center already has without calling the backend', async () => {
    backend(fetchMock, { miCentro: () => mockResponse(200, MI_CENTRO) });
    renderAdmin();
    fireEvent.click(
      await within(roleActions()).findByRole('button', { name: 'Administrar mi centro' }),
    );
    await within(myCenterRail()).findByText('20 de 60');

    fireEvent.click(within(myCenterRail()).getByRole('button', { name: 'Agregar insumo' }));
    const dialog = screen.getByRole('dialog', { name: 'Agregar insumo' });
    fireEvent.change(within(dialog).getByLabelText('Insumo'), {
      target: { value: 'agua potable' },
    });
    fireEvent.change(within(dialog).getByLabelText('Tengo hoy'), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText('Máximo que necesita'), {
      target: { value: '5' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar insumo' }));

    expect(within(dialog).getByText('Ese insumo ya está en la lista.')).toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([]);
  });

  it('leaves the citizen screen untouched: no center request and the donation action', async () => {
    backend(fetchMock, { miCentro: () => SIN_CENTRO });
    render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        ambulancias={[]}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Donar suministros' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear centro' })).not.toBeInTheDocument();
    expect(within(roleActions()).getByText(/Ciudadano/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/centros-acopio/mio'))).toBe(
      false,
    );
  });
});
