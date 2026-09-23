import { Bell, ChevronDown, HeartPulse, LogOut, type LucideIcon, Search } from 'lucide-react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toast';
import { hasRoleHome, ROLE_LABEL } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import { cn } from '@/lib/utils';
import { useRealtimeConnection } from '@/shared/realtime/use-realtime-connection';

/** One entry of the sidebar navigation. The shell renders it, the role config owns it. */
export interface AppFrameNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface AppFrameProps {
  /** Sidebar items for the signed-in role. */
  nav: AppFrameNavItem[];
  /** Key of the item to mark as the current page. */
  activeKey: string;
  /**
   * Optional suffix appended to the role label, e.g. the driver's unit id
   * ("Conductor de ambulancia · AMB-01"). The value comes from the session, so
   * no extra domain field is invented. Omitted, the topbar is unchanged.
   */
  roleDetail?: string;
  /**
   * Optional unread count for the topbar bell. Omitted, the bell renders with
   * no badge and every role keeps exactly the chrome it had before.
   */
  bellCount?: number;
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
 *     store, so wiring the CRUE or driver shells later is config, not a rewrite.
 */
export function AppFrame({ nav, activeKey, roleDetail, bellCount }: AppFrameProps) {
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const role = useSessionStore((state) => state.role);
  const logout = useSessionStore((state) => state.logout);
  // The mounted shell owns the realtime transport lifecycle; features only
  // subscribe. Dropping this would leave the citizen screen subscribed but never
  // connected.
  useRealtimeConnection();

  // Defence in depth, mirroring AppShell: never render a role without a screen.
  if (!hasRoleHome(role)) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const pendingBellCount = bellCount ?? 0;
  const showBellBadge = pendingBellCount > 0;
  const bellBadgeLabel = `${pendingBellCount} ${
    pendingBellCount === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'
  }`;

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
            return (
              <div
                key={item.key}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-nv-md px-3 py-3 text-sm',
                  active ? 'bg-nv-sky font-semibold text-nv-navy' : 'font-medium text-nv-navy-400',
                )}
              >
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
          <div className="hidden h-11 max-w-[420px] flex-1 items-center gap-2.5 rounded-nv-pill border-[1.5px] border-nv-line bg-nv-mint px-3.5 lg:flex">
            <Search className="size-[18px] shrink-0 text-nv-navy-400" aria-hidden />
            <span className="text-sm text-nv-navy-400">Buscar centro de acopio o dirección</span>
          </div>

          <div className="flex-1" />

          <span className="relative hidden shrink-0 lg:block">
            <Bell className="size-[22px] text-nv-navy" aria-hidden />
            {showBellBadge && (
              <span
                data-testid="bell-badge"
                role="status"
                aria-label={bellBadgeLabel}
                className="tabular absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-nv-red-600 px-1 font-bold text-[11px] text-white leading-none"
              >
                {pendingBellCount > 9 ? '9+' : pendingBellCount}
              </span>
            )}
          </span>
          <div className="hidden h-8 w-px shrink-0 bg-nv-line lg:block" />

          {user && (
            <>
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-nv-lime font-bold text-nv-navy text-sm">
                {initialsOf(user.nombre)}
              </div>
              <div className="hidden flex-col gap-px leading-tight sm:flex">
                <b className="font-semibold text-sm">{user.nombre}</b>
                <small className="text-nv-navy-400 text-xs">
                  {ROLE_LABEL[user.rol]}
                  {roleDetail ? ` · ${roleDetail}` : ''}
                </small>
              </div>
            </>
          )}

          <ChevronDown
            className="hidden size-[18px] shrink-0 text-nv-navy-400 lg:block"
            aria-hidden
          />
        </header>

        <main className="min-h-0 flex-1 overflow-auto bg-nv-mint p-7 px-8">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
