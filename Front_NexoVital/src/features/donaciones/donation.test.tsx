import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { GLOBALS_CSS } from '@/test/mockup-palette';
import type { CentroAyuda } from '@/types/domain';
import { CenterDetailRail, DonationCenterPicker, DonationDialog } from './DonationFlow';
import {
  applyDonation,
  type DonationRecord,
  donableCenters,
  donableItems,
  donationPhrase,
  donationToast,
  formatDistanceTo,
  previewDonation,
  previewMessage,
  scarceNote,
  useDonationStore,
  withDonations,
} from './donation';

const SUBAS = { lat: 4.728, lng: -74.078 };

function subaNorte(): CentroAyuda {
  const centro = MOCK_CENTROS_AYUDA.find((entry) => entry.id === 'CA-SUBA-NORTE');
  if (!centro) {
    throw new Error('missing demo center CA-SUBA-NORTE');
  }
  return centro;
}

/** The c9 state: Suba Norte after donating 40 bidones of water. */
function donatedSubaNorte(): { centro: CentroAyuda; record: DonationRecord } {
  const before = subaNorte();
  return {
    centro: applyDonation(before, 'INV-SN-1', 40),
    record: { centroId: before.id, itemId: 'INV-SN-1', amount: 40, beforeCenterLevel: 'RED' },
  };
}

