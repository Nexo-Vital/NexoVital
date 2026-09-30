import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type ThemePreference, useThemeStore } from './theme-store';

/** Cycle order for the theme toggle button. */
const THEME_ORDER: ThemePreference[] = ['light', 'dark', 'system'];

/** Copy for the toggle, so the shell (English) and the login page (Spanish) can differ. */
export interface ThemeToggleLabels {
  /** Accessible name describing the current and the next theme. */
  aria: (theme: ThemePreference, nextTheme: ThemePreference) => string;
  /** Tooltip body. */
  tooltip: (theme: ThemePreference, nextTheme: ThemePreference) => string;
}

const DEFAULT_LABELS: ThemeToggleLabels = {
  aria: (theme, nextTheme) => `Theme: ${theme}. Switch to ${nextTheme}.`,
  tooltip: (theme, nextTheme) => `${theme} theme — switch to ${nextTheme}`,
};

/** Cycles light -> dark -> system; the icon reflects the resolved theme. */
export function ThemeToggle({ labels = DEFAULT_LABELS }: { labels?: ThemeToggleLabels }) {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const isDark = resolvedTheme === 'dark';
  const Icon = isDark ? Moon : Sun;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={labels.aria(theme, nextTheme)}
          aria-pressed={isDark}
          onClick={() => setTheme(nextTheme)}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{labels.tooltip(theme, nextTheme)}</TooltipContent>
    </Tooltip>
  );
}
