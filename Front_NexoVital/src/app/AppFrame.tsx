import { Bell, ChevronDown, HeartPulse, LogOut, type LucideIcon, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toast';
import { hasRoleHome, ROLE_LABEL } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isDemoMode } from '@/services/apiClient';
import { getRealtimePort } from '@/shared/realtime';
import { ConnectionBanner } from '@/shared/realtime/ConnectionBanner';
import { useRealtimeConnection } from '@/shared/realtime/use-realtime-connection';

/** One entry of the sidebar navigation. The shell renders it, the role config owns it. */
export interface AppFrameNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /**
   * Optional route target. When present the item is a real `Link`; absent, it
   * stays INERT (rendered, never clickable), exactly as the citizen items and
   * the driver's "Mi unidad" do today.
   */
  to?: string;
}

/**
 * One notification the topbar bell lists. It is entirely presentational so the
 * shell stays generic: the caller owns the Spanish copy and the domain, the
 * shell only renders and hands the id back when a notification is opened.
 */
export interface AppFrameNotification {
  /** Stable id; the shell hands it back on select so the caller can focus it. */
  id: string;
  /** Short title, e.g. the request type. */
  title: string;
  /** Optional severity label ("Alto", "Crítico", ...). */
  levelLabel?: string;
  /** Location label, already resolved (or "Sin ubicación"). */
  locationLabel: string;
  /** Optional ISO deadline for the accept window; rendered as a live countdown. */
  timeoutEn?: string;
}

interface AppFrameProps {
  /** Sidebar items for the signed-in role. */
  nav: AppFrameNavItem[];
  /** Key of the item to mark as the current page. */
  activeKey: string;
  /**
   * Optional suffix appended to the role label, e.g. the driver's unit id
   * ("Conductor de ambulancia · A-07"). The value comes from the session, so
   * no extra domain field is invented. Omitted, the topbar is unchanged.
   */
  roleDetail?: string;
  /**
   * Optional unread count for the topbar bell. Omitted, the bell renders with
   * no badge and every role keeps exactly the chrome it had before.
   */
  bellCount?: number;
  /**
   * Optional notifications for the topbar bell. Provided, the bell becomes a
   * real control that opens a non-blocking panel; omitted, no panel is rendered
   * and the citizen shell keeps exactly the chrome it had before.
   */
  notifications?: AppFrameNotification[];
  /** Called with the id of the notification the driver opens from the panel. */
  onNotificationSelect?: (id: string) => void;
  /** Shows the search hint and the bell; hidden by default until release 1. */
  showTopbarTools?: boolean;
}

/**
 * Initials shown in the avatar: the first letter of the first two words, upper
 * cased. A single word falls back to its first letter; an empty name renders
 * nothing rather than a fake placeholder.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nv-teal focus-visible:ring-offset-2';

interface UserMenuProps {
  /** Signed-in user's real name, from the session. */
  name: string;
  /** Spanish role label plus the optional unit suffix. */
  roleLabel: string;
  /** Avatar initials derived from the name. */
  initials: string;
  /** Signs out and returns to /login. */
  onLogout: () => void;
}

/**
 * The topbar account chip: avatar + name + role, opening a menu that offers
 * "Salir".
 *
 * Accessibility (no extra dependency; the repo ships no menu primitive):
 *   - the trigger is a real button with `aria-haspopup="menu"` and
 *     `aria-expanded`, named "Cuenta de <nombre>" so the screen reader hears
 *     whose account it is even when the visible name is short;
 *   - opening moves focus to the first item, Escape closes and restores focus to
 *     the trigger, and a click outside closes the menu;
 *   - `role="menu"` / `role="menuitem"` and a visible focus ring keep it
 *     keyboard-operable.
 */
function UserMenu({ name, roleLabel, initials, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    itemRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Cuenta de ${name}`}
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center gap-3 rounded-nv-pill text-left ${FOCUS_RING}`}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-nv-lime font-bold text-nv-navy text-sm">
          {initials}
        </span>
        <span className="hidden flex-col gap-px leading-tight sm:flex">
          <b className="font-semibold text-sm">{name}</b>
          <small className="text-nv-navy-400 text-xs">{roleLabel}</small>
        </span>
        <ChevronDown
          className={cn(
            'hidden size-[18px] shrink-0 text-nv-navy-400 transition-transform lg:block',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Cuenta"
          className="absolute top-full right-0 z-50 mt-2 flex w-56 flex-col gap-1 rounded-nv-md border border-nv-line bg-white p-1.5 shadow-nv-card"
        >
          <div className="flex flex-col gap-px px-3 py-2">
            <b className="truncate font-semibold text-sm">{name}</b>
            <small className="truncate text-nv-navy-400 text-xs">{roleLabel}</small>
          </div>
          <button
            type="button"
            ref={itemRef}
            role="menuitem"
            onClick={onLogout}
            className={cn(
              'flex items-center gap-3 rounded-nv-md px-3 py-2.5 text-left font-medium text-nv-navy text-sm hover:bg-nv-mint',
              FOCUS_RING,
            )}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            Salir
          </button>
        </div>
      )}
    </div>
  );
}

