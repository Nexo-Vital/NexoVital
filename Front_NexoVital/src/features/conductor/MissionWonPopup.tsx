import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nvButton } from '@/components/ui/button';

/** How long the "request is yours" notice stays before closing itself, in ms. */
export const MISSION_WON_POPUP_MS = 4000;

interface MissionWonPopupProps {
  /** Plate of the driver's own unit. */
  unitLabel: string;
  /** Closes the notice early; the mission itself is untouched. */
  onClose: () => void;
}

/** Non-modal winner notice: clicks pass through, so "Declarar llegada" stays usable. */
export function MissionWonPopup({ unitLabel, onClose }: MissionWonPopupProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, MISSION_WON_POPUP_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  // Filled after mount so screen readers announce it as a change.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(
      `Tu solicitud fue aceptada: la ambulancia ${unitLabel} quedó asignada. Dirígete al solicitante.`,
    );
  }, [unitLabel]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[1200] flex items-center justify-center bg-nv-navy/45 p-4">
      <div
        role="status"
        aria-live="polite"
        aria-label="Solicitud ganada"
        className="pointer-events-auto flex w-[min(92vw,480px)] flex-col items-center gap-4 rounded-[20px] bg-white p-8 text-center text-nv-navy shadow-nv-float"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-nv-lime text-nv-navy">
          <Check className="size-8" aria-hidden />
        </span>
        <h3 className="font-semibold text-2xl tracking-tight">¡La solicitud es tuya!</h3>
        <p className="text-nv-navy-400 text-[15px] leading-6">{announcement}</p>
        <button type="button" onClick={onClose} className={nvButton()}>
          Entendido
        </button>
      </div>
    </div>
  );
}
