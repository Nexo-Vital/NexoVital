import { Ambulance, Info, Layers, ListChecks } from 'lucide-react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PanelFlota } from '@/features/flota/PanelFlota';
import { MapLayersControl } from '@/features/mapa/MapLayersControl';
import { PanelDetalle } from '@/features/solicitudes/PanelDetalle';
import { RegistroSolicitudes } from '@/features/solicitudes/RegistroSolicitudes';
import { cn } from '@/lib/utils';
import type { Ambulancia, CentroAyuda, Emergencia, SolicitudAmbulancia } from '@/types/domain';

type DockPanel = 'fleet' | 'detail' | 'requests' | 'layers';

const DOCK_BUTTONS: { key: DockPanel; label: string; Icon: typeof Ambulance }[] = [
  { key: 'fleet', label: 'Open fleet panel', Icon: Ambulance },
  { key: 'detail', label: 'Open detail panel', Icon: Info },
  { key: 'requests', label: 'Open request registry', Icon: ListChecks },
  { key: 'layers', label: 'Open map layers', Icon: Layers },
];

const PANEL_META: Record<DockPanel, { title: string; description: string }> = {
  fleet: { title: 'Fleet panel', description: 'Ambulance fleet list.' },
  detail: { title: 'Detail panel', description: 'Context for the current selection.' },
  requests: { title: 'Request registry', description: 'Incoming ambulance requests.' },
  layers: {
    title: 'Map layers',
    description: 'Basemap, overlays and emergency level filters.',
  },
};

interface SalaOperacionesDockProps {
  ambulancias: Ambulancia[];
  selectedAmbulanceId: string | null;
  onSelectAmbulance: (id: string) => void;
  onManageFleet?: () => void;
  fleetLoading: boolean;
  selectedAmbulance: Ambulancia | null;
  selectedEmergency: Emergencia | null;
  selectedRequest: SolicitudAmbulancia | null;
  centrosAyuda: CentroAyuda[];
  detailLoading: boolean;
  solicitudes: SolicitudAmbulancia[];
  selectedRequestId: string | null;
  onSelectRequest: (id: string) => void;
  showRegistry: boolean;
}

/**
 * Mobile-only bottom dock (hidden from `lg` up). Each button opens a bottom
 * sheet with one of the desktop rails. The sheets are siblings of the map, so
 * opening a panel never unmounts the map or drops its Leaflet state. The
 * show/hide switch is pure CSS (`lg:hidden`); only the sheet open state is JS.
 */
export function SalaOperacionesDock({
  ambulancias,
  selectedAmbulanceId,
  onSelectAmbulance,
  onManageFleet,
  fleetLoading,
  selectedAmbulance,
  selectedEmergency,
  selectedRequest,
  centrosAyuda,
  detailLoading,
  solicitudes,
  selectedRequestId,
  onSelectRequest,
  showRegistry,
}: SalaOperacionesDockProps) {
  const [panel, setPanel] = useState<DockPanel | null>(null);

  const buttons = showRegistry
    ? DOCK_BUTTONS
    : DOCK_BUTTONS.filter((button) => button.key !== 'requests');
  const meta = panel ? PANEL_META[panel] : null;

  return (
    <>
      <nav
        aria-label="Panel shortcuts"
        className="flex shrink-0 items-stretch gap-1 border-t border-border bg-card p-1.5 lg:hidden"
      >
        {buttons.map(({ key, label, Icon }) => {
          const active = panel === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              title={label}
              aria-haspopup="dialog"
              aria-expanded={active}
              onClick={() => setPanel(active ? null : key)}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center rounded-md py-2 transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden />
            </button>
          );
        })}
      </nav>

      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <SheetContent side="bottom" className="h-[80dvh] max-h-[80dvh] gap-0 overflow-hidden p-0">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3 pr-12">
            <SheetTitle>{meta?.title ?? ''}</SheetTitle>
            <SheetDescription className="sr-only">{meta?.description ?? ''}</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            {panel === 'fleet' && (
              <PanelFlota
                ambulancias={ambulancias}
                selectedId={selectedAmbulanceId}
                onSelect={onSelectAmbulance}
                loading={fleetLoading}
                onManage={onManageFleet}
              />
            )}

            {panel === 'detail' && (
              <PanelDetalle
                selectedAmbulance={selectedAmbulance}
                selectedEmergency={selectedEmergency}
                selectedRequest={selectedRequest}
                centrosAyuda={centrosAyuda}
                loading={detailLoading}
              />
            )}

            {panel === 'requests' && showRegistry && (
              <RegistroSolicitudes
                solicitudes={solicitudes}
                selectedId={selectedRequestId}
                onSelect={onSelectRequest}
              />
            )}

            {panel === 'layers' && (
              <div className="h-full overflow-y-auto p-3">
                <MapLayersControl className="static w-full" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
