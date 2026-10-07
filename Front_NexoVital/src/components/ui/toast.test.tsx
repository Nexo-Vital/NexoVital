import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_MS, notify, Toaster, toast, useToastStore } from './toast';

describe('Toaster', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it('shows a prominent notice with its title, its message and a button to close it', async () => {
    const user = userEvent.setup();
    render(<Toaster />);

    act(() => notify('Solicitud ya aceptada', 'La solicitud ya fue aceptada por otra ambulancia.'));

    const notices = screen.getByRole('list', { name: 'Avisos' });
    expect(within(notices).getByRole('heading', { name: 'Solicitud ya aceptada' })).toBeVisible();
    expect(
      within(notices).getByText('La solicitud ya fue aceptada por otra ambulancia.'),
    ).toBeVisible();

    await user.click(within(notices).getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('list', { name: 'Avisos' })).toBeNull();
  });

  it('closes a prominent notice on its own', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => notify('Solicitud ya aceptada', 'Otra ambulancia la aceptó.'));
    expect(screen.getByRole('list', { name: 'Avisos' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(NOTICE_MS);
    });
    expect(screen.queryByRole('list', { name: 'Avisos' })).toBeNull();
  });

  it('keeps routine feedback as the small card, apart from the notices', () => {
    render(<Toaster />);
    act(() => {
      toast('Guardado');
      notify('Solicitud ya aceptada', 'Otra ambulancia la aceptó.');
    });

    const small = screen.getByRole('list', { name: 'Notifications' });
    expect(within(small).getByText('Guardado')).toBeInTheDocument();
    expect(within(small).queryByText('Otra ambulancia la aceptó.')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Avisos' })).queryByText('Guardado')).toBeNull();
  });
});