interface NotificationsPanelProps {
  id: string;
  notifications: AppFrameNotification[];
  /** Opens the notification: navigates to the map and signals its focus. */
  onSelect: (id: string) => void;
}

/**
 * Non-blocking notification popover anchored under the bell.
 *
 * It renders NO scrim and never covers the page: a click outside closes it (the
 * parent owns that listener) and every control behind it stays clickable. The
 * clock that renders the accept countdown only runs while the panel is mounted,
 * so it never ticks across the rest of the shell.
 */
function NotificationsPanel({ id, notifications, onSelect }: NotificationsPanelProps) {
  const now = useClock(1000);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Move focus into the menu once it opens, the same way the account menu does.
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  return (
    <div
      id={id}
      role="menu"
      aria-label="Notificaciones"
      className="absolute top-full right-0 z-50 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-nv-md border border-nv-line bg-white p-1.5 shadow-nv-card"
    >
      {notifications.length === 0 ? (
        <p className="px-3 py-2 text-nv-navy-400 text-sm">Sin notificaciones</p>
      ) : (
        notifications.map((notification, index) => (
          <button
            key={notification.id}
            type="button"
            ref={index === 0 ? firstItemRef : undefined}
            role="menuitem"
            onClick={() => onSelect(notification.id)}
            className={cn(
              'flex flex-col gap-1 rounded-nv-md px-3 py-2.5 text-left hover:bg-nv-mint',
              FOCUS_RING,
            )}
          >
            <span className="flex items-center gap-2">
              {notification.levelLabel && (
                <span className="shrink-0 rounded-nv-pill border border-nv-line px-2 py-0.5 font-semibold text-nv-navy-400 text-xs">
                  {notification.levelLabel}
                </span>
              )}
              <b className="truncate font-semibold text-sm">{notification.title}</b>
            </span>
            <small className="truncate text-nv-navy-400 text-xs">
              Ubicación: {notification.locationLabel}
            </small>
            {notification.timeoutEn && (
              <small className="text-nv-navy text-xs">
                Cierra en {formatCountdown(notification.timeoutEn, now)}
              </small>
            )}
          </button>
        ))
      )}
    </div>
  );
}

interface BellMenuProps {
  /** Unread count for the badge. */
  count: number;
  /** Notifications to list; `undefined` means "no panel" (the citizen shell). */
  notifications?: AppFrameNotification[];
  /** Called with the id of the notification the driver opens. */
  onSelect?: (id: string) => void;
}

/**
 * The topbar bell: a real button with a non-blocking notification panel.
 *
 * Accessibility (no extra dependency; the repo ships no menu primitive):
 *   - the trigger is a real button named "Notificaciones" with
 *     `aria-haspopup="menu"` and `aria-expanded`;
 *   - opening moves focus to the first notification, Escape closes and restores
 *     focus to the trigger, and a click outside closes the panel;
 *   - the panel is a plain popover: it renders no overlay, so it never blocks
 *     the page the way the retired full-screen modal did.
 *
 * A notification always points at the role home (`/`), where the callers that
 * own the map can act on the focus signal.
 */
