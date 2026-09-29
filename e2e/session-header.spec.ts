import { expect, test } from '@playwright/test';

/**
 * End-to-end proof of the signed-in identity in the shell header and of the
 * account menu's sign-out, against the REAL stack (Vite on :5173 proxying /api
 * to the backend on :8080).
 *
 * It asserts both halves of the header task: the header shows the user's real
 * login name (never a UI literal), and the account chip opens a menu whose
 * "Salir" really clears the session and returns to /login, so no mounted screen
 * survives with a stale session.
 */

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };

/** Persisted auth keys, copied from src/services/apiClient.ts. */
const TOKEN_KEY = 'nexovital.token';
const SESSION_KEY = 'nexovital.session';

test('la cabecera muestra al usuario y su menu "Salir" cierra la sesion', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#login-email', CITIZEN.email);
  await page.fill('#login-password', CITIZEN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
    timeout: 30_000,
  });

  // The header carries the signed-in user's real name, read from the login
  // response, not a hardcoded UI literal.
  await expect(page.getByText('Ciudadano Demo')).toBeVisible();

  // The account chip opens a menu that offers the sign-out.
  const account = page.getByRole('button', { name: 'Cuenta de Ciudadano Demo' });
  await account.click();
  const menu = page.getByRole('menu', { name: 'Cuenta' });
  await expect(menu).toBeVisible();

  await menu.getByRole('menuitem', { name: 'Salir' }).click();

  // Back on /login, with no citizen screen mounted and no persisted session.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Pedir ambulancia' })).toHaveCount(0);

  const stored = await page.evaluate(
    ([tokenKey, sessionKey]) => {
      return {
        token: window.localStorage.getItem(tokenKey),
        session: window.localStorage.getItem(sessionKey),
      };
    },
    [TOKEN_KEY, SESSION_KEY],
  );
  expect(stored.token).toBeNull();
  expect(stored.session).toBeNull();
});