describe('donation logic', () => {
  it('applies a donation to one item and recomputes only that item', () => {
    const before = subaNorte();
    const after = applyDonation(before, 'INV-SN-1', 40);

    expect(after.items[0]).toMatchObject({ disponible: 52, semaforo: 'GREEN' });
    // 52/60 = 87% -> GREEN; the other items are untouched.
    expect(after.items.slice(1)).toEqual(before.items.slice(1));
    expect(before.items[0].disponible).toBe(12);
  });

  it('recomputes the item level with the shared 35/70/100 thresholds', () => {
    const base: CentroAyuda = {
      id: 'CA-X',
      nombre: 'Centro X',
      ubicacion: { lat: 0, lng: 0 },
      items: [
        {
          id: 'INV-X',
          centroAcopioId: 'CA-X',
          nombre: 'Agua',
          disponible: 0,
          requerido: 100,
          semaforo: 'RED',
          grammaticalNumber: 'singular',
        },
      ],
    };
    const lightAfter = (amount: number) => applyDonation(base, 'INV-X', amount).items[0].semaforo;
    expect(lightAfter(34)).toBe('RED');
    expect(lightAfter(35)).toBe('AMBER');
    expect(lightAfter(69)).toBe('AMBER');
    expect(lightAfter(70)).toBe('GREEN');
    expect(lightAfter(99)).toBe('GREEN');
    expect(lightAfter(100)).toBe('COMPLETE');
  });

  it('offers every item with a gap, most critical first, dropping undeclared and complete', () => {
    expect(donableItems(subaNorte()).map((item) => item.id)).toEqual([
      'INV-SN-1', // 12/60 = 20% -> RED
      'INV-SN-2', // 18/40 = 45% -> AMBER
      'INV-SN-4', // 44/50 = 88% -> GREEN, still 6 short
      'INV-SN-3', // 32/35 = 91% -> GREEN, still 3 short
    ]);

    const gaitana = MOCK_CENTROS_AYUDA.find((entry) => entry.id === 'CA-LA-GAITANA');
    // INV-LG-1 is the only item with a gap: LG-2 is 300/300 (COMPLETE) and
    // LG-3 declares no requirement (0), so neither is offered.
    expect(donableItems(gaitana as CentroAyuda).map((item) => item.id)).toEqual(['INV-LG-1']);
  });

  it('lets a center reach COMPLETE once every gap is donated', () => {
    let centro = subaNorte();
    for (const item of donableItems(centro)) {
      centro = applyDonation(centro, item.id, item.requerido - item.disponible);
    }
    expect(centro.items.every((item) => item.semaforo === 'COMPLETE')).toBe(true);
    expect(donableItems(centro)).toEqual([]);
    expect(scarceNote(centro, 'now')).toBe('Ya tiene todo lo que necesita.');
  });

  it('previews the item and center level before and after', () => {
    const preview = previewDonation(subaNorte(), 'INV-SN-1', 40);
    expect(preview).toMatchObject({
      before: 12,
      after: 52,
      beforeLight: 'RED',
      afterLight: 'GREEN',
      beforeCenterLevel: 'RED',
      afterCenterLevel: 'AMBER',
      beforePercent: 20,
      afterPercent: 87,
    });
    expect(preview?.nextScarce?.id).toBe('INV-SN-2');
  });

  it('says "Sigue en" when the level does not change and guesses no verb', () => {
    const gaitana = MOCK_CENTROS_AYUDA.find((entry) => entry.id === 'CA-LA-GAITANA') as CentroAyuda;
    // Backend items carry no grammatical number: the phrase must not guess it.
    const centro: CentroAyuda = {
      ...gaitana,
      items: gaitana.items.map((item) => ({ ...item, grammaticalNumber: undefined })),
    };
    const preview = previewDonation(centro, 'INV-LG-1', 40);
    if (!preview) {
      throw new Error('preview missing');
    }
    expect(previewMessage(preview)).toBe('Sigue en alerta: todavía necesita alimentos.');
  });

  it('writes the outcome line with the new scarce item and its verb', () => {
    const preview = previewDonation(subaNorte(), 'INV-SN-1', 40);
    if (!preview) {
      throw new Error('preview missing');
    }
    expect(previewMessage(preview)).toBe('Pasa a alerta: todavía le faltan kits de higiene.');
  });

  it('names the scarcest item in the rail note, changing tense after a donation', () => {
    expect(scarceNote(subaNorte(), 'today')).toBe('Hoy lo que más necesita es agua potable.');
    expect(scarceNote(donatedSubaNorte().centro, 'now')).toBe(
      'Ahora lo que más necesita son kits de higiene.',
    );
  });

  it('writes the donated amount without repeating the unit inside the name', () => {
    const agua = subaNorte().items[0];
    const kits = subaNorte().items[1];
    expect(donationPhrase(agua, 40)).toBe('40 bidones de agua potable');
    expect(donationPhrase(kits, 40)).toBe('40 kits de higiene');
  });

  it('builds the c9 toast from the real amount and level change', () => {
    const { centro, record } = donatedSubaNorte();
    expect(donationToast(centro, record, centro.items[0])).toBe(
      'Donaste 40 bidones de agua potable. Suba Norte pasó de crítico a alerta.',
    );
  });

  it('formats the computed distance in metres under a kilometre', () => {
    expect(formatDistanceTo(0.9)).toBe('a 900 m de ti');
    expect(formatDistanceTo(2.34)).toBe('a 2,3 km de ti');
  });

  it('lists every center that needs a donation, worst first, without choosing one', () => {
    // Tibabuyes is green (Alimentos 360/400), so it still has a gap to cover.
    expect(donableCenters(MOCK_CENTROS_AYUDA).map((centro) => centro.id)).toEqual([
      'CA-SUBA-NORTE',
      'CA-LA-GAITANA',
      'CA-TIBABUYES',
    ]);
    expect(donableCenters([])).toEqual([]);

    const silent: CentroAyuda = {
      id: 'CA-S',
      nombre: 'Silent',
      ubicacion: { lat: 0, lng: 0 },
      items: [],
    };
    expect(donableCenters([silent])).toEqual([]);

    // A center whose only declared item is fully covered needs no donation.
    const stable: CentroAyuda = {
      id: 'CA-STABLE',
      nombre: 'Stable',
      ubicacion: { lat: 0, lng: 0 },
      items: [
        {
          id: 'INV-STABLE',
          centroAcopioId: 'CA-STABLE',
          nombre: 'Agua',
          disponible: 100,
          requerido: 100,
          semaforo: 'COMPLETE',
          grammaticalNumber: 'singular',
        },
      ],
    };
    expect(donableCenters([stable])).toEqual([]);
  });

  it('overlays the donated centers on the base list, preserving order', () => {
    const { centro } = donatedSubaNorte();
    const merged = withDonations(MOCK_CENTROS_AYUDA, { [centro.id]: centro });
    expect(merged.map((entry) => entry.id)).toEqual(MOCK_CENTROS_AYUDA.map((entry) => entry.id));
    expect(merged[0].items[0].disponible).toBe(52);
    expect(MOCK_CENTROS_AYUDA[0].items[0].disponible).toBe(12);
  });

  it('mutates the donation store and resets it', () => {
    useDonationStore.getState().donate(subaNorte(), 'INV-SN-1', 40);
    expect(useDonationStore.getState().updated['CA-SUBA-NORTE'].items[0].disponible).toBe(52);
    useDonationStore.getState().reset();
    expect(useDonationStore.getState().updated).toEqual({});
  });
});

