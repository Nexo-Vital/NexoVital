import { Check, Eye, MapPin, Navigation, Siren, Timer, VolumeX, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown } from '@/lib/format';
import {
  isSoundMuted,
  isSoundSupported,
  isSoundUnlocked,
  subscribeSoundStatus,
  unlockSound,
} from './request-sound';
import { UNIT_UNRESOLVED_REASON } from './use-solicitud-inbox';

interface RequestPopupProps {
  /** Distance and time to the pickup point, or null without a position. */
  distanceLabel: string | null;
  /** Where to go: the declared zone or the reported point. Empty when unknown. */
  locationLabel: string;
  /** Absolute deadline (epoch ms) of the accept window, or null when unknown. */
  deadlineMs: number | null;
  /** How many more requests wait behind this one. */
  queuedCount: number;
  /** An accept is in flight: the buttons wait for the server's answer. */
  submitting: boolean;
  /** False while the driver's own unit is unresolved: there is no unit to send. */
  unitResolved: boolean;
  onAccept: () => void;
  /** Closes the pop-up and takes the driver to the request card in the panel. */
  onView: () => void;
  /** Closes the pop-up. The request is NOT rejected: it stays in the panel. */
  onClose: () => void;
}

/**
 * Pop-up of a request that has just arrived (EP-04.F2.US2).
 *
 * The request card lives in the side panel, where a driver who is looking at the
 * map does not see it. This pop-up puts the same request in the middle of the
 * screen with what the driver needs to decide — how far, how long and how much
 * time is left — and lets them accept right there or open the card.
 *
 * It mirrors the OPEN offer of the inbox, which is always the request that was
 * raised first, so it never changes under the driver's hand when another one
 * arrives; the ones that wait are only counted ("+2 más").
 *
 * It is a notice, not a modal: the scrim takes no pointer events, so the map and
 * the panel stay usable, and nothing is focused on purpose — a key pressed by
 * habit must not accept a request. It does not close itself: it stays until the
 * driver answers or closes it, or until the request stops being available (the
 * console unmounts it). Closing it is not a rejection.
 */
export function RequestPopup({
  distanceLabel,
  locationLabel,
  deadlineMs,
  queuedCount,
  submitting,
  unitResolved,
  onAccept,
  onView,
  onClose,
}: RequestPopupProps) {
  const titleId = useId();
  const now = useClock(250);
  const soundBlocked = useSyncExternalStore(
    subscribeSoundStatus,
    () => isSoundSupported() && !isSoundMuted() && !isSoundUnlocked(),
    () => false,
  );
  const secondsLeft =
    deadlineMs !== null ? Math.ceil(Math.max(0, deadlineMs - now.getTime()) / 1000) : null;
  /*
    The sound hint leaves as soon as the sound is unlocked, and the first press
    anywhere on the page unlocks it. The pop-up is centred, so losing a row would
    move every button a few pixels BETWEEN the press and the release of that very
    click: the press lands on "Cerrar aviso" and the release beside it, and the
    click is lost. The space the hint took is therefore kept, so nothing moves
    under the driver's finger while the pop-up is open.
  */
  const soundHintRef = useRef<HTMLButtonElement>(null);
  const [soundHintSpace, setSoundHintSpace] = useState(0);
  useLayoutEffect(() => {
    if (soundBlocked && soundHintRef.current) {
      setSoundHintSpace(soundHintRef.current.offsetHeight);
    }
  }, [soundBlocked]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[1300] flex items-center justify-center bg-nv-navy/30 p-4">
      <section
        role="alertdialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="pointer-events-auto relative flex w-[min(92vw,400px)] flex-col gap-4 rounded-[20px] border-nv-red-600 border-t-[5px] bg-white p-6 text-nv-navy shadow-nv-float"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar aviso"
          className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-nv-navy-400 hover:bg-nv-mint"
        >
          <X className="size-5" aria-hidden />
        </button>

        <div className="flex items-center gap-3 pr-10">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-nv-red-soft text-nv-red-600">
            <Siren className="size-6" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id={titleId} className="font-semibold text-xl leading-6 tracking-tight">
              Nueva solicitud de ambulancia
            </h3>
            {deadlineMs !== null && secondsLeft !== null && (
              <span
                role="timer"
                aria-label={`${secondsLeft} segundos para responder`}
                className="tabular inline-flex w-fit items-center gap-1.5 rounded-nv-pill bg-nv-red-soft px-2.5 py-1 font-bold text-nv-red-600 text-sm"
              >
                <Timer className="size-3.5" aria-hidden />
                {formatCountdown(new Date(deadlineMs).toISOString(), now)}
              </span>
            )}
          </div>
        </div>

        <dl className="flex flex-col rounded-nv-md bg-nv-mint px-4">
          <div className="flex items-center gap-3 border-nv-line border-b py-3">
            <Navigation className="size-[18px] shrink-0 text-nv-navy-600" aria-hidden />
            <dt className="w-20 shrink-0 text-nv-navy-400 text-xs">Distancia</dt>
            <dd className="min-w-0 flex-1 truncate font-semibold text-base">
              {distanceLabel ?? 'Sin ubicación'}
            </dd>
          </div>
          <div className="flex items-center gap-3 py-3">
            <MapPin className="size-[18px] shrink-0 text-nv-navy-600" aria-hidden />
            <dt className="w-20 shrink-0 text-nv-navy-400 text-xs">Ubicación</dt>
            <dd className="min-w-0 flex-1 font-medium text-sm leading-5">
              {locationLabel || 'Sin ubicación'}
            </dd>
          </div>
        </dl>

        {queuedCount > 0 && (
          <p className="text-center text-nv-navy-400 text-xs leading-[18px]">
            {queuedCount === 1
              ? 'Hay 1 solicitud más en la lista. Esta es la que llegó primero.'
              : `Hay ${queuedCount} solicitudes más en la lista. Esta es la que llegó primero.`}
          </p>
        )}

        {soundBlocked ? (
          <button
            ref={soundHintRef}
            type="button"
            onClick={() => void unlockSound()}
            className="flex items-center gap-2 rounded-nv-md bg-nv-amber/30 px-3 py-2 text-left font-medium text-xs leading-[18px]"
          >
            <VolumeX className="size-4 shrink-0" aria-hidden />
            El navegador tiene el sonido bloqueado. Toca aquí para activarlo.
          </button>
        ) : (
          soundHintSpace > 0 && (
            <div
              aria-hidden
              data-testid="request-popup-sound-space"
              className="shrink-0"
              style={{ height: soundHintSpace }}
            />
          )
        )}

        {!unitResolved && (
          <p className="rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
            {UNIT_UNRESOLVED_REASON}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={submitting || !unitResolved}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-5" aria-hidden />
            {submitting ? 'Enviando…' : 'Aceptar'}
          </button>
          <button
            type="button"
            onClick={onView}
            disabled={submitting}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Eye className="size-5" aria-hidden />
            Ver solicitud
          </button>
        </div>
      </section>
    </div>
  );
}
