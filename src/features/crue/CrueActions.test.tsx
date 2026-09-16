import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_AMBULANCIAS, MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import { CrueActions } from './CrueActions';

const BASE_PROPS = {
  emergencies: MOCK_EMERGENCIAS,
  fleet: MOCK_AMBULANCIAS,
  mapCenter: { lat: 4.6, lng: -74.1 },
  onCreateEmergency: vi.fn(),
  onCreateRequest: vi.fn(),
};

describe('CrueActions role gate', () => {
  afterEach(cleanup);

  it('disables both controls and explains why for a driver', () => {
    render(<CrueActions {...BASE_PROPS} userRole="CONDUCTOR" />);

    expect(screen.getByRole('button', { name: /report emergency/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /new request/i })).toBeDisabled();
    expect(
      screen.getByText('Only platform or aid-center admins can report emergencies.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Only aid-center or platform admins can create requests.'),
    ).toBeInTheDocument();
  });

  it('enables both controls for the aid-center admin', () => {
    render(<CrueActions {...BASE_PROPS} userRole="ADMIN_CENTRO_AYUDA" />);

    expect(screen.getByRole('button', { name: /report emergency/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /new request/i })).toBeEnabled();
  });
});
