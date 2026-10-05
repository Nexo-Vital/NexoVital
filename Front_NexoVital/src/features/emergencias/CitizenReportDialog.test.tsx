import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DeviceLocationState,
  INSECURE_CONTEXT_MESSAGE,
} from '@/features/geolocalizacion/use-device-location';
import { CitizenReportDialog } from './CitizenReportDialog';

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
const SUBA = {
  etiqueta: 'Calle 145 # 91-19, Suba, Bogotá',
  ubicacion: { lat: 4.7412, lng: -74.0836 },
};
const DEVICE = { lat: 4.61, lng: -74.08 };

/**
 * The dialog no longer owns a geolocation watcher: the page passes the shared
 * state down. This stands in for it, defaulting to the "unsupported" status jsdom
 * used to produce through the hook (no geolocation API).
 */
function locationState(overrides: Partial<DeviceLocationState> = {}): DeviceLocationState {
  return {
    position: null,
    heading: null,
    status: 'unsupported',
    permission: 'unknown',
    simulated: false,
    setSimulatedPosition: vi.fn(),
    clearSimulated: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function renderDialog(
  onSubmit = vi.fn().mockResolvedValue(undefined),
  location: DeviceLocationState = locationState(),
) {
  const onOpenChange = vi.fn();
  render(
    <CitizenReportDialog
      open
      onOpenChange={onOpenChange}
      mapCenter={MAP_CENTER}
      location={location}
      onSubmit={onSubmit}
    />,
  );
  return { onOpenChange, onSubmit };
}

function dialog() {
  return screen.getByRole('dialog', { name: 'Reportar zona afectada' });
}

/** Picks an emergency type in the select, as the citizen would. */
function pickType(value: string) {
  fireEvent.change(within(dialog()).getByLabelText('Tipo de emergencia'), {
    target: { value },
  });
}

function writeComment(value: string) {
  fireEvent.change(within(dialog()).getByLabelText('Comentario'), { target: { value } });
}

/** Types an address and picks the suggestion the geocoder returns. */
async function pickAddress(text = 'Calle 145 Suba') {
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Escribir dirección' }));
  fireEvent.change(within(dialog()).getByLabelText('Dirección'), { target: { value: text } });
  fireEvent.click(await within(dialog()).findByRole('button', { name: SUBA.etiqueta }));
}

function chosenLocation() {
  return within(dialog()).getByTestId('citizen-report-chosen-location');
}

describe('CitizenReportDialog', () => {
  beforeEach(() => {
    searchAddress.mockReset().mockResolvedValue([SUBA]);
    reverseGeocode.mockReset().mockResolvedValue('Carrera 10 # 20-30, Santa Fe, Bogotá');
  });

  afterEach(cleanup);

  it('offers the closed list of emergency types, with none selected by default', () => {
    renderDialog();

    const select = within(dialog()).getByLabelText('Tipo de emergencia') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Selecciona el tipo',
      'Inundación',
      'Incendio',
      'Derrumbe',
      'Sismo',
      'Accidente',
      'Otro',
    ]);
  });

  it('never asks for coordinates: only the device location or an address', () => {
    renderDialog();

    expect(within(dialog()).queryByLabelText('Latitud')).toBeNull();
    expect(within(dialog()).queryByLabelText('Longitud')).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Usar el centro del mapa' })).toBeNull();
    expect(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' })).toBeEnabled();
    expect(within(dialog()).getByRole('button', { name: 'Escribir dirección' })).toBeEnabled();
  });

  it('blocks the submit when no emergency type was picked', async () => {
    const { onSubmit } = renderDialog();

    writeComment('Derrumbe en Suba');
    await pickAddress();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    expect(within(dialog()).getByText('Selecciona el tipo de emergencia.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the report with the coordinates of the address the citizen picked', async () => {
    const { onSubmit, onOpenChange } = renderDialog();

    pickType('LANDSLIDE');
    writeComment('Derrumbe en Suba');
    await pickAddress();

    // The search is biased to the point the citizen has on screen.
    expect(searchAddress).toHaveBeenCalledWith(
      'Calle 145 Suba',
      expect.objectContaining({ cerca: MAP_CENTER }),
    );
    expect(chosenLocation()).toHaveTextContent(SUBA.etiqueta);
    expect(within(dialog()).getByLabelText('Dirección')).toHaveValue(SUBA.etiqueta);

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      ubicacion: SUBA.ubicacion,
      tipo: 'LANDSLIDE',
      nivel: 'MEDIUM',
      descripcion: 'Derrumbe en Suba',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('drops the picked point when the citizen edits the address again', async () => {
    const { onSubmit } = renderDialog();

    pickType('FIRE');
    writeComment('Incendio');
    await pickAddress();
    fireEvent.change(within(dialog()).getByLabelText('Dirección'), {
      target: { value: 'Calle 146' },
    });

    expect(within(dialog()).queryByTestId('citizen-report-chosen-location')).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'Indica dónde está la emergencia',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tells the citizen when the address is not found or the search fails', async () => {
    renderDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Escribir dirección' }));

    searchAddress.mockResolvedValueOnce([]);
    fireEvent.change(within(dialog()).getByLabelText('Dirección'), { target: { value: 'zzzzzz' } });
    expect(await within(dialog()).findByText(/No encontramos esa dirección/)).toBeInTheDocument();

    searchAddress.mockRejectedValueOnce(new Error('down'));
    fireEvent.change(within(dialog()).getByLabelText('Dirección'), {
      target: { value: 'zzzzzzz' },
    });
    expect(
      await within(dialog()).findByText(/El buscador de direcciones no responde/),
    ).toBeInTheDocument();
  });

  it('blocks the submit and shows the validation errors as alerts', () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    // Type, comment and location.
    expect(within(dialog()).getAllByRole('alert')).toHaveLength(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the API error message and stays open when the submit fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('No se pudo registrar la emergencia.'));
    const { onOpenChange } = renderDialog(onSubmit);

    pickType('FIRE');
    writeComment('Derrumbe');
    await pickAddress();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    expect(
      await within(dialog()).findByText('No se pudo registrar la emergencia.'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('moves to the address path, with the insecure-context message, when the GPS is unavailable', () => {
    renderDialog();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));

    // The page reports an unsupported geolocation (no HTTPS or no API), so the
    // dialog shows the shared message and opens the address field instead.
    expect(within(dialog()).getByText(INSECURE_CONTEXT_MESSAGE)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText('Dirección')).toBeInTheDocument();
    expect(reverseGeocode).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole('button', { name: 'Reportar' })).toBeEnabled();
  });

  it('uses the device position and shows its approximate address', async () => {
    const { onSubmit } = renderDialog(
      vi.fn().mockResolvedValue(undefined),
      locationState({ status: 'granted', position: DEVICE }),
    );

    pickType('ACCIDENT');
    writeComment('Choque');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));

    expect(reverseGeocode).toHaveBeenCalledWith(DEVICE);
    await waitFor(() =>
      expect(chosenLocation()).toHaveTextContent('Cerca de Carrera 10 # 20-30, Santa Fe, Bogotá'),
    );

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // The exact device point is what gets sent, not the geocoder's answer.
    expect(onSubmit.mock.calls[0][0].ubicacion).toEqual(DEVICE);
  });

  it('falls back to the coordinates when the geocoder fails, without blocking the report', async () => {
    reverseGeocode.mockRejectedValue(new Error('down'));
    const { onSubmit } = renderDialog(
      vi.fn().mockResolvedValue(undefined),
      locationState({ status: 'granted', position: DEVICE }),
    );

    pickType('ACCIDENT');
    writeComment('Choque');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mi ubicación actual' }));

    await waitFor(() => expect(chosenLocation()).toHaveTextContent('4.61000, -74.08000'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
