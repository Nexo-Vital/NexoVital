import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { FleetManagerDialog } from './FleetManagerDialog';

const MAP_CENTER = { lat: 4.6, lng: -74.1 };

function renderDialog(overrides: Partial<Parameters<typeof FleetManagerDialog>[0]> = {}) {
  const onCreate = vi.fn();
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  render(
    <FleetManagerDialog
      open
      onOpenChange={() => undefined}
      units={MOCK_AMBULANCIAS}
      mapCenter={MAP_CENTER}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { onCreate, onUpdate, onDelete };
}

describe('FleetManagerDialog', () => {
  afterEach(cleanup);

  it('creates a unit with an auto id and the typed coordinates', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog();

    await user.click(screen.getByRole('button', { name: /new unit/i }));
    await user.type(screen.getByLabelText('Driver name'), 'Nina Torres');
    await user.type(screen.getByLabelText('Latitude'), '4.65');
    await user.type(screen.getByLabelText('Longitude'), '-74.06');
    await user.click(screen.getByRole('button', { name: /create unit/i }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      id: 'A-16',
      driverName: 'Nina Torres',
      estado: 'AVAILABLE',
      ubicacion: { lat: 4.65, lng: -74.06 },
    });
  });

  it('shows inline validation errors and does not create', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderDialog();

    await user.click(screen.getByRole('button', { name: /new unit/i }));
    await user.click(screen.getByRole('button', { name: /create unit/i }));

    expect(screen.getByText('Driver name is required.')).toBeInTheDocument();
    expect(screen.getByText('Latitude must be a number between -90 and 90.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('edits only driver name and state', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit A-07' }));
    const driver = screen.getByLabelText('Driver name');
    await user.clear(driver);
    await user.type(driver, 'Renamed Driver');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onUpdate).toHaveBeenCalledWith('A-07', {
      driverName: 'Renamed Driver',
      estado: 'AVAILABLE',
    });
  });

  it('deletes a unit after an explicit confirmation', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete A-07' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onDelete).toHaveBeenCalledWith('A-07');
  });

  it('shows the empty state when the fleet has no units', () => {
    renderDialog({ units: [] });

    expect(screen.getByText('No units available.')).toBeInTheDocument();
  });
});