function BellMenu({ count, notifications, onSelect }: BellMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const hasPanel = notifications !== undefined;
  const showBadge = count > 0;
  const badgeLabel = `${count} ${count === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}`;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openNotification = (id: string) => {
    setOpen(false);
    onSelect?.(id);
    // The notification targets the role home, where the map can consume the
    // focus signal. It is a no-op when the driver is already there.
    navigate('/');
  };

  return (
    <div ref={containerRef} className="relative hidden shrink-0 lg:block">
      <button
        type="button"
        ref={triggerRef}
        aria-label="Notificaciones"
        aria-haspopup={hasPanel ? 'menu' : undefined}
        aria-expanded={hasPanel ? open : undefined}
        aria-controls={hasPanel && open ? panelId : undefined}
        onClick={hasPanel ? () => setOpen((current) => !current) : undefined}
        className={cn('relative grid place-items-center rounded-nv-md p-1', FOCUS_RING)}
      >
        <Bell className="size-[22px] text-nv-navy" aria-hidden />
        {showBadge && (
          <span
            data-testid="bell-badge"
            role="status"
            aria-label={badgeLabel}
            className="tabular absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-nv-red-600 px-1 font-bold text-[11px] text-white leading-none"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {hasPanel && open && (
        <NotificationsPanel
          id={panelId}
          notifications={notifications}
          onSelect={openNotification}
        />
      )}
    </div>
  );
}

/**
 * Citizen-facing chrome from the v2 mockup: a 248px sidebar (brand, role nav,
 * account caption, sign out) next to a 76px topbar (search hint, bell, avatar,
 * name, role).
 *
 * Two deliberate properties:
 *   - The palette is FIXED to the mockup. Only `nv-*` tokens and an explicit
 *     `#fff` are used, never semantic tokens (`bg-card`, `bg-background`, ...),
 *     so dark mode does not flip this chrome.
 *   - It is parametrised by `nav` and reads the signed-in user from the session
 *     store, so adding or changing a role's navigation is config, not a rewrite.
 */
export function AppFrame({
  nav,
  activeKey,
  roleDetail,
  bellCount,
  notifications,
  onNotificationSelect,
  showTopbarTools = false,
}: AppFrameProps) {
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const role = useSessionStore((state) => state.role);
  const logout = useSessionStore((state) => state.logout);
  // The mounted shell owns the realtime transport lifecycle; features only
  // subscribe. Dropping this would leave the citizen screen subscribed but never
  // connected.
  useRealtimeConnection();

  // Defence in depth: never render a role without a screen.
  if (!hasRoleHome(role)) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const pendingBellCount = bellCount ?? 0;

  return (
    <div className="flex h-dvh overflow-hidden bg-white text-nv-navy">
      <aside
        aria-label="Barra lateral"
        className="hidden w-62 shrink-0 flex-col gap-2 border-nv-line border-r bg-white p-6 px-4 lg:flex"
      >
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <HeartPulse className="size-[26px] shrink-0 text-nv-navy" aria-hidden />
          <span className="font-bold text-lg tracking-[-0.02em]">NexoVital</span>
        </div>

        <nav aria-label="Navegación del rol" className="flex flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item.key === activeKey;
            const itemClass = cn(
              'flex items-center gap-3 rounded-nv-md px-3 py-3 text-sm',
              active ? 'bg-nv-sky font-semibold text-nv-navy' : 'font-medium text-nv-navy-400',
            );
            // An item with a target is a real link; one without stays inert
            // (rendered, never clickable), which is the pre-existing behaviour.
            if (item.to) {
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(itemClass, FOCUS_RING)}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            }
            return (
              <div key={item.key} aria-current={active ? 'page' : undefined} className={itemClass}>
                <Icon className="size-5 shrink-0" aria-hidden />
                {item.label}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto" />

        <p className="nv-label px-3 pb-1.5 text-nv-navy-400">Cuenta</p>
        <nav aria-label="Cuenta" className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-nv-md px-3 py-3 text-left font-medium text-nv-navy-400 text-sm"
          >
            <LogOut className="size-5 shrink-0" aria-hidden />
            Cerrar sesión
          </button>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-19 shrink-0 items-center gap-5 border-nv-line border-b bg-white px-8">
          {/* Below lg the sidebar (and its brand) is hidden, so the topbar keeps
              the brand and degrades to brand + avatar. */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <HeartPulse className="size-[26px] shrink-0 text-nv-navy" aria-hidden />
            <span className="font-bold text-lg tracking-[-0.02em]">NexoVital</span>
          </div>

          {/* Non-interactive by design: the mockup's `.search` is a div with a
              span, so this is a hint, never a fake input. */}
          {showTopbarTools && (
            <div className="hidden h-11 max-w-[420px] flex-1 items-center gap-2.5 rounded-nv-pill border-[1.5px] border-nv-line bg-nv-mint px-3.5 lg:flex">
              <Search className="size-[18px] shrink-0 text-nv-navy-400" aria-hidden />
              <span className="text-sm text-nv-navy-400">Buscar centro de acopio o dirección</span>
            </div>
          )}

          <div className="flex-1" />

          {showTopbarTools && (
            <>
              <BellMenu
                count={pendingBellCount}
                notifications={notifications}
                onSelect={onNotificationSelect}
              />
              <div className="hidden h-8 w-px shrink-0 bg-nv-line lg:block" />
            </>
          )}

          {user && (
            <UserMenu
              name={user.nombre}
              roleLabel={`${ROLE_LABEL[user.rol]}${roleDetail ? ` · ${roleDetail}` : ''}`}
              initials={initialsOf(user.nombre)}
              onLogout={handleLogout}
            />
          )}
        </header>

        {/* Off in demo mode: there is no backend channel to lose there. */}
        <ConnectionBanner port={isDemoMode() ? null : getRealtimePort()} />

        <main className="min-h-0 flex-1 overflow-auto bg-nv-mint p-7 px-8">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
