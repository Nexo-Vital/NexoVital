import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

describe('DialogContent', () => {
  afterEach(cleanup);

  it('renders the scrim by default so other dialogs keep their overlay', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Alta de ambulancia</DialogTitle>
          <DialogDescription>Completá los datos de la unidad.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument();
  });

  it('omits the scrim when showOverlay is false', () => {
    render(
      <Dialog open modal={false}>
        <DialogContent showOverlay={false}>
          <DialogTitle>Aviso no modal</DialogTitle>
          <DialogDescription>El aviso no debe bloquear el resto de la app.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).not.toBeInTheDocument();
  });
});
