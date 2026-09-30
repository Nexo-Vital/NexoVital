import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

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
