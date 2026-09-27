import { Check, Eye, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { REQUEST_STATE_LABEL_ES } from '@/features/solicitudes/request-status';
import { cn } from '@/lib/utils';
import type { SolicitudAmbulancia } from '@/types/domain';

interface SolicitudSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tapped request, or null when nothing is selected. */
  solicitud: SolicitudAmbulancia | null;
  /**
   * Whether Aceptar/Rechazar can act on this request. True only when it is the
   * inbox's currently open broadcast: the existing accept/reject actions act on
   * that one, so offering them for an already-resolved row would be a lie.
   */
  canRespond: boolean;
  /** Existing inbox accept action (BID; the server decides the winner). True once handled. */
  onAccept: () => void;
  /** Existing inbox reject action. Returns whether it handled the row (false keeps the sheet). */
  onReject: () => boolean | undefined;
  /** "Visualizar": close and focus the map on the requester's location. */
  onView: () => void;
}

/**
 * One read-only key/value row of the request sheet.
 */
function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-nv-line border-b py-2.5 last:border-b-0">
      <span className="w-[110px] shrink-0 text-nv-navy-400 text-xs">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{value}</span>
    </div>
  );
}

/**
 * U6: the bottom slide-up sheet the request tap opens. It reuses the shared
 * `sheet.tsx` (`side="bottom"`, otherwise unused in the project) and offers the
 * three actions the request describes: Aceptar, Rechazar and Visualizar.
 *
 * Aceptar/Rechazar are the EXISTING inbox actions (no logic is duplicated here);
 * they are disabled while the tapped request is not the open broadcast, with an
 * honest reason. Visualizar is always available: it closes the sheet and hands
 * the requester location to the map.
 */
export function SolicitudSheet({
  open,
  onOpenChange,
  solicitud,
  canRespond,
  onAccept,
  onReject,
  onView,
}: SolicitudSheetProps) {
  // Radix reports a programmatic close with `open=false` too. Routing it through
  // the parent's handler would null the request, and the `solicitud` guard below
  // then unmounts the content mid-close-animation, so the dialog would never
  // really hide. Reset to a closed-but-still-rendered state at zero size; the
  // parent opens it again with its own onOpenChange path.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(next);
    } else if (open) {
      onOpenChange(!open);
    }
  };

  // Reject closes the sheet ONLY when the row was actionable. A row that is not
  // the open broadcast leaves the sheet open so the honest disabled reason stays
  // visible; the inbox action itself already refused to act.
  const handleReject = () => {
    const handled = onReject();
    if (handled !== false) {
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open && solicitud !== null} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="rounded-t-nv-lg">
        {/* Guarded render instead of an early return: Radix must keep the content
            mounted through the close animation; an early return would tear it out. */}
        {solicitud && (
          <>
            <SheetHeader>
              <SheetTitle>Solicitud {solicitud.id}</SheetTitle>
              <SheetDescription>
                {REQUEST_STATE_LABEL_ES[solicitud.estado]}
                {solicitud.zonaId ? ` · ${solicitud.zonaId}` : ''}
              </SheetDescription>
            </SheetHeader>

            <div>
              <SheetRow label="Emergencia" value={solicitud.emergenciaId} />
              <SheetRow label="Tipo" value={solicitud.tipo || 'Sin clasificar'} />
              <SheetRow label="Ubicación" value={solicitud.zonaId || 'Sin zona declarada'} />
              <SheetRow label="Unidades avisadas" value={String(solicitud.notifiedCount)} />
            </div>

            {!canRespond && (
              <p className="rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
                Esta solicitud ya no está abierta en tu panel: solo puedes aceptar o rechazar la
                solicitud vigente que tienes arriba.
              </p>
            )}

            <SheetFooter>
              <button
                type="button"
                onClick={onAccept}
                disabled={!canRespond}
                className={cn(
                  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <Check className="size-5" aria-hidden />
                Aceptar
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={!canRespond}
                className={cn(
                  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <X className="size-5" aria-hidden />
                Rechazar
              </button>
              <button
                type="button"
                onClick={onView}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
              >
                <Eye className="size-5" aria-hidden />
                Visualizar
              </button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
