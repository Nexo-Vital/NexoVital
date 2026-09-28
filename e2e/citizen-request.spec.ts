import type { Page, Response } from '@playwright/test';
import { type APIResponse, expect, test } from '@playwright/test';

/**
 * End-to-end reproduction of the citizen "Pedir ambulancia" flow against the
 * REAL stack (Vite on :5173 proxying /api to the backend on :8080).
 *
 * There are no mocks on purpose: every assertion below reads the real HTTP
 * status and the real response body. Both scenarios walk the same citizen
 * journey and differ only in the token that reaches the backend.
 *
 * The red string under the action buttons is rendered by `CitizenRoleActions`
 * (src/features/ciudadano/CitizenRail.tsx) from the request store's
 * `startError`, which the store fills with the backend `mensaje` when
 * `POST /api/v1/solicitudes` fails.
 */

/** Persisted auth keys, copied from src/services/apiClient.ts (TOKEN_KEY / SESSION_KEY). */
const TOKEN_KEY = 'nexovital.token';
const SESSION_KEY = 'nexovital.session';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
const ADMIN_CENTRO = { email: 'rangel@nexovital.co', password: 'rangel123' };

/** Exact backend 403 message (SecurityConfig accessDeniedHandler). */
const DENIED_MESSAGE = 'No tiene permisos para este recurso';

interface Account {
  email: string;
  password: string;
}

interface RecordedCall {
  method: string;
  url: string;
  status: number;
  readBody: () => Promise<string>;
}

/**
 * Records EVERY /api/v1/ response with its method, URL, status and a lazy body
 * reader. The suite reports this as forensic evidence instead of trusting a mock.
 */
function recordApiCalls(page: Page): RecordedCall[] {
  const calls: RecordedCall[] = [];
  page.on('response', (response: Response) => {
    if (!response.url().includes('/api/v1/')) {
      return;
    }
    calls.push({
      method: response.request().method(),
      url: response.url(),
      status: response.status(),
      readBody: async () => {
        try {
          return await response.text();
        } catch {
          return '';
        }
      },
    });
  });
  return calls;
}

/**
 * One line per recorded call. The body is only read for failed calls and for
 * POST /solicitudes, so a successful login never prints its token.
 */
async function describeCalls(calls: RecordedCall[]): Promise<string> {
  const lines: string[] = [];
  for (const call of calls) {
    let suffix = '';
    if (call.status >= 400 || call.url.includes('/solicitudes')) {
      const body = await call.readBody();
      suffix = body ? ` ${body.length > 400 ? `${body.slice(0, 400)}…` : body}` : '';
    }
    lines.push(`${call.method} ${call.url} -> ${call.status}${suffix}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no /api/v1/ calls captured)';
}

/** Signs in through the real form and waits for the citizen map's action rail. */
async function loginAsCitizen(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', CITIZEN.email);
  await page.fill('#login-password', CITIZEN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
    timeout: 20_000,
  });
  // The request is anchored to a REAL center, so the map snapshot must be in.
  await expect(page.getByRole('button', { name: /Acopio/i }).first()).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Reports a zone through the UI so the store holds a REAL emergency (the mocked
 * fixtures carry non-UUID ids the backend would reject). Without an active
 * emergency the store never reaches the network at all, so this step is what
 * makes the 403/201 observable.
 */
async function reportAffectedZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reportar zona afectada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reportar zona afectada' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Descripción')
    .fill('Reproducción E2E: zona afectada para habilitar la solicitud de ambulancia.');
  await dialog.getByRole('button', { name: 'Usar el centro del mapa' }).click();
  const [emergencyResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/emergencias') && response.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Reportar', exact: true }).click(),
  ]);
  expect(emergencyResponse.status()).toBe(201);
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** Logs in through the API to obtain a token + user for another role. */
async function fetchCredentials(
  page: Page,
  account: Account,
): Promise<{ token: string; usuario: Record<string, unknown> }> {
  const response: APIResponse = await page.request.post('http://localhost:5173/api/v1/sesiones', {
    data: account,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { token: string; usuario: Record<string, unknown> };
}

/** Clicks "Pedir ambulancia" and returns the POST /api/v1/solicitudes response. */
async function requestAmbulance(page: Page): Promise<Response> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/v1/solicitudes') && candidate.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Pedir ambulancia' }).click(),
  ]);
  return response;
}

test('Scenario A: a clean citizen login creates the request with 201 and no red error', async ({
  page,
}) => {
  const calls = recordApiCalls(page);
  await loginAsCitizen(page);
  await reportAffectedZone(page);

  const response = await requestAmbulance(page);
  const body = await response.text();
  console.log(`[A] POST /api/v1/solicitudes -> ${response.status()} ${body}`);
  console.log(`[A] observed calls:\n${await describeCalls(calls)}`);

  expect(response.status()).toBe(201);
  // The request really opened: the search rail replaced the action rail.
  await expect(page.getByText('Buscando ambulancia')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(DENIED_MESSAGE)).toHaveCount(0);
});

test('Scenario B: a token without ROLE_CIUDADANO is rejected with 403', async ({ page }) => {
  const calls = recordApiCalls(page);
  await loginAsCitizen(page);
  await reportAffectedZone(page);

  const admin = await fetchCredentials(page, ADMIN_CENTRO);
  /*
   * Drop the admin's token and session into localStorage with the exact shape
   * apiClient persists. A reload would NOT work here: RequireAuth revalidates
   * the token against GET /sesiones/actual and, because ADMIN_CENTRO_AYUDA has
   * no role home in this build, it would eject to /login before the click. The
   * real condition this reproduces is the in-memory citizen session surviving
   * while the persisted token belongs to another role — the citizen screen
   * keeps rendering, but apiFetch reads the swapped token from storage.
   */
  await page.evaluate(
    ({ tokenKey, sessionKey, token, session }) => {
      localStorage.setItem(tokenKey, token);
      localStorage.setItem(sessionKey, JSON.stringify(session));
    },
    {
      tokenKey: TOKEN_KEY,
      sessionKey: SESSION_KEY,
      token: admin.token,
      session: admin.usuario,
    },
  );

  const response = await requestAmbulance(page);
  const body = await response.text();
  console.log(`[B] POST /api/v1/solicitudes -> ${response.status()} ${body}`);
  console.log(`[B] observed calls:\n${await describeCalls(calls)}`);

  await test.info().attach('scenario-b-solicitudes-response.txt', {
    body: `status=${response.status()}\n${body}`,
    contentType: 'text/plain',
  });

  expect(response.status()).toBe(403);
  expect(body).toContain('ACCESO_DENEGADO');
  await expect(page.getByText(DENIED_MESSAGE)).toBeVisible({ timeout: 15_000 });
});
