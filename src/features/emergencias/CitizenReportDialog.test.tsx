import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSECURE_CONTEXT_MESSAGE } from '@/features/geolocalizacion/use-device-location';
import { CitizenReportDialog } from './CitizenReportDialog';

const MAP_CENTER = { lat: 4.73, lng: -74.08 };

function renderDialog(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  render(
    <CitizenReportDialog
      open
      onOpenChange={onOpenChange}
      mapCenter={MAP_CENTER}
      onSubmit={onSubmit}
    />,
  );
  return { onOpenChange, onSubmit };
}

function dialog() {
  return screen.getByRole('dialog', { name: 'Reportar zona afectada' });
}

describe('CitizenReportDialog', () => {
  afterEach(cleanup);

  it('submits the report built from the description and the map center', async () => {
    const { onSubmit, onOpenChange } = renderDialog();

    fireEvent.change(within(dialog()).getByLabelText('Descripción'), {
      target: { value: 'Derrumbe en Suba' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Usar el centro del mapa' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      ubicacion: MAP_CENTER,
      nivel: 'MEDIUM',
      descripcion: 'Derrumbe en Suba',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('blocks the submit and shows the validation errors as alerts', () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    expect(within(dialog()).getAllByRole('alert')).toHaveLength(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the API error message and stays open when the submit fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('No se pudo registrar la emergencia.'));
    const { onOpenChange } = renderDialog(onSubmit);

    fireEvent.change(within(dialog()).getByLabelText('Descripción'), {
      target: { value: 'Derrumbe' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Usar el centro del mapa' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reportar' }));

    expect(
      await within(dialog()).findByText('No se pudo registrar la emergencia.'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('shows the existing insecure-context message when the GPS is unavailable, without blocking', () => {
    renderDialog();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Usar mi ubicación' }));

    // jsdom has no geolocation API, so the hook reports "unsupported".
    expect(within(dialog()).getByText(INSECURE_CONTEXT_MESSAGE)).toBeInTheDocument();

    fireEvent.change(within(dialog()).getByLabelText('Descripción'), {
      target: { value: 'Derrumbe' },
    });
    fireEvent.change(within(dialog()).getByLabelText('Latitud'), { target: { value: '4.7' } });
    fireEvent.change(within(dialog()).getByLabelText('Longitud'), { target: { value: '-74' } });

    expect(within(dialog()).getByRole('button', { name: 'Reportar' })).toBeEnabled();
  });
});
