import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// Node 22+/25 ship their own Web Storage. Without `--localstorage-file` that
// global is broken (undefined or it throws ERR_INVALID_ARG_VALUE) and it hides
// the one jsdom provides, so every suite died on `localStorage.clear()`. When
// the global is not a working Storage we install an in-memory one, which is
// all the tests need (they never touch the disk).
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

function storageFunciona(nombre: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const almacen = (globalThis as Record<string, unknown>)[nombre] as Storage | undefined;
    if (typeof almacen?.clear !== 'function') return false;
    almacen.clear();
    return true;
  } catch {
    return false;
  }
}

for (const nombre of ['localStorage', 'sessionStorage'] as const) {
  if (!storageFunciona(nombre)) {
    const almacen = new MemoryStorage();
    Object.defineProperty(globalThis, nombre, {
      value: almacen,
      configurable: true,
      writable: true,
    });
    if (typeof window !== 'undefined' && window !== (globalThis as unknown)) {
      Object.defineProperty(window, nombre, { value: almacen, configurable: true, writable: true });
    }
  }
}

// Setup-file hooks are registered before test-file hooks, so this runs before
// any per-suite `beforeEach`. Clearing BOTH stores keeps per-file hygiene
// working now that the session moved: the session lives in `sessionStorage`
// (per tab) while user preferences stay in `localStorage` (cross tab).
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// jsdom has no matchMedia; framer-motion's useReducedMotion and CSS media
// queries need it. Default to "no preference".
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
