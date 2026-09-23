import { Lock, Package, Siren, Truck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AMBULANCE_STATE_META } from '@/features/flota/ambulance-status';
import {
  EMERGENCY_LEVEL_META,
  EMERGENCY_STATUS_LABEL,
  REQUEST_STATE_META,
  TRAFFIC_LIGHT_META,
} from '@/features/solicitudes/request-status';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown, formatElapsed, stockRatioPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Ambulancia, CentroAyuda, Emergencia, SolicitudAmbulancia } from '@/types/domain';

type DetailTab = 'unit' | 'emergency' | 'request' | 'supplies';

interface PanelDetalleProps {
  selectedAmbulance: Ambulancia | null;
  selectedEmergency: Emergencia | null;
  selectedRequest: SolicitudAmbulancia | null;
  centrosAyuda: CentroAyuda[];
  /** Aid center picked on the map; focuses the supplies tab on its resources. */
  selectedCentro?: CentroAyuda | null;
  loading?: boolean;
}

function DetailSection({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}
      className="flex flex-col gap-3 p-3"
    >
      {children}
    </motion.div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function EmptyDetail({ children }: { children: ReactNode }) {
  return <p className="p-6 text-center text-muted-foreground text-xs">{children}</p>;
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** Right rail: contextual detail for the current selection. Read-only. */
export function PanelDetalle({
  selectedAmbulance,
  selectedEmergency,
  selectedRequest,
  centrosAyuda,
  selectedCentro = null,
  loading = false,
}: PanelDetalleProps) {
  const [tab, setTab] = useState<DetailTab>('request');
  const now = useClock();

  useEffect(() => {
    if (selectedAmbulance) {
      setTab('unit');
    } else if (selectedEmergency) {
      setTab('emergency');
    } else if (selectedRequest) {
      setTab('request');
    } else if (selectedCentro) {
      setTab('supplies');
    }
  }, [selectedAmbulance, selectedEmergency, selectedRequest, selectedCentro]);

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l border-border bg-card"
      aria-label="Detail"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="shrink-0 border-b border-border p-2">
          <TabsList className="w-full">
            <TabsTrigger value="unit">Unit</TabsTrigger>
            <TabsTrigger value="emergency">Emergency</TabsTrigger>
            <TabsTrigger value="request">Request</TabsTrigger>
            <TabsTrigger value="supplies">Supplies</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <DetailSkeleton />
          ) : (
            <>
              <TabsContent value="unit">
                <DetailSection>
                  {selectedAmbulance ? (
                    <UnitDetail ambulance={selectedAmbulance} />
                  ) : (
                    <EmptyDetail>No unit selected. Pick one from the fleet rail.</EmptyDetail>
                  )}
                </DetailSection>
              </TabsContent>

              <TabsContent value="emergency">
                <DetailSection>
                  {selectedEmergency ? (
                    <EmergencyDetail emergency={selectedEmergency} now={now} />
                  ) : (
                    <EmptyDetail>No emergency selected. Pick a marker on the map.</EmptyDetail>
                  )}
                </DetailSection>
              </TabsContent>

              <TabsContent value="request">
                <DetailSection>
                  {selectedRequest ? (
                    <RequestDetail request={selectedRequest} now={now} />
                  ) : (
                    <EmptyDetail>
                      No request selected. Pick one from the active requests strip.
                    </EmptyDetail>
                  )}
                </DetailSection>
              </TabsContent>

              <TabsContent value="supplies">
                <DetailSection>
                  {selectedCentro ? (
                    <>
                      <p className="text-[10px] text-muted-foreground uppercase">
                        Selected aid center
                      </p>
                      <AidCenterDetail center={selectedCentro} />
                    </>
                  ) : centrosAyuda.length === 0 ? (
                    <EmptyDetail>No aid centers available.</EmptyDetail>
                  ) : (
                    centrosAyuda.map((center) => (
                      <AidCenterDetail key={center.id} center={center} />
                    ))
                  )}
                </DetailSection>
              </TabsContent>
            </>
          )}
        </ScrollArea>
      </Tabs>
    </aside>
  );
}

