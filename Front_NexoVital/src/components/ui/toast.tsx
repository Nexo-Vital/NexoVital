import { TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

/**
 * `ok` and `error` are the small cards at the bottom of the screen. `notice` is
 * the prominent one: a centered card with a title, for the few events the user
 * must not miss (see `notify`).
 */
export type ToastTone = 'ok' | 'error' | 'notice';

/** How long a prominent notice stays before closing itself, in ms. */
export const NOTICE_MS = 4000;

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  /** Heading of a prominent notice; unused by the small cards. */
  title?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, tone?: ToastTone, title?: string) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'ok', title) =>
    set((state) => ({
      toasts: [...state.toasts, { id: nextToastId++, message, tone, ...(title ? { title } : {}) }],
    })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

/** Imperative helper so non-React callbacks can raise feedback. */
export function toast(message: string, tone: ToastTone = 'ok'): void {
  useToastStore.getState().push(message, tone);
}

/**
 * Raises a prominent notice: a centered card with a title, the message and a
 * button to close it. It closes itself after `NOTICE_MS`. Use it sparingly, for
 * an event that changes what the user was about to do; routine feedback stays
 * on `toast`.
 */
export function notify(title: string, message: string): void {
  useToastStore.getState().push(message, 'notice', title);
}

/**
 * Prominent notice, in the family of the citizen's acceptance popup but one
 * size down: it has to be noticed without covering the console.
 *
 * It is a notice, not a dialog: the scrim does not take pointer events, so the
 * page behind stays usable, and nothing is focused or trapped. The button is a
 * shortcut; the card closes on its own.
 */
function NoticeCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    const id = window.setTimeout(() => dismiss(item.id), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [dismiss, item.id]);

  return (
    <li className="pointer-events-auto flex w-[min(92vw,380px)] flex-col items-center gap-3 rounded-[20px] bg-white p-6 text-center text-nv-navy shadow-nv-float">
      <span className="flex size-12 items-center justify-center rounded-full bg-nv-amber text-nv-navy">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      {item.title && <h3 className="font-semibold text-xl tracking-tight">{item.title}</h3>}
      <p className="text-nv-navy-400 text-sm leading-6">{item.message}</p>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="inline-flex h-11 w-full items-center justify-center rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white"
      >
        Entendido
      </button>
    </li>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    const id = window.setTimeout(() => dismiss(item.id), 3200);
    return () => window.clearTimeout(id);
  }, [dismiss, item.id]);

  return (
    <li
      className={cn(
        'pointer-events-auto rounded-md border bg-card px-3 py-2 text-xs shadow-lg',
        item.tone === 'ok' ? 'border-ok/50' : 'border-critical/50 text-critical',
      )}
    >
      {item.message}
    </li>
  );
}

/** Fixed, screen-reader-announced feedback stack mounted once in the shell. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) {
    return null;
  }
  const notices = toasts.filter((item) => item.tone === 'notice');
  const small = toasts.filter((item) => item.tone !== 'notice');
  return (
    <>
      {notices.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-[1400] flex items-center justify-center bg-nv-navy/30 p-4">
          <ul aria-live="polite" aria-label="Avisos" className="flex flex-col items-center gap-3">
            {notices.map((item) => (
              <NoticeCard key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
      {small.length > 0 && (
        <ul
          aria-live="polite"
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-4 left-1/2 z-[1400] flex w-[min(92vw,22rem)] -translate-x-1/2 flex-col gap-2"
        >
          {small.map((item) => (
            <ToastCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}
