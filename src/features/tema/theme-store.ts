import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'nexovital.theme';
export const DEFAULT_THEME: ThemePreference = 'system';

/** True when the OS asks for dark. Safe on the server and in jsdom. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Collapse an explicit preference + OS signal into a concrete theme. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return preference;
}

/** Toggle the `.dark` class that drives every semantic token and Tailwind. */
export function applyThemeClass(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Read the persisted preference. Plain string, trivially readable in index.html. */
export function readStoredTheme(): ThemePreference | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme: ThemePreference): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); in-memory state still works.
  }
}

export interface ThemeState {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => ResolvedTheme;
  /** Recompute from the OS preference and apply the class. Returns the result. */
  applyTheme: () => ResolvedTheme;
}

const initialPreference = readStoredTheme() ?? DEFAULT_THEME;

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialPreference,
  resolvedTheme: resolveTheme(initialPreference, systemPrefersDark()),
  setTheme: (theme) => {
    writeStoredTheme(theme);
    const resolved = resolveTheme(theme, systemPrefersDark());
    applyThemeClass(resolved);
    set({ theme, resolvedTheme: resolved });
    return resolved;
  },
  applyTheme: () => {
    const resolved = resolveTheme(get().theme, systemPrefersDark());
    applyThemeClass(resolved);
    set({ resolvedTheme: resolved });
    return resolved;
  },
}));
