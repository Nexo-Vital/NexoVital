import { Ambulance, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { AMBULANCE_STATE_META } from '@/features/flota/ambulance-status';
import { cn } from '@/lib/utils';
import type { Ambulancia } from '@/types/domain';

interface PanelFlotaProps {
  ambulancias: Ambulancia[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  /** Opens the fleet manager (create/edit/delete). Hidden when omitted. */
  onManage?: () => void;
}

function FleetSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-1">
      {Array.from({ length: 6 }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

/** Left rail: fleet list. Selecting a unit selects it and centers the map. */
export function PanelFlota({
  ambulancias,
  selectedId = null,
  onSelect,
  loading = false,
  onManage,
}: PanelFlotaProps) {
  const availableCount = ambulancias.filter((item) => item.estado === 'AVAILABLE').length;

  return (
    <section
      className="flex h-full min-h-0 flex-col border-r border-border bg-card"
      aria-label="Fleet"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Ambulance className="size-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Fleet</h2>
        </div>
        <div className="flex items-center gap-1">
          {!loading && (
            <span className="tabular text-[11px] text-muted-foreground">
              {availableCount}/{ambulancias.length} available
            </span>
          )}
          {onManage && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Manage fleet"
              title="Manage fleet"
              onClick={onManage}
              className="size-7"
            >
              <Settings2 className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {loading ? (
            <FleetSkeleton />
          ) : ambulancias.length === 0 ? (
            <p className="px-2 py-8 text-center text-muted-foreground text-xs">
              No units available.
            </p>
          ) : (
            ambulancias.map((ambulance) => {
              const meta = AMBULANCE_STATE_META[ambulance.estado];
              const selected = ambulance.id === selectedId;
              return (
                <Button
                  key={ambulance.id}
                  type="button"
                  variant="ghost"
                  aria-pressed={selected}
                  onClick={() => onSelect(ambulance.id)}
                  className={cn(
                    'h-auto w-full justify-start gap-2.5 px-2 py-2 text-left',
                    selected && 'bg-accent',
                  )}
                >
                  <span
                    className={cn('size-2.5 shrink-0 rounded-full', meta.dotClass)}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col items-start">
                    <span className="tabular font-medium text-xs">{ambulance.id}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {ambulance.driverName}
                    </span>
                  </span>
                  <span className={cn('ml-auto text-[10px] uppercase', meta.textClass)}>
                    {meta.label}
                  </span>
                </Button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
