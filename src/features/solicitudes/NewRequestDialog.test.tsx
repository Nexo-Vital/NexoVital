import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_AMBULANCIAS, MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import { NewRequestDialog } from './NewRequestDialog';

function renderDialog(overrides: Partial<Parameters<typeof NewRequestDialog>[0]> = {}) {
  const onCreate = vi.fn();
  render(
    <NewRequestDialog
      open
      onOpenChange={() => undefined}
      emergencies={MOCK_EMERGENCIAS}
      fleet={MOCK_AMBULANCIAS}
      onCreate={onCreate}
      {...overrides}
    />,
  );
  return { onCreate };
}

describe('NewRequestDialog', () => {
  afterEach(cleanup);

  it('defaults to broadcast and previews the notified count', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog();

    await user.selectOptions(screen.getByLabelText('Emergency'), 'EMG-001');

    expect(screen.getByRole('status')).toHaveTextContent(
      '5 units will be notified. The first to accept wins.',
    );

    await user.click(screen.getByRole('button', { name: /create request/i }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      type: 'solicitud.broadcast',
      mode: 'broadcast',
      emergenciaId: 'EMG-001',
      notifiedCount: 5,
    });
  });

  it('direct mode addresses exactly one unit', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog();

    await user.selectOptions(screen.getByLabelText('Emergency'), 'EMG-001');
    await user.click(screen.getByRole('radio', { name: /direct/i }));
    await user.selectOptions(screen.getByLabelText('Unit'), 'AMB-03');

    expect(screen.getByRole('status')).toHaveTextContent('Only AMB-03 will be notified.');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      type: 'solicitud.direct',
      mode: 'direct',
      targetAmbulanceId: 'AMB-03',
      notificadas: ['AMB-03'],
      notifiedCount: 1,
    });
  });

  it('shows the emergency empty state and disables submit', () => {
    renderDialog({ emergencies: [] });

    expect(
      screen.getByText('No active emergencies yet — report one to start.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create request/i })).toBeDisabled();
  });

  it('disables submit when there are no available units', () => {
    renderDialog({ fleet: MOCK_AMBULANCIAS.map((unit) => ({ ...unit, estado: 'MAINTENANCE' })) });

    expect(screen.getByRole('button', { name: /create request/i })).toBeDisabled();
  });
});
