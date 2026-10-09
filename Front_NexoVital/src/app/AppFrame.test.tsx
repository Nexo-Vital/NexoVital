import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ambulance, HandHeart, Map as MapIcon } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';
import { AppFrame, type AppFrameNavItem, type AppFrameNotification } from './AppFrame';
import { SidebarSlot } from './sidebar-slot';

// The shell owns the realtime connection; it is irrelevant to the chrome here.
vi.mock('@/shared/realtime/use-realtime-connection', () => ({
  useRealtimeConnection: () => undefined,
}));

const NAV: AppFrameNavItem[] = [
  { key: 'map', label: 'Mapa', icon: MapIcon },
  { key: 'requests', label: 'Mis solicitudes', icon: Ambulance },
  { key: 'donations', label: 'Mis donaciones', icon: HandHeart },
];

function renderFrame(role: RolUsuario = 'CIUDADANO', roleDetail?: string, bellCount?: number) {
  useSessionStore.setState({
    user: {
      id: 'usr-citizen',
      nombre: 'Ciudadano Demo',
      email: 'ciudadano@nexovital.co',
      rol: role,
    },
    role,
    token: 'jwt.test',
  });
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-screen" />} />
        <Route
          element={
            <AppFrame
              nav={NAV}
              activeKey="map"
              roleDetail={roleDetail}
              bellCount={bellCount}
              showTopbarTools
            />
          }
        >
          <Route path="/" element={<div data-testid="outlet-content" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function sidebar() {
  return screen.getByRole('complementary', { name: 'Barra lateral' });
}

const NOTIFICATION: AppFrameNotification = {
  id: 'REQ-7',
  title: 'Trauma',
  levelLabel: 'Alto',
  locationLabel: '4.6280, -74.1480',
  timeoutEn: new Date(Date.now() + 60_000).toISOString(),
};

/**
 * Renders the driver shell with the bell notifications wired. `/other` is the
 * landing route so the notification's `/` navigation is observable, and it
 * carries a sibling button the "no scrim" case can click.
 */
function renderBellFrame(
  notifications: AppFrameNotification[],
  options: { onSelect?: (id: string) => void; initialPath?: string } = {},
) {
  const { onSelect, initialPath = '/' } = options;
  useSessionStore.setState({
    user: {
      id: 'usr-driver',
      nombre: 'Conductor Demo',
      email: 'conductor@nexovital.co',
      rol: 'CONDUCTOR',
    },
    role: 'CONDUCTOR',
    token: 'jwt.test',
  });
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/login" element={<div data-testid="login-screen" />} />
        <Route
          element={
            <AppFrame
              nav={NAV}
              activeKey="map"
              bellCount={notifications.length}
              notifications={notifications}
              onNotificationSelect={onSelect}
              showTopbarTools
            />
          }
        >
          <Route path="/" element={<div data-testid="outlet-content" />} />
          <Route
            path="/other"
            element={
              <button type="button" data-testid="outside-button">
                Otra pantalla
              </button>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppFrame', () => {
  beforeEach(() => useSessionStore.setState({ user: null, role: null, token: null }));
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('renders the brand and the role navigation with the current item marked', () => {
    renderFrame();
    const bar = sidebar();

    expect(within(bar).getByText('NexoVital')).toBeInTheDocument();
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Mis solicitudes')).not.toHaveAttribute('aria-current');
    expect(within(bar).getByText('Mis donaciones')).not.toHaveAttribute('aria-current');
  });

  it('renders the routed content inside the shell', () => {
    renderFrame();
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
  });

  it('shows the avatar initials, the name and the Spanish role', () => {
    renderFrame();

    expect(screen.getByText('CD')).toBeInTheDocument();
    expect(screen.getByText('Ciudadano Demo')).toBeInTheDocument();
    expect(screen.getByText('Ciudadano')).toBeInTheDocument();
  });

  it('appends the role detail suffix when given, e.g. the driver unit', () => {
    renderFrame('CONDUCTOR', 'A-07');

    expect(screen.getByText('Conductor de ambulancia · A-07')).toBeInTheDocument();
  });

  it('renders the search as a non-interactive hint, never an input', () => {
    renderFrame();

    expect(screen.getByText('Buscar centro de acopio o dirección').tagName).toBe('SPAN');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();
  });

  it('leaves the bell badge-less unless a count is given', () => {
    renderFrame();

    expect(screen.queryByTestId('bell-badge')).not.toBeInTheDocument();
  });

  it('renders the bell badge with the pending count when given', () => {
    renderFrame('CONDUCTOR', 'A-07', 3);

    expect(screen.getByTestId('bell-badge')).toHaveTextContent('3');
    expect(screen.getByLabelText('3 solicitudes pendientes')).toBeInTheDocument();
  });

  it('caps the bell badge at 9+', () => {
    renderFrame('CONDUCTOR', 'A-07', 12);

    expect(screen.getByTestId('bell-badge')).toHaveTextContent('9+');
  });

  it('signs out and returns to login when "Cerrar sesión" is pressed', async () => {
    const user = userEvent.setup();
    renderFrame();

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().role).toBeNull();
  });

  it('never renders for a role without a screen', () => {
    renderFrame('INSPECTOR' as RolUsuario);

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet-content')).not.toBeInTheDocument();
  });

  it('opens the account menu from the header chip and names the signed-in user', async () => {
    const user = userEvent.setup();
    renderFrame();

    const account = screen.getByRole('button', { name: 'Cuenta de Ciudadano Demo' });
    expect(account).toHaveAttribute('aria-haspopup', 'menu');
    expect(account).toHaveAttribute('aria-expanded', 'false');

    await user.click(account);

    expect(account).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Cuenta' });
    expect(within(menu).getByRole('menuitem', { name: 'Salir' })).toBeInTheDocument();
  });

  it('closes the account menu on Escape and restores focus to the chip', async () => {
    const user = userEvent.setup();
    renderFrame();

    const account = screen.getByRole('button', { name: 'Cuenta de Ciudadano Demo' });
    await user.click(account);
    expect(screen.getByRole('menu', { name: 'Cuenta' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Cuenta' })).not.toBeInTheDocument();
    expect(account).toHaveFocus();
  });

  it('closes the account menu when clicking outside of it', async () => {
    const user = userEvent.setup();
    renderFrame();

    await user.click(screen.getByRole('button', { name: 'Cuenta de Ciudadano Demo' }));
    expect(screen.getByRole('menu', { name: 'Cuenta' })).toBeInTheDocument();

    await user.click(screen.getByTestId('outlet-content'));

    expect(screen.queryByRole('menu', { name: 'Cuenta' })).not.toBeInTheDocument();
  });

  it('signs out from the account menu "Salir" and returns to login with a clean session', async () => {
    const user = userEvent.setup();
    renderFrame();

    await user.click(screen.getByRole('button', { name: 'Cuenta de Ciudadano Demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Salir' }));

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().role).toBeNull();
    expect(useSessionStore.getState().token).toBeNull();
  });

  it('renders the bell as a button even without notifications and opens no panel', async () => {
    const user = userEvent.setup();
    renderFrame('CONDUCTOR', 'A-07', 2);

    const bell = screen.getByRole('button', { name: 'Notificaciones' });
    await user.click(bell);

    expect(screen.queryByRole('menu', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('opens the notification panel from the bell button and lists the offers', async () => {
    const user = userEvent.setup();
    renderBellFrame([NOTIFICATION]);

    const bell = screen.getByRole('button', { name: 'Notificaciones' });
    expect(bell).toHaveAttribute('aria-haspopup', 'menu');
    expect(bell).toHaveAttribute('aria-expanded', 'false');

    await user.click(bell);

    expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('menu', { name: 'Notificaciones' });
    expect(within(panel).getByText('Trauma')).toBeInTheDocument();
    expect(within(panel).getByText('Alto')).toBeInTheDocument();
    expect(within(panel).getByText(/4\.6280, -74\.1480/)).toBeInTheDocument();
    expect(within(panel).getByText(/Cierra en/)).toBeInTheDocument();
  });

  it('shows an explicit empty state when there are no notifications', async () => {
    const user = userEvent.setup();
    renderBellFrame([]);

    await user.click(screen.getByRole('button', { name: 'Notificaciones' }));

    const panel = screen.getByRole('menu', { name: 'Notificaciones' });
    expect(within(panel).getByText('Sin notificaciones')).toBeInTheDocument();
  });

  it('navigates to the map and signals the focus when a notification is opened', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderBellFrame([NOTIFICATION], { onSelect, initialPath: '/other' });

    await user.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await user.click(screen.getByRole('menuitem', { name: /Trauma/ }));

    expect(onSelect).toHaveBeenCalledWith('REQ-7');
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('closes the notification panel on Escape and restores focus to the bell', async () => {
    const user = userEvent.setup();
    renderBellFrame([NOTIFICATION]);

    const bell = screen.getByRole('button', { name: 'Notificaciones' });
    await user.click(bell);
    expect(screen.getByRole('menu', { name: 'Notificaciones' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Notificaciones' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it('renders no overlay and keeps a sibling control outside the panel clickable', async () => {
    const user = userEvent.setup();
    const onOutside = vi.fn();
    renderBellFrame([NOTIFICATION], { initialPath: '/other' });

    await user.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(screen.getByRole('menu', { name: 'Notificaciones' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="dialog-overlay"]').length).toBe(0);

    const outside = screen.getByTestId('outside-button');
    outside.addEventListener('click', onOutside);
    await user.click(outside);

    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });
});

describe('AppFrame: mobile drawer and sidebar slot', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens the sidebar from the menu button and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderFrame();

    const menuButton = screen.getByRole('button', { name: 'Abrir menú' });
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(within(sidebar()).getByRole('button', { name: 'Cerrar menú' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(menuButton).toHaveFocus();
  });

  it('renders page content passed to SidebarSlot inside the sidebar', () => {
    useSessionStore.setState({
      user: {
        id: 'usr-citizen',
        nombre: 'Ciudadano Demo',
        email: 'c@nexovital.co',
        rol: 'CIUDADANO',
      },
      role: 'CIUDADANO',
      token: 'jwt.test',
    });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<AppFrame nav={NAV} activeKey="map" />}>
            <Route
              path="/"
              element={
                <SidebarSlot>
                  <p>Contenido del panel</p>
                </SidebarSlot>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(within(sidebar()).getByText('Contenido del panel')).toBeInTheDocument();
  });
});