function UnitDetail({ ambulance }: { ambulance: Ambulancia }) {
  const meta = AMBULANCE_STATE_META[ambulance.estado];
  return (
    <>
      <div className="flex items-center gap-2">
        <Truck className="size-4 text-muted-foreground" />
        <span className="tabular font-semibold text-sm">{ambulance.id}</span>
        <span className={cn('ml-auto text-[10px] uppercase', meta.textClass)}>{meta.label}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <DetailRow label="Plate" value={ambulance.placa} />
        {ambulance.modelo && <DetailRow label="Model" value={ambulance.modelo} />}
        {ambulance.tipo && <DetailRow label="Type" value={ambulance.tipo} />}
        <DetailRow label="Driver" value={ambulance.driverName} />
        <DetailRow label="Zone" value={ambulance.zona} />
        <DetailRow
          label="Position"
          value={`${ambulance.ubicacion.lat.toFixed(4)}, ${ambulance.ubicacion.lng.toFixed(4)}`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Live position stream pending (STOMP /topic/flota). Positions are mocked.
      </p>
    </>
  );
}

function EmergencyDetail({ emergency, now }: { emergency: Emergencia; now: Date }) {
  const level = EMERGENCY_LEVEL_META[emergency.nivel];
  return (
    <>
      <div className="flex items-center gap-2">
        <Siren className="size-4 text-muted-foreground" />
        <span className="tabular font-semibold text-sm">{emergency.id}</span>
        <span className={cn('ml-auto text-[10px] uppercase', level.textClass)}>{level.label}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <DetailRow label="Status" value={EMERGENCY_STATUS_LABEL[emergency.estado]} />
        <DetailRow label="Zone" value={emergency.zonaId} />
        <DetailRow label="Elapsed" value={formatElapsed(emergency.createdAt, now)} />
        <DetailRow
          label="Position"
          value={`${emergency.ubicacion.lat.toFixed(4)}, ${emergency.ubicacion.lng.toFixed(4)}`}
        />
      </div>
      {emergency.descripcion && (
        <p className="rounded-md border border-border bg-surface-2 p-2 text-[11px] text-muted-foreground">
          {emergency.descripcion}
        </p>
      )}
    </>
  );
}

/**
 * Request detail. It deliberately exposes only the broadcast facts: how many
 * units were notified, the pending temporal lock, and the winning unit once
 * resolved. There is no control to choose or assign the winner (rule C2).
 */
function RequestDetail({ request, now }: { request: SolicitudAmbulancia; now: Date }) {
  const meta = REQUEST_STATE_META[request.estado];
  const reducedMotion = useReducedMotion();
  const isPending = request.estado === 'PENDING';
  const resolved = request.estado === 'TAKEN';
  const totalMs = Math.max(
    1,
    new Date(request.timeoutEn).getTime() - new Date(request.solicitadaEn).getTime(),
  );
  const remainingMs = Math.max(0, new Date(request.timeoutEn).getTime() - now.getTime());
  const remainingPct = Math.round((remainingMs / totalMs) * 100);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', meta.dotClass)} aria-hidden />
        <span className="tabular font-semibold text-sm">[{request.id}]</span>
        <span className={cn('ml-auto text-[10px] uppercase', meta.textClass)}>{meta.label}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <DetailRow label="Type" value={request.tipo} />
        <DetailRow label="Zone" value={request.zonaId} />
        <DetailRow label="Emergency" value={request.emergenciaId} />
        <DetailRow label="Elapsed" value={formatElapsed(request.solicitadaEn, now)} />
        <DetailRow label="Units notified" value={request.notifiedCount} />
      </div>

      {isPending && (
        <div className="flex flex-col gap-2 rounded-md border border-event/40 bg-event/10 p-2">
          <div className="flex items-center gap-2 text-event text-xs">
            <Lock className="size-3.5" />
            <span className="font-semibold">Awaiting first accept</span>
          </div>
          {!reducedMotion && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-event/20">
              <div
                className="h-full rounded-full bg-event transition-[width] duration-1000 ease-linear"
                style={{ width: `${remainingPct}%` }}
              />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            The center broadcast this request to {request.notifiedCount} units. The first unit to
            accept wins — the decision happens server-side. This console is read-only.
          </p>
          <span className="tabular text-[11px] text-muted-foreground">
            Lock expires in {formatCountdown(request.timeoutEn, now)}
          </span>
        </div>
      )}

      {!isPending && request.ambulanciaAsignadaId && (
        <div className="flex flex-col gap-1 rounded-md border border-ok/40 bg-ok/10 p-2">
          <span className="text-[10px] text-muted-foreground uppercase">
            {resolved ? 'Won by (server decision)' : 'Assigned unit'}
          </span>
          <span className="tabular font-semibold text-ok text-sm">
            {request.ambulanciaAsignadaId}
          </span>
          <span className="text-[11px] text-muted-foreground">
            Decision made by the center, not by this console.
          </span>
        </div>
      )}

      {!isPending && !request.ambulanciaAsignadaId && (
        <p className="rounded-md border border-border bg-surface-2 p-2 text-[11px] text-muted-foreground">
          Closed without a winning unit ({meta.label.toLowerCase()}).
        </p>
      )}

      <div>
        <p className="mb-1 text-[10px] text-muted-foreground uppercase">Notified units</p>
        <div className="flex flex-wrap gap-1">
          {request.ambulanciasNotificadas.map((unitId) => (
            <Badge key={unitId} variant="outline" className="tabular text-[10px]">
              {unitId}
            </Badge>
          ))}
        </div>
      </div>
    </>
  );
}

function AidCenterDetail({ center }: { center: CentroAyuda }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Package className="size-4 text-muted-foreground" />
        <span className="font-semibold text-xs">{center.nombre}</span>
      </div>
      <div className="flex flex-col gap-1">
        {center.items.map((item) => {
          const light = TRAFFIC_LIGHT_META[item.semaforo];
          const pct = stockRatioPercent(item.disponible, item.requerido);
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded border border-border/60 bg-surface-2 px-2 py-1"
            >
              <span className={cn('size-2 shrink-0 rounded-full', light.dotClass)} aria-hidden />
              <span className="flex-1 truncate text-[11px]">{item.nombre}</span>
              <span className="tabular text-[10px] text-muted-foreground">
                {item.disponible}/{item.requerido}
              </span>
              <span className={cn('w-10 text-right text-[10px] uppercase', light.textClass)}>
                {item.requerido <= 0 ? light.label : `${pct}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
