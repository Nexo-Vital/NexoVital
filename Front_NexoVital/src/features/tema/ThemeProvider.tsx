import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useLayersStore } from '@/features/mapa/layers-store';
import { useThemeStore } from './theme-store';

/**
 * Applies the resolved theme on mount and whenever the preference changes, and
 * follows OS changes while the preference is `system`. The initial application
 * also happens in the index.html inline script to avoid a first-paint flash.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    const sync = () => {
      const resolved = useThemeStore.getState().applyTheme();
      useLayersStore.getState().syncBaseLayerToTheme(resolved);
    };

    sync();

    if (theme !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => sync();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  return <>{children}</>;
}