describe('donation palette', () => {
  /** The `.dark` block of globals.css, where theme-flipping tokens are redefined. */
  function darkBlock(): string {
    return GLOBALS_CSS.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? '';
  }

  it('uses the mockup tokens that dark mode never redefines, so the flow is theme-fixed', () => {
    // The v2 palette the flow paints with is declared once in `:root` and is NOT
    // redefined in `.dark` (unlike `--nv-surface-2`, `--nv-critical`, ...). This
    // is the root cause of the bug: using these tokens is what makes the modal,
    // the detail card and the notice look the same in both themes.
    const dark = darkBlock();
    for (const token of [
      '--nv-navy',
      '--nv-navy-400',
      '--nv-line',
      '--nv-mint',
      '--nv-lime',
      '--nv-teal',
      '--nv-amber',
      '--nv-red',
      '--nv-red-600',
    ]) {
      expect(GLOBALS_CSS).toContain(`${token}:`);
      expect(dark).not.toContain(`${token}:`);
    }
  });
});

describe('DonationDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists every option with a gap and previews the mockup result', () => {
    render(<DonationDialog centro={subaNorte()} onConfirm={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Donar a Acopio Suba Norte' });
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual(['INV-SN-1', 'INV-SN-2', 'INV-SN-4', 'INV-SN-3']);

    expect(within(dialog).getByText('12 → 52 de 60')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Pasa a alerta: todavía le faltan kits de higiene.'),
    ).toBeInTheDocument();
    // The stepper starts at the mockup's 40 and carries the mockup's specific
    // unit, NOT the rail's plain "bidones".
    expect(within(dialog).getByText('bidones de 5 L')).toBeInTheDocument();
    expect(within(dialog).queryByText('bidones')).not.toBeInTheDocument();
  });

  it('paints the modal with the fixed palette, never the theme-flipping tokens', () => {
    render(<DonationDialog centro={subaNorte()} onConfirm={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Donar a Acopio Suba Norte' });
    expect(dialog.className).toContain('bg-white');
    expect(dialog.className).toContain('text-nv-navy');
    expect(dialog.className).not.toMatch(
      /bg-card|text-card-foreground|border-border|bg-background|text-foreground|text-muted-foreground/,
    );

    // The scrim overrides the primitive's theme-aware `bg-background`.
    const overlay = document.querySelector('.fixed.inset-0');
    expect(overlay?.className).toContain('bg-nv-navy/45');
    expect(overlay?.className).not.toContain('bg-background');
  });

  it('steps the amount and confirms the chosen item and amount', () => {
    const onConfirm = vi.fn();
    render(<DonationDialog centro={subaNorte()} onConfirm={onConfirm} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Agregar uno' }));
    expect(screen.getByText('12 → 53 de 60')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar uno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar uno' }));
    expect(screen.getByText('12 → 51 de 60')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar donación' }));
    expect(onConfirm).toHaveBeenCalledWith('INV-SN-1', 39);
  });

  it('types the amount and caps it at the gap', () => {
    const onConfirm = vi.fn();
    render(<DonationDialog centro={subaNorte()} onConfirm={onConfirm} onClose={vi.fn()} />);

    const field = screen.getByRole('textbox', { name: 'Cantidad a donar' });
    fireEvent.change(field, { target: { value: '33' } });
    expect(screen.getByText('12 → 45 de 60')).toBeInTheDocument();

    // Clearing the field never breaks the preview, and blur restores a number.
    fireEvent.change(field, { target: { value: '' } });
    expect(field).toHaveValue('');
    fireEvent.blur(field);
    expect(field).toHaveValue('1');

    // More than the gap is capped at what the center still needs.
    fireEvent.change(field, { target: { value: '500' } });
    expect(field).toHaveValue('48');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar donación' }));
    expect(onConfirm).toHaveBeenCalledWith('INV-SN-1', 48);
  });

  it('clamps the amount when switching to a scarcer maximum', () => {
    const onConfirm = vi.fn();
    render(<DonationDialog centro={subaNorte()} onConfirm={onConfirm} onClose={vi.fn()} />);

    // Kits de higiene only needs 40 - 18 = 22, so 40 clamps down to 22.
    fireEvent.click(screen.getByRole('radio', { name: /Kits de higiene/ }));
    expect(screen.getByText('18 → 40 de 40')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar donación' }));
    expect(onConfirm).toHaveBeenCalledWith('INV-SN-2', 22);
  });

  it('closes without donating from "Cancelar"', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<DonationDialog centro={subaNorte()} onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('DonationCenterPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('lists only the centers that need a donation, worst first, and waits for a choice', () => {
    const onSelect = vi.fn();
    render(
      <DonationCenterPicker
        centros={donableCenters(MOCK_CENTROS_AYUDA)}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );

    const panel = screen.getByRole('complementary', { name: 'Elegir centro de donación' });
    const rows = within(panel).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Acopio Suba Norte'),
      expect.stringContaining('Acopio La Gaitana'),
      expect.stringContaining('Acopio Tibabuyes'),
      'Cancelar',
    ]);

    fireEvent.click(within(panel).getByRole('button', { name: /Acopio La Gaitana/ }));
    expect(onSelect).toHaveBeenCalledWith('CA-LA-GAITANA');
  });

  it('never selects a center on its own and can be left without donating', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(
      <DonationCenterPicker
        centros={donableCenters(MOCK_CENTROS_AYUDA)}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );

    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows an honest empty state when no center needs a donation', () => {
    render(<DonationCenterPicker centros={[]} onSelect={vi.fn()} onCancel={vi.fn()} />);

    expect(
      screen.getByText('Ningún centro declara insumos que necesiten donación.'),
    ).toBeInTheDocument();
  });
});

describe('CenterDetailRail', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the c7 card, the inventory rows and the donation action', () => {
    render(
      <CenterDetailRail
        centro={subaNorte()}
        origin={SUBAS}
        lastDonation={null}
        onDonate={vi.fn()}
        onBackToMap={vi.fn()}
      />,
    );

    expect(screen.getByText('Acopio Suba Norte')).toBeInTheDocument();
    expect(screen.getByText(/Cl\. 145 #91-19 · a [\d,]+ km de ti/)).toBeInTheDocument();
    expect(screen.getByText('Estado del centro')).toBeInTheDocument();
    expect(screen.getByText('12 de 60 bidones')).toBeInTheDocument();
    expect(
      screen.getByText(
        'El color del centro es el de su insumo más escaso. Hoy lo que más necesita es agua potable.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donar a este centro' })).toBeEnabled();
  });

  it('shows the c9 card after a donation, with the contribution mark', () => {
    const { centro, record } = donatedSubaNorte();
    render(
      <CenterDetailRail
        centro={centro}
        origin={SUBAS}
        lastDonation={record}
        onDonate={vi.fn()}
        onBackToMap={vi.fn()}
      />,
    );

    expect(screen.getByText('Antes estaba en crítico')).toBeInTheDocument();
    expect(screen.getByText('+40')).toBeInTheDocument();
    expect(screen.getByText('52 de 60 bidones')).toBeInTheDocument();
    expect(
      screen.getByText(
        'El color del centro es el de su insumo más escaso. Ahora lo que más necesita son kits de higiene.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donar a este centro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver al mapa' })).toBeInTheDocument();
  });

  it('EP-03.F1.US5: shows the active shortage alert with the resource and the missing quantity', () => {
    const centro: CentroAyuda = {
      ...subaNorte(),
      alerta: {
        itemId: 'INV-SN-1',
        nombre: 'Agua potable',
        cantidadSolicitada: 8,
        faltante: 3,
        creadaEn: '2026-09-27T10:00:00Z',
      },
      alertasActivas: 1,
    };
    render(
      <CenterDetailRail
        centro={centro}
        origin={SUBAS}
        lastDonation={null}
        onDonate={vi.fn()}
        onBackToMap={vi.fn()}
      />,
    );

    const alert = screen.getByTestId('centro-alerta-escasez');
    // The AC: the alert names the resource AND the amount that is missing.
    expect(alert.textContent).toContain('agua potable');
    expect(within(alert).getByText('3')).toBeInTheDocument();
    expect(alert.textContent).toContain('se solicitaron 8');
    // A single alert says nothing about further ones.
    expect(alert.textContent).not.toContain('recursos en escasez');
  });

  it('EP-03.F1.US5: mentions the other active alerts only when there is more than one', () => {
    const centro: CentroAyuda = {
      ...subaNorte(),
      alerta: {
        itemId: 'INV-SN-1',
        nombre: 'Agua potable',
        cantidadSolicitada: 8,
        faltante: 3,
        creadaEn: '2026-09-27T10:00:00Z',
      },
      alertasActivas: 3,
    };
    render(
      <CenterDetailRail
        centro={centro}
        origin={SUBAS}
        lastDonation={null}
        onDonate={vi.fn()}
        onBackToMap={vi.fn()}
      />,
    );

    expect(screen.getByTestId('centro-alerta-escasez').textContent).toContain(
      'Hay 3 recursos en escasez en este centro.',
    );
  });

  it('EP-03.F1.US5: a center without an alert renders no alert block', () => {
    render(
      <CenterDetailRail
        centro={subaNorte()}
        origin={SUBAS}
        lastDonation={null}
        onDonate={vi.fn()}
        onBackToMap={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('centro-alerta-escasez')).not.toBeInTheDocument();
  });

  it('always shows a back arrow that returns to the previous panel', () => {
    const onBackToMap = vi.fn();
    render(
      <CenterDetailRail
        centro={subaNorte()}
        origin={SUBAS}
        lastDonation={null}
        onDonate={vi.fn()}
        onBackToMap={onBackToMap}
      />,
    );

    // Reachable by its accessible name in the c7 normal state.
    const back = screen.getByRole('button', { name: 'Volver al panel' });
    fireEvent.click(back);
    expect(onBackToMap).toHaveBeenCalledTimes(1);
  });

  it('keeps the back arrow after a donation, next to the existing exit', () => {
    const onBackToMap = vi.fn();
    const { centro, record } = donatedSubaNorte();
    render(
      <CenterDetailRail
        centro={centro}
        origin={SUBAS}
        lastDonation={record}
        onDonate={vi.fn()}
        onBackToMap={onBackToMap}
      />,
    );

    const back = screen.getByRole('button', { name: 'Volver al panel' });
    fireEvent.click(back);
    expect(onBackToMap).toHaveBeenCalledTimes(1);
    // The post-donation "Volver al mapa" exit is preserved.
    expect(screen.getByRole('button', { name: 'Volver al mapa' })).toBeInTheDocument();
  });
});
