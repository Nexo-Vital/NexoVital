import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The v2 mockup's fixed marker palette, copied as literal hex values.
 *
 * Tests assert the app's own colour table against these constants — and against
 * `:root` in globals.css, where the `--nv-*` tokens resolve to them — instead of
 * comparing `CENTER_LEVEL_STYLE` with itself. A colour change (lime -> blue)
 * then fails a test instead of silently agreeing with the change.
 */
export const MOCKUP_PALETTE = {
  lime: '#b7f599',
  amber: '#f5c26b',
  red: '#d9534f',
  navy: '#255181',
} as const;

/** The `:root` declaration that pins a token to its mockup value. */
export function paletteDeclaration(token: keyof typeof MOCKUP_PALETTE): string {
  return `--nv-${token}: ${MOCKUP_PALETTE[token]}`;
}

/*
  Read straight off disk: Vitest runs with `css: false`, so a `?raw` CSS import
  is stubbed to an empty string instead of returning the stylesheet. The test
  suite is always launched from the package root (`npm run test`).
*/
export const GLOBALS_CSS: string = readFileSync(
  resolve(process.cwd(), 'src/styles/globals.css'),
  'utf8',
);
