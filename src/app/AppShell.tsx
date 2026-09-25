import { LogOut, Radio, User } from 'lucide-react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/toast';
import { useChannelStatus } from '@/features/observabilidad/use-channel-status';
import { hasRoleHome } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import { useClock } from '@/hooks/use-clock';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRealtimeConnection } from '@/shared/realtime/use-realtime-connection';
import type { ChannelState, RolUsuario } from '@/types/domain';

interface ChannelMeta {
  label: string;
  dotClass: string;
  textClass: string;
  borderClass: string;
}

/** All three channel variants are styled; the mock only reaches CONNECTED. */
const CHANNEL_META: Record<ChannelState, ChannelMeta> = {
  CONNECTED: {
    label: 'CONNECTED',
    dotClass: 'bg-ok',
    textClass: 'text-ok',
    borderClass: 'border-ok/40',
  },
  STALE: {
    label: 'STALE',
    dotClass: 'bg-warning',
    textClass: 'text-warning',
    borderClass: 'border-warning/40',
  },
  DISCONNECTED: {
    label: 'DISCONNECTED',
    dotClass: 'bg-critical',
    textClass: 'text-critical',
    borderClass: 'border-critical/40',
  },
};

/** Short role labels so the chip never overflows on a phone. */
const ROLE_SHORT: Record<RolUsuario, string> = {
  ADMIN_PLATAFORMA: 'PLATFORM',
  ADMIN_CENTRO_AYUDA: 'CENTER',
  ADMIN_ACOPIO: 'SUPPLY',
  CONDUCTOR: 'DRIVER',
  CIUDADANO: 'CITIZEN',
};

function ChannelBadge({ state, latencyMs }: { state: ChannelState; latencyMs: number | null }) {
  const meta = CHANNEL_META[state];
  return (
    <Badge
      variant="outline"
      title={meta.label}
      aria-label={`Channel ${meta.label}`}
      className={cn('tabular gap-1.5', meta.borderClass, meta.textClass)}
    >
      <span
        className={cn('size-1.5 rounded-full', meta.dotClass, state !== 'CONNECTED' && 'nv-pulse')}
        aria-hidden
      />
      <span className="hidden font-semibold sm:inline">{meta.label}</span>
      {state === 'CONNECTED' && latencyMs !== null && (
        <span className="hidden text-muted-foreground sm:inline">{latencyMs} ms</span>
      )}
    </Badge>
  );
}

/** Compact top bar: brand, role chip, channel health, clock and sign out. */
export function AppShell() {
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const role = useSessionStore((state) => state.role);
  const logout = useSessionStore((state) => state.logout);
  const { state, latencyMs } = useChannelStatus();
  const now = useClock();
  useRealtimeConnection();

  // Defence in depth: never render the shell for a role without a screen.
  if (!hasRoleHome(role)) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border bg-card px-2 sm:gap-3 sm:px-3">
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded bg-primary text-primary-foreground">
            <Radio className="size-3.5" />
          </span>
          <span className="whitespace-nowrap font-semibold text-sm tracking-tight">Nexo Vital</span>
          <span className="hidden text-muted-foreground text-xs sm:inline">CRUE Operations</span>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <ChannelBadge state={state} latencyMs={latencyMs} />
          {user && (
            <Badge variant="outline" className="shrink-0 gap-1" title={user.rol}>
              <User className="size-3" />
              <span className="sm:hidden">{ROLE_SHORT[user.rol]}</span>
              <span className="hidden sm:inline">{user.rol}</span>
            </Badge>
          )}
          <span className="tabular whitespace-nowrap text-muted-foreground text-xs">
            {formatClock(now)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
            className="shrink-0 px-2 sm:px-3"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <Outlet />
      </main>

      <Toaster />
    </div>
  );
}
