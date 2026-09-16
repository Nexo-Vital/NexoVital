import { useEffect } from 'react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

export type ToastTone = 'ok' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'ok') =>
    set((state) => ({ toasts: [...state.toasts, { id: nextToastId++, message, tone }] })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
}));

/** Imperative helper so non-React callbacks can raise feedback. */
export function toast(message: string, tone: ToastTone = 'ok'): void {
  useToastStore.getState().push(message, tone);
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
  return (
    <ul
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[1400] flex w-[min(92vw,22rem)] -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </ul>
  );
}
