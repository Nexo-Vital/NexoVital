import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nvButton } from '@/components/ui/button';
import { unitPlateLabel } from '@/lib/unit-label';
import type { Ambulancia } from '@/types/domain';

/**
 * How long the citizen acceptance popup stays before closing itself, in ms.
 * The "Cerrar" button is a shortcut, not a requirement, so this single constant
 * is the popup's real lifetime.
 */
export const ACCEPTANCE_POPUP_MS = 4000;

interface AcceptancePopupProps {
  /** Real id of the unit that accepted, as the arbiter reported it. */
  ambulanceId: string;
  /** That unit as the fleet knows it, for its plate and driver; null if unknown. */
  unit?: Ambulancia | null;
  /** Closes the popup early; the request itself is untouched. */
  onClose: () => void;
}

/** Plate, and driver when known: "La ambulancia con placa … y conductor … aceptó". */
export function acceptanceMessage(ambulanceId: string, unit: Ambulancia | null): string {
  const plate = unit ? unitPlateLabel(unit) : ambulanceId;
  const driver = unit?.driverName?.trim();
  return driver
    ? `La ambulancia con placa ${plate} y conductor ${driver} aceptó tu solicitud.`
    : `La ambulancia con placa ${plate} aceptó tu solicitud.`;
}

/**
 * Non-modal acceptance notice (ACE-2).
 *
 * It is a NOTICE, not a dialog: the scrim is `pointer-events-none`, so the page
 * behind it stays usable, and nothing is autofocused or focus-trapped. The card
 * is a `role="status"` live region, so the message reaches screen readers even
 * though it disappears on its own; the c4 rail that replaces the search is the
 * permanent second channel.
 *
 * The live region is mounted EMPTY and its message is filled on the next render
 * (C1): a live region inserted already populated is announced unreliably, so the
 * announcement is the CHANGE of an already-present region's text. The icon, the
 * heading and the "Cerrar" button are static and paint on the first commit.
 */
export function AcceptancePopup({ ambulanceId, unit = null, onClose }: AcceptancePopupProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, ACCEPTANCE_POPUP_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  // Filled after mount, so the message is a text change inside a region that
  // already exists, never the insertion of pre-populated content.
  const [announcement, setAnnouncement] = useState('');
  const message = acceptanceMessage(ambulanceId, unit);
  useEffect(() => {
    setAnnouncement(message);
  }, [message]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[1200] flex items-center justify-center bg-nv-navy/45 p-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-[min(92vw,480px)] flex-col items-center gap-4 rounded-[20px] bg-white p-8 text-center shadow-nv-float"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-nv-lime text-nv-navy">
          <Check className="size-8" aria-hidden />
        </span>
        <h3 className="font-semibold text-2xl tracking-tight">Una ambulancia aceptó</h3>
        <p className="text-nv-navy-400 text-[15px] leading-6">{announcement}</p>
        <button type="button" onClick={onClose} className={nvButton()}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
