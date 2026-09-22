import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';
import { AppShell } from './AppShell';

// The shell owns the realtime connection and the channel badge; both are
// irrelevant here, so they are stubbed to keep the render isolated.
vi.mock('@/shared/realtime/use-realtime-connection', () => ({
  useRealtimeConnection: () => undefined,
}));
vi.mock('@/features/observabilidad/use-channel-status', () => ({
  useChannelStatus: () => ({ state: 'CONNECTED', latencyMs: null }),
}));

function renderShell() {
  return render(
    <TooltipProvider>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-screen" />} />
          <Route path="/" element={<AppShell />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

function signInAs(role: RolUsuario) {
  useSessionStore.setState({
    user: { id: 'usr-test', nombre: 'Test', email: 'test@nexovital.co', rol: role },
    role,
    token: 'jwt.test',
  });
}

describe('AppShell', () => {
  beforeEach(() => useSessionStore.setState({ user: null, role: null, token: null }));
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('renders the shell for a role with a screen', () => {
    signInAs('ADMIN_CENTRO_AYUDA');
    renderShell();

    expect(screen.getByText('Nexo Vital')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
  });

  it('never renders the shell for a role outside the contract', () => {
    // Every contract role now has a screen; the guarded case is an unknown role.
    signInAs('INSPECTOR' as RolUsuario);
    renderShell();

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByText('Nexo Vital')).not.toBeInTheDocument();
  });
});
