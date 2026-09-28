import type { Page, Response } from '@playwright/test';
import { type APIResponse, expect, test } from '@playwright/test';

/**
 * End-to-end reproduction of the citizen "Pedir ambulancia" flow against the
 * REAL stack (Vite on :5173 proxying /api to the backend on :8080).
 *
 * There are no mocks on purpose: every assertion below reads the real HTTP
 * status and the real response body. Both scenarios walk the same citizen
 * journey. Scenario A keeps the clean session and reaches the backend;
 * scenario B swaps the persisted credentials for another role's under the
 * mounted citizen screen, so the app must detect the desync instead of sending.
 *
 * The red string under the action buttons is rendered by `CitizenRoleActions`
 * (src/features/ciudadano/CitizenRail.tsx) from the request store's
 * `startError`, which the store fills with either the backend `mensaje` or the
 * honest local reason when a request cannot start.
 */

/** Persisted auth keys, copied from src/services/apiClient.ts (TOKEN_KEY / SESSION_KEY). */
const TOKEN_KEY = 'nexovital.token';
const SESSION_KEY = 'nexovital.session';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
const ADMIN_CENTRO = { email: 'rangel@nexovital.co', password: 'rangel123' };

/** Exact backend 403 message (SecurityConfig accessDeniedHandler). */
const DENIED_MESSAGE = 'No tiene permisos para este recurso';

/**
 * Honest local reason for a desynced session, copied from
 * src/features/usuarios/session-sync.ts (SESSION_CHANGED_MESSAGE). It must never
 * be the backend permission text.
 */
const SESSION_CHANGED_MESSAGE =
  'Tu sesión cambió en otra pestaña o expiró. Vuelve a iniciar sesión para continuar.';

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

  // Regression: "zonas afectadas" are point reports, never painted areas. The
  // backend still serves zone geometry through /api/v1/mapa, but the citizen map
  // must draw no zone polygon (`MapCanvas` no longer renders `.nv-zone-area`).
  await expect(page.locator('path.nv-zone-area')).toHaveCount(0);

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

test('Scenario B: a foreign persisted token is never sent; the app states the session changed', async ({
  page,
}) => {
  const calls = recordApiCalls(page);
  await loginAsCitizen(page);
  await reportAffectedZone(page);

  const admin = await fetchCredentials(page, ADMIN_CENTRO);
  /*
   * Drop the admin's token and session into localStorage with the exact shape
   * apiClient persists. This is done from the SAME document, so no `storage`
   * event fires here — the real condition is the in-memory citizen session
   * surviving while the persisted token belongs to another role (another tab of
   * the same origin would do exactly this and fire the event).
   *
   * Before the fix the click travelled with the admin token and the backend
   * answered a misleading 403 ACCESO_DENEGADO. Now the screen detects the
   * desync first: it does NOT send, and states the honest session reason.
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

  await page.getByRole('button', { name: 'Pedir ambulancia' }).click();

  // The honest session message replaces the misleading permission text.
  await expect(page.getByText(SESSION_CHANGED_MESSAGE)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(DENIED_MESSAGE)).toHaveCount(0);

  // The whole point: no request was attempted with the foreign token.
  const solicitudesCall = calls.find(
    (call) => call.method === 'POST' && call.url.includes('/api/v1/solicitudes'),
  );
  expect(solicitudesCall).toBeUndefined();

  const observed = await describeCalls(calls);
  console.log(`[B] observed calls:\n${observed}`);
  await test.info().attach('scenario-b-session-desync.txt', {
    body: `message=${SESSION_CHANGED_MESSAGE}\nobserved calls:\n${observed}`,
    contentType: 'text/plain',
  });
});
