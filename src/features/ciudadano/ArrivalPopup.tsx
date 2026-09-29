import { Ambulance, Check, Flag, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { unitPlateLabel } from '@/features/seguimiento/tracking';
import type { Ambulancia } from '@/types/domain';

interface ArrivalPopupProps {
  /** Real id of the unit that won the request. */
  unitId: string;
  /** The assigned unit as the live fleet knows it, or null before hydration. */
  unit: Ambulancia | null;
  /** Publishes the citizen's confirmation; the relay then closes the request. */
  onConfirm: () => void;
  /**
   * Dismisses the dialog without answering. The c5 rail stays underneath and
   * offers "Cancelar solicitud", so dismissing is never a dead end.
   */
  onClose: () => void;
}

/**
 * `C.c5` arrival dialog.
 *
 * It is a REAL modal: it reuses the app's accessible dialog primitive
 * (`src/components/ui/dialog.tsx`, Radix-based), which gives initial focus, a
 * focus trap, focus restoration on close, Escape and outside-click dismissal,
 * and an inert (aria-hidden) background. It previously claimed
 * `role="dialog" aria-modal="true"` by hand with none of that, so Tab could
 * reach the page behind it — a modality lie.
 *
 * It asks the citizen to answer but is NOT a trap: "Cerrar", Escape and the
 * close affordance dismiss it without confirming, and the c5 rail underneath
 * still offers "Cancelar solicitud". A false arrival therefore never forces the
 * citizen to confirm a lie or reload the page.
 *
 * The copy and the unit row read the assigned unit's REAL driver, plate, model
 * and type — no invented colour or address.
 *
 * "No la veo" is DISABLED with its reason visible: the dispute flow is not built,
 * so a live button would lie about what the app can do. Dismissing the dialog is
 * the honest interim exit, not a dispute flow.
 */
export function ArrivalPopup({ unitId, unit, onConfirm, onClose }: ArrivalPopupProps) {
  const unitLabel = unit ? unitPlateLabel(unit) : unitId;
  const modelType = unit?.modelo && unit.tipo ? `${unit.modelo} · ${unit.tipo}` : null;

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex w-[min(92vw,480px)] max-w-[480px] flex-col items-center gap-4 rounded-[20px] p-8 text-center">
        {/* Radix links the dialog's accessible name to this title; it is
            visually hidden because the visible heading carries the copy. */}
        <DialogTitle className="sr-only">Confirmar llegada</DialogTitle>

        <span className="flex size-16 items-center justify-center rounded-full bg-nv-lime text-nv-navy">
          <Flag className="size-8" aria-hidden />
        </span>
        <h3 className="font-semibold text-2xl tracking-tight">Tu ambulancia llegó</h3>
        <DialogDescription className="text-nv-navy-400 text-[15px] leading-6">
          {unit?.driverName ? `${unit.driverName} marcó` : 'El conductor marcó'} que llegó a tu
          ubicación con la ambulancia {unitLabel}. ¿Está contigo?
        </DialogDescription>

        <div className="flex w-full items-center gap-2.5 rounded-nv-md border border-nv-line p-2.5 text-left">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nv-navy text-white">
            <Ambulance className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block truncate font-semibold text-[13.5px]">{unitLabel}</b>
            {modelType && (
              <small className="block truncate text-nv-navy-400 text-xs">{modelType}</small>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white"
        >
          <Check className="size-5" aria-hidden />
          Sí, ya llegó
        </button>
        <button
          type="button"
          disabled
          title="El flujo de disputa todavía no está construido."
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          No la veo
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
        >
          <X className="size-5" aria-hidden />
          Cerrar
        </button>
        <p className="text-nv-navy-400 text-xs">
          «No la veo» se habilitará cuando el flujo de disputa esté construido. Mientras tanto,
          puedes cerrar este aviso y cancelar tu solicitud desde el panel.
        </p>
      </DialogContent>
    </Dialog>
  );
}
