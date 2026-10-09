import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptancePopup } from './AcceptancePopup';

describe('AcceptancePopup live region', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('mounts the live region empty and fills it after the acceptance arrives', () => {
    // Server rendering runs no effects, so it shows the FIRST commit: the
    // region must already exist with no message inside. A live region inserted
    // already populated is announced unreliably (C1); the announcement must be
    // the CHANGE of an already-present region's text.
    const firstPaint = renderToStaticMarkup(
      <AcceptancePopup ambulanceId="A-12" onClose={() => undefined} />,
    );
    expect(firstPaint).toContain('role="status"');
    expect(firstPaint).toContain('aria-live="polite"');
    expect(firstPaint).toContain('Una ambulancia aceptó');
    expect(firstPaint).not.toContain('La ambulancia con placa A-12 aceptó tu solicitud.');

    // After mount, the message is a text change inside the present region.
    render(<AcceptancePopup ambulanceId="A-12" onClose={() => undefined} />);
    const region = screen.getByRole('status');
    expect(
      within(region).getByText('La ambulancia con placa A-12 aceptó tu solicitud.'),
    ).toBeInTheDocument();
  });

  it('names the plate and the driver when the unit is known', () => {
    const unit = {
      id: 'uuid-1',
      placa: 'ABC101',
      estado: 'EN_ROUTE' as const,
      ubicacion: { lat: 4.7, lng: -74.08 },
      zona: 'Suba',
      driverName: 'Ana Ruiz',
    };
    render(<AcceptancePopup ambulanceId="uuid-1" unit={unit} onClose={() => undefined} />);
    expect(
      within(screen.getByRole('status')).getByText(
        'La ambulancia con placa ABC101 y conductor Ana Ruiz aceptó tu solicitud.',
      ),
    ).toBeInTheDocument();
  });

  it('is a non-modal notice: no autofocus and a keyboard-reachable "Cerrar"', () => {
    render(<AcceptancePopup ambulanceId="A-12" onClose={() => undefined} />);

    // Nothing is autofocused: focus stays where the user left it (the body).
    expect(document.activeElement).toBe(document.body);

    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(close).toBeEnabled();
    close.focus();
    expect(close).toHaveFocus();
  });
});
