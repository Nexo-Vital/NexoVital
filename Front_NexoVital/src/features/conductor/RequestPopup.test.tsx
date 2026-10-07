import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestPopup } from './RequestPopup';
import { UNIT_UNRESOLVED_REASON } from './use-solicitud-inbox';

function renderPopup(overrides: Partial<Parameters<typeof RequestPopup>[0]> = {}) {
  const handlers = { onAccept: vi.fn(), onView: vi.fn(), onClose: vi.fn() };
  render(
    <RequestPopup
      distanceLabel="2,3 km · 6 min"
      locationLabel="4.7280, -74.0780"
      deadlineMs={Date.now() + 40_000}
      queuedCount={0}
      submitting={false}
      unitResolved
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('RequestPopup', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows what the driver needs to decide and the three ways out', async () => {
    const user = userEvent.setup();
    const handlers = renderPopup();

    const dialog = screen.getByRole('alertdialog', { name: 'Nueva solicitud de ambulancia' });
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByText('2,3 km · 6 min')).toBeInTheDocument();
    expect(screen.getByText('4.7280, -74.0780')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^0:(3\d|40)$/);
    // Nothing is focused on purpose: a key pressed by habit must not accept.
    expect(dialog.contains(document.activeElement)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Aceptar' }));
    await user.click(screen.getByRole('button', { name: 'Ver solicitud' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(handlers.onAccept).toHaveBeenCalledTimes(1);
    expect(handlers.onView).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when there is no position or place, instead of inventing one', () => {
    renderPopup({ distanceLabel: null, locationLabel: '', deadlineMs: null });

    expect(screen.getAllByText('Sin ubicación')).toHaveLength(2);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('counts the requests that wait behind this one', () => {
    renderPopup({ queuedCount: 1 });
    expect(screen.getByText(/Hay 1 solicitud más en la lista/)).toBeInTheDocument();
    cleanup();

    renderPopup({ queuedCount: 3 });
    expect(screen.getByText(/Hay 3 solicitudes más en la lista/)).toBeInTheDocument();
  });

  it('waits for the server while an accept is in flight', () => {
    renderPopup({ submitting: true });

    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver solicitud' })).toBeDisabled();
    // Closing is always possible.
    expect(screen.getByRole('button', { name: 'Cerrar aviso' })).toBeEnabled();
  });

  it('cannot accept while the unit of the driver is unknown, and says why', () => {
    renderPopup({ unitResolved: false });

    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
    expect(screen.getByText(UNIT_UNRESOLVED_REASON)).toBeInTheDocument();
  });
});
