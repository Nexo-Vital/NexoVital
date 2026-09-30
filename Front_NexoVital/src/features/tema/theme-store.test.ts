import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, resolveTheme, THEME_STORAGE_KEY, useThemeStore } from './theme-store';

interface MatchMediaController {
  setPrefersDark: (value: boolean) => void;
}

/** Stub window.matchMedia with a controllable dark-mode signal. */
function mockMatchMedia(prefersDark: boolean): MatchMediaController {
  const listeners = new Set<() => void>();
  const media = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media as unknown as MediaQueryList),
  );
  return {
    setPrefersDark: (value) => {
      media.matches = value;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe('theme store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) {
      meta.remove();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
  });

  it('resolves system from matchMedia and applies the dark class', () => {
    mockMatchMedia(true);
    useThemeStore.setState({ theme: 'system' });

    const resolved = useThemeStore.getState().applyTheme();

    expect(resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('resolves system to light when the OS prefers light', () => {
    mockMatchMedia(false);
    useThemeStore.setState({ theme: 'system' });

    expect(useThemeStore.getState().applyTheme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('setTheme persists the preference and toggles the class', () => {
    mockMatchMedia(false);

    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('collapses any preference through the pure resolver', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('defaults a first visit to light even when the OS prefers dark', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(resolveTheme(DEFAULT_THEME, true)).toBe('light');
  });

  it('keeps the browser chrome on the background token of the applied theme', () => {
    mockMatchMedia(false);
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#e9eef4');
    document.head.append(meta);
    // jsdom does not resolve custom properties from stylesheets, so the token is
    // stubbed: the contract under test is "we read --nv-bg and mirror it", not
    // the palette value itself.
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#0c131b' }));

    useThemeStore.getState().setTheme('dark');

    expect(meta.getAttribute('content')).toBe('#0c131b');
  });
});
