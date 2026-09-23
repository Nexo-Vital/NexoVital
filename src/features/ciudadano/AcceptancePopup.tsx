import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * How long the citizen acceptance popup stays before closing itself, in ms.
 * The "Cerrar" button is a shortcut, not a requirement, so this single constant
 * is the popup's real lifetime.
 */
export const ACCEPTANCE_POPUP_MS = 4000;

interface AcceptancePopupProps {
  /** Real id of the unit that accepted, as the arbiter reported it. */
  ambulanceId: string;
  /** Closes the popup early; the request itself is untouched. */
  onClose: () => void;
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
export function AcceptancePopup({ ambulanceId, onClose }: AcceptancePopupProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, ACCEPTANCE_POPUP_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  // Filled after mount, so the message is a text change inside a region that
  // already exists, never the insertion of pre-populated content.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(`La unidad ${ambulanceId} aceptó tu solicitud.`);
  }, [ambulanceId]);

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
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-12 w-full items-center justify-center rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
