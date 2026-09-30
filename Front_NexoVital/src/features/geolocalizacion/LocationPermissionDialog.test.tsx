import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationPermissionDialog } from './LocationPermissionDialog';
import type { GeolocationStatus, LocationPermissionState } from './use-device-location';

function renderDialog(
  status: GeolocationStatus,
  permission: LocationPermissionState,
  onRetry = vi.fn(),
) {
  const view = render(
    <LocationPermissionDialog status={status} permission={permission} onRetry={onRetry} />,
  );
  return { onRetry, ...view };
}

/** The permission dialog, or null when it is not mounted. */
function dialog() {
  return screen.queryByRole('dialog');
}

describe('LocationPermissionDialog', () => {
  afterEach(cleanup);

  it('shows the dialog when the status is denied', () => {
    renderDialog('denied', 'prompt');

    const modal = screen.getByRole('dialog', { name: 'Permiso de ubicación' });
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Volver a pedir' })).toBeInTheDocument();
  });

  it('does not show the dialog when the status is granted', () => {
    renderDialog('granted', 'granted');

    expect(dialog()).not.toBeInTheDocument();
  });

  it('does not show the dialog while the status is prompt', () => {
    renderDialog('prompt', 'prompt');

    expect(dialog()).not.toBeInTheDocument();
  });

  it('calls the retry and closes from "Volver a pedir"', () => {
    const { onRetry } = renderDialog('denied', 'prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Volver a pedir' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('shows the short blocked line and still offers the retry when the permission is blocked', () => {
    renderDialog('denied', 'denied');

    const modal = screen.getByRole('dialog', { name: 'Permiso de ubicación' });
    expect(
      within(modal).getByText(
        /Tu navegador tiene el permiso bloqueado para este sitio: habilitalo desde sus ajustes y recargá\./i,
      ),
    ).toBeInTheDocument();
    // The app ALWAYS re-asks, so the retry stays even when the browser blocked it.
    expect(within(modal).getByRole('button', { name: 'Volver a pedir' })).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Ahora no' })).toBeInTheDocument();
  });

  it('renders no numbered browser steps in the blocked branch', () => {
    renderDialog('denied', 'denied');

    const modal = screen.getByRole('dialog', { name: 'Permiso de ubicación' });
    expect(within(modal).queryByRole('list')).not.toBeInTheDocument();
    expect(within(modal).queryByText(/sigue estos pasos/i)).not.toBeInTheDocument();
    expect(within(modal).queryByText(/candado/i)).not.toBeInTheDocument();
  });

  it('calls the retry and closes from "Volver a pedir" when the permission is blocked', () => {
    const { onRetry } = renderDialog('denied', 'denied');

    fireEvent.click(screen.getByRole('button', { name: 'Volver a pedir' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('does not show the blocked line when the permission is only prompt', () => {
    renderDialog('denied', 'prompt');

    const modal = screen.getByRole('dialog', { name: 'Permiso de ubicación' });
    expect(within(modal).queryByText(/permiso bloqueado/i)).not.toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Volver a pedir' })).toBeInTheDocument();
  });

  it('degrades to the retry branch when the permission state is unknown', () => {
    renderDialog('denied', 'unknown');

    expect(screen.getByRole('button', { name: 'Volver a pedir' })).toBeInTheDocument();
    expect(screen.queryByText(/permiso bloqueado/i)).not.toBeInTheDocument();
  });

  it('stays closed after dismissing without reopening for the same denial', () => {
    const { rerender } = renderDialog('denied', 'prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(dialog()).not.toBeInTheDocument();

    // The status is still denied; a re-render must NOT reopen the dialog.
    rerender(<LocationPermissionDialog status="denied" permission="prompt" onRetry={vi.fn()} />);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('reopens when a new denial raises the status again', () => {
    const { rerender } = renderDialog('denied', 'prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(dialog()).not.toBeInTheDocument();

    // A retry that is denied again goes prompt -> denied: a NEW denial event.
    rerender(<LocationPermissionDialog status="prompt" permission="prompt" onRetry={vi.fn()} />);
    rerender(<LocationPermissionDialog status="denied" permission="prompt" onRetry={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Permiso de ubicación' })).toBeInTheDocument();
  });
});
