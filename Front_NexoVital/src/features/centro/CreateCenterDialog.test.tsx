import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceLocationState } from '@/features/geolocalizacion/use-device-location';
import { CreateCenterDialog } from './CreateCenterDialog';

const { searchAddress, reverseGeocode } = vi.hoisted(() => ({
  searchAddress: vi.fn(),
  reverseGeocode: vi.fn(),
}));

// The geocoder is a third-party network service: the dialog is tested against a
// stand-in, and the real client has its own suite (`geocoding-api.test.ts`).
vi.mock('@/features/geocodificacion/geocoding-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/geocodificacion/geocoding-api')>()),
  searchAddress,
  reverseGeocode,
}));

const MAP_CENTER = { lat: 4.73, lng: -74.08 };
const DEVICE = { lat: 4.7512, lng: -74.0655 };

function locationState(overrides: Partial<DeviceLocationState> = {}): DeviceLocationState {
  return {
    position: DEVICE,
    heading: null,
    status: 'granted',
    permission: 'granted',
    simulated: false,
    setSimulatedPosition: vi.fn(),
    clearSimulated: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function renderDialog(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  render(
    <CreateCenterDialog
      open
      onOpenChange={onOpenChange}
      mapCenter={MAP_CENTER}
      location={locationState()}
      onSubmit={onSubmit}
    />,
  );
  return { onOpenChange, onSubmit };
}

function dialog() {
  return screen.getByRole('dialog', { name: 'Crear centro' });
}

function type(label: string, value: string) {
  fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });
}

function addSupply() {
  fireEvent.click(within(dialog()).getByRole('button', { name: /^Agregar (un|otro) insumo$/ }));
}

function submit() {
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Crear centro' }));
}

describe('CreateCenterDialog', () => {
  beforeEach(() => {
    searchAddress.mockReset();
    reverseGeocode.mockReset();
    reverseGeocode.mockResolvedValue('Calle 145, Suba');
  });

  afterEach(() => {
    cleanup();
  });

  it('starts with no supply rows: supplies are optional', () => {
    renderDialog();

    expect(within(dialog()).queryByLabelText('Insumo 1')).not.toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Agregar un insumo' })).toBeInTheDocument();
  });

  it('creates a center with no supplies when only the name and location are given', async () => {
    const { onSubmit } = renderDialog();
    type('Nombre del centro', 'Centro Vacío');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));

    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        nombre: 'Centro Vacío',
        ubicacion: DEVICE,
        items: [],
      }),
    );
  });

  it('shows every missing field and sends nothing', () => {
    const { onSubmit } = renderDialog();

    submit();

    expect(within(dialog()).getByText('Escribe el nombre del centro.')).toBeInTheDocument();
    expect(within(dialog()).getByText(/Indica dónde queda el centro/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('drops a field message as soon as that field is corrected', () => {
    renderDialog();
    submit();

    type('Nombre del centro', 'Centro Rincón');

    expect(within(dialog()).queryByText('Escribe el nombre del centro.')).not.toBeInTheDocument();
    // The other messages belong to fields that are still wrong.
    expect(within(dialog()).getByText(/Indica dónde queda el centro/)).toBeInTheDocument();
  });

  it('sends the name, the device location and every supply with its two amounts', async () => {
    const { onSubmit, onOpenChange } = renderDialog();

    type('Nombre del centro', '  Centro Rincón ');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));
    expect(await within(dialog()).findByText('Cerca de Calle 145, Suba')).toBeInTheDocument();

    addSupply();
    type('Insumo 1', 'Agua potable');
    type('Cantidad actual del insumo 1', '20');
    type('Cantidad máxima del insumo 1', '60');
    addSupply();
    type('Insumo 2', 'Cobijas');
    type('Cantidad actual del insumo 2', '0');
    type('Cantidad máxima del insumo 2', '30');

    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        nombre: 'Centro Rincón',
        ubicacion: DEVICE,
        items: [
          { nombre: 'Agua potable', disponible: 20, requerido: 60 },
          { nombre: 'Cobijas', disponible: 0, requerido: 30 },
        ],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps only digits in the amount fields', () => {
    renderDialog();
    addSupply();

    type('Cantidad actual del insumo 1', '-12.5');

    expect(within(dialog()).getByLabelText('Cantidad actual del insumo 1')).toHaveValue('125');
  });

  it('removes a supply row and renumbers the rest', () => {
    renderDialog();
    addSupply();
    type('Insumo 1', 'Agua potable');
    addSupply();
    type('Insumo 2', 'Cobijas');

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Quitar el insumo 1' }));

    expect(within(dialog()).getByLabelText('Insumo 1')).toHaveValue('Cobijas');
    expect(within(dialog()).queryByLabelText('Insumo 2')).not.toBeInTheDocument();
  });

  it('rejects two supplies with the same name', () => {
    const { onSubmit } = renderDialog();
    type('Nombre del centro', 'Centro Rincón');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));
    addSupply();
    type('Insumo 1', 'Agua');
    type('Cantidad actual del insumo 1', '1');
    type('Cantidad máxima del insumo 1', '5');
    addSupply();
    type('Insumo 2', 'agua');
    type('Cantidad actual del insumo 2', '1');
    type('Cantidad máxima del insumo 2', '5');

    submit();

    expect(within(dialog()).getByText('Ese insumo ya está en la lista.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stays open and shows the backend message when the creation is rejected', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new Error('Ya existe un centro con ese nombre. Elige otro.'));
    const { onOpenChange } = renderDialog(onSubmit);
    type('Nombre del centro', 'Acopio Suba Norte');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));
    addSupply();
    type('Insumo 1', 'Agua');
    type('Cantidad actual del insumo 1', '1');
    type('Cantidad máxima del insumo 1', '5');

    submit();

    expect(
      await within(dialog()).findByText('Ya existe un centro con ese nombre. Elige otro.'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
