import { ListChecks } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Skeleton } from '@/components/ui/skeleton';
import { REQUEST_STATE_META } from '@/features/solicitudes/request-status';
import { useClock } from '@/hooks/use-clock';
import { formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SolicitudAmbulancia } from '@/types/domain';

interface RegistroSolicitudesProps {
  solicitudes: SolicitudAmbulancia[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

function RegistrySkeleton() {
  return (
    <div className="flex gap-2 p-2">
      {Array.from({ length: 4 }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <Skeleton key={index} className="h-14 w-64 shrink-0" />
      ))}
    </div>
  );
}

/**
 * Bottom strip: incoming request registry (911-Operator style).
 * Read-only: it shows the published broadcast and its state, never an
 * "assign winner" action. C2 is resolved server-side by the first accept.
 */
export function RegistroSolicitudes({
  solicitudes,
  selectedId = null,
  onSelect,
  loading = false,
}: RegistroSolicitudesProps) {
  const now = useClock();
  const reducedMotion = useReducedMotion();
  const pendingCount = solicitudes.filter((item) => item.estado === 'PENDING').length;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Active requests">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <ListChecks className="size-3.5 text-muted-foreground" />
        <h2 className="font-semibold text-xs uppercase tracking-wide">Active requests</h2>
        {!loading && pendingCount > 0 && (
          <span className="tabular rounded bg-event/15 px-1.5 py-0.5 text-[10px] text-event">
            {pendingCount} pending
          </span>
        )}
      </header>

      {loading ? (
        <RegistrySkeleton />
      ) : solicitudes.length === 0 ? (
        <p className="grid flex-1 place-items-center text-muted-foreground text-xs">
          No active requests
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex min-w-max gap-2 p-2">
            {solicitudes.map((solicitud) => {
              const meta = REQUEST_STATE_META[solicitud.estado];
              const selected = solicitud.id === selectedId;
              const isPending = solicitud.estado === 'PENDING';
              return (
                <motion.button
                  key={solicitud.id}
                  type="button"
                  onClick={() => onSelect(solicitud.id)}
                  aria-pressed={selected}
                  initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className={cn(
                    'relative w-64 shrink-0 overflow-hidden rounded-md border bg-card px-3 py-2 text-left',
                    meta.borderClass,
                    selected && 'ring-1 ring-ring',
                  )}
                >
                  {isPending && !reducedMotion && (
                    <motion.span
                      className="pointer-events-none absolute inset-0 bg-event"
                      initial={{ opacity: 0.22 }}
                      animate={{ opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      aria-hidden
                    />
                  )}
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('size-2 shrink-0 rounded-full', meta.dotClass)}
                      aria-hidden
                    />
                    <span className="tabular font-semibold text-xs">[{solicitud.id}]</span>
                    <span className={cn('ml-auto text-[10px] uppercase', meta.textClass)}>
                      {meta.label}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-foreground">
                    {solicitud.tipo}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{solicitud.zonaId}</span>
                    <span className="tabular">{formatElapsed(solicitud.solicitadaEn, now)}</span>
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
