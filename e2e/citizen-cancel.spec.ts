import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * End-to-end proof of the ambulance-request CANCELLATION against the REAL stack
 * (Vite on :5173 proxying /api and /ws to the backend on :8080). No mocks: every
 * assertion reads the UI or the real HTTP status, and every cleanup goes through
 * REST.
 *
 * Covers the two honest outcomes the backend owns:
 *
 *   AC-happy: a citizen withdraws a still-PENDIENTE request
 *     (`POST /solicitudes/{id}/cancelar -> 200 CANCELADA`); the request disappears
 *     from the driver's inbox LIVE, without a reload, and the citizen is back to
 *     the initial "Pedir ambulancia" state.
 *
 *   AC-refused: once a unit accepted, the ambulance is on its way, so the backend
 *     answers 409 `SOLICITUD_NO_ASIGNABLE`. The citizen's screen must keep showing
 *     the REAL state and surface the backend reason instead of a fake cancellation.
 *
 * ORDERING. The backend never re-delivers a broadcast: it fans the PENDIENTE frame
 * out at creation time, so the driver must be signed in and subscribed BEFORE the
 * citizen asks (same ordering as `ambulance-cycle.spec.ts`).
 */

const BASE_URL = 'http://localhost:5173';
const API = `${BASE_URL}/api/v1`;

/** Persisted auth key, copied from src/services/apiClient.ts (TOKEN_KEY). */
const TOKEN_KEY = 'nexovital.token';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
/** Seeded driver of the unit ABC101 (Back_NexoVital DataSeeder). */
const DRIVER = { email: 'conductor1@nexovital.co', password: 'conductor123' };

/** Exact backend 409 message for a cancellation the current state does not allow. */
const CANCELLED_TOO_LATE_MESSAGE = 'La solicitud ya no admite esa transición.';

interface AmbulanciaDto {
  id: string;
  placa: string;
  estado: string;
  ubicacion: { lat: number; lng: number };
  zona: string;
}

/** An isolated real browser session with the project's geolocation defaults. */
function newIsolatedContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    permissions: ['geolocation'],
    geolocation: { latitude: 4.728, longitude: -74.078 },
  });
}

/** Signs in through the real form and waits for the role's landing screen. */
async function login(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', account.email);
  await page.fill('#login-password', account.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

/** Signs in as a driver and waits for the console plus its realtime socket. */
async function loginAsSpecificDriver(
  page: Page,
  account: { email: string; password: string },
): Promise<void> {
  const realtime = page.waitForEvent('websocket', {
    predicate: (socket) => socket.url().includes('/ws'),
    timeout: 20_000,
  });
  await login(page, account);
  await expect(page.getByRole('complementary', { name: 'Panel del conductor' })).toBeVisible({
    timeout: 30_000,
  });
  await realtime;
}

/** Current bearer token persisted by the app for this page's session. */
async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();
  return token as string;
}

/** Reports a zone through the UI so the request can be created. */
async function reportAffectedZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reportar zona afectada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reportar zona afectada' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Descripción')
    .fill('Cancelación E2E: zona afectada para habilitar la solicitud de ambulancia.');
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

/** Citizen login plus a real affected zone, ready to ask for an ambulance. */
async function citizenWithEmergency(page: Page): Promise<void> {
  await login(page, CITIZEN);
  await expect(page.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /Acopio/i }).first()).toBeVisible({
    timeout: 20_000,
  });
  await reportAffectedZone(page);
}

/** Clicks "Pedir ambulancia" and returns the 201 request body. */
async function requestAmbulance(page: Page): Promise<{
  id: string;
  estado: string;
  ambulanciasNotificadas: string[];
}> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/v1/solicitudes') && candidate.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Pedir ambulancia' }).click(),
  ]);
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    id: string;
    estado: string;
    ambulanciasNotificadas: string[];
  };
}

/** The `/mia` unit of a driver's token. */
async function myUnit(page: Page, token: string): Promise<string> {
  const response = await page.request.get(`${API}/flota/ambulancias/mia`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const unit = (await response.json()) as AmbulanciaDto | null;
  expect(unit?.id).toBeTruthy();
  return (unit as AmbulanciaDto).id;
}

/** Records every /api/v1/ response with its method, URL and status. */
function recordApiCalls(page: Page): Array<{ method: string; url: string; status: number }> {
  const calls: Array<{ method: string; url: string; status: number }> = [];
  page.on('response', (response: Response) => {
    if (response.url().includes('/api/v1/')) {
      calls.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    }
  });
  return calls;
}

test('AC-happy: el ciudadano cancela una solicitud pendiente y al conductor le desaparece la tarjeta', async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const driverContext = await newIsolatedContext(browser);
  const citizenContext = await newIsolatedContext(browser);
  const driverPage = await driverContext.newPage();
  const citizenPage = await citizenContext.newPage();
  const driverCalls = recordApiCalls(driverPage);
  const citizenCalls = recordApiCalls(citizenPage);

  let requestId: string | null = null;

  try {
    // 1. Driver first: subscribed BEFORE the broadcast exists.
    await loginAsSpecificDriver(driverPage, DRIVER);

    // 2. Citizen reports a zone and asks for an ambulance.
    await citizenWithEmergency(citizenPage);
    const request = await requestAmbulance(citizenPage);
    requestId = request.id;
    expect(request.estado).toBe('PENDIENTE');
    expect(request.ambulanciasNotificadas.length).toBeGreaterThan(0);
    console.log(
      `[cancel-ok] solicitud=${request.id} notificadas=${request.ambulanciasNotificadas.length}`,
    );

    // 3. The live card reaches the driver WITHOUT a reload.
    const card = driverPage.getByRole('region', { name: 'Solicitud de ambulancia' });
    await expect(card).toBeVisible({ timeout: 20_000 });

    // 4. The citizen withdraws it: the REAL REST endpoint answers 200 CANCELADA.
    const [cancelResponse] = await Promise.all([
      citizenPage.waitForResponse(
        (response) =>
          response.url().includes('/cancelar') && response.request().method() === 'POST',
      ),
      citizenPage.getByRole('button', { name: 'Cancelar solicitud' }).click(),
    ]);
    expect(cancelResponse.status()).toBe(200);
    const cancelled = (await cancelResponse.json()) as { id: string; estado: string };
    expect(cancelled.id).toBe(request.id);
    expect(cancelled.estado).toBe('CANCELADA');
    console.log(`[cancel-ok] POST /cancelar -> 200 estado=${cancelled.estado}`);

    // 5. The citizen is back to the initial state: the action rail is offered again.
    await expect(citizenPage.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      citizenPage.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeVisible();

    // 6. The card disappears from the driver's inbox LIVE, without a reload.
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    await expect(driverPage.getByText('Sin solicitudes por ahora')).toBeVisible({
      timeout: 15_000,
    });
    console.log('[cancel-ok] la tarjeta desapareció del inbox del conductor');

    await test.info().attach('cancel-ok-calls.txt', {
      body: [
        `solicitud=${request.id}`,
        '# driver calls',
        ...driverCalls.map((call) => `${call.method} ${call.url} -> ${call.status}`),
        '# citizen calls',
        ...citizenCalls.map((call) => `${call.method} ${call.url} -> ${call.status}`),
      ].join('\n'),
      contentType: 'text/plain',
    });
  } catch (error) {
    if (requestId) {
      console.log(`[cancel-ok] fallo con solicitud=${requestId}`);
    }
    throw error;
  } finally {
    // Nothing to clean up: a cancelled request leaves no unit occupied.
    await driverContext.close();
    await citizenContext.close();
  }
});

test('AC-refused: cancelar una solicitud ya asignada muestra el motivo del backend', async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const driverContext = await newIsolatedContext(browser);
  const citizenContext = await newIsolatedContext(browser);
  const driverPage = await driverContext.newPage();
  const citizenPage = await citizenContext.newPage();

  let driverToken: string | null = null;
  let unitId: string | null = null;
  let requestId: string | null = null;
  const finished = false;

  try {
    // 1. Driver first: subscribed BEFORE the broadcast exists.
    await loginAsSpecificDriver(driverPage, DRIVER);
    driverToken = await bearer(driverPage);
    unitId = await myUnit(driverPage, driverToken);

    // 2. Citizen reports a zone and asks for an ambulance.
    await citizenWithEmergency(citizenPage);
    const request = await requestAmbulance(citizenPage);
    requestId = request.id;
    expect(request.estado).toBe('PENDIENTE');

    // 3. The driver accepts: the request is ASIGNADA and the ambulance is on its way.
    const card = driverPage.getByRole('region', { name: 'Solicitud de ambulancia' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    const [acceptResponse] = await Promise.all([
      driverPage.waitForResponse(
        (response) => response.url().includes('/accept') && response.request().method() === 'POST',
      ),
      card.getByRole('button', { name: 'Aceptar solicitud' }).click(),
    ]);
    expect(acceptResponse.status()).toBe(200);

    // 4. The citizen sees the live assignment.
    await expect(
      citizenPage.getByRole('heading', { level: 1, name: 'Tu ambulancia va en camino' }),
    ).toBeVisible({ timeout: 20_000 });
    // The acceptance notice is non-modal and self-closing; dismiss it so the rail
    // (with the cancel action) is unobstructed.
    const closePopup = citizenPage.getByRole('button', { name: 'Cerrar' });
    if (await closePopup.isVisible().catch(() => false)) {
      await closePopup.click();
    }

    // 5. Cancelling now must be refused: 409 with the honest reason, never a fake close.
    const [refusedResponse] = await Promise.all([
      citizenPage.waitForResponse(
        (response) =>
          response.url().includes('/cancelar') && response.request().method() === 'POST',
      ),
      citizenPage.getByRole('button', { name: 'Cancelar solicitud' }).click(),
    ]);
    expect(refusedResponse.status()).toBe(409);
    const refused = (await refusedResponse.json()) as { codigo: string; mensaje: string };
    expect(refused.codigo).toBe('SOLICITUD_NO_ASIGNABLE');
    expect(refused.mensaje).toBe(CANCELLED_TOO_LATE_MESSAGE);
    console.log(`[cancel-refused] POST /cancelar -> 409 ${refused.codigo} ${refused.mensaje}`);

    // 6. The citizen keeps the REAL state and reads the backend reason, not a lie.
    //    The message shows both in the rail and in the toast, so the assertion is
    //    scoped to the citizen panel to avoid a strict-mode ambiguity.
    await expect(
      citizenPage
        .getByRole('complementary', { name: 'Panel del ciudadano' })
        .getByText(CANCELLED_TOO_LATE_MESSAGE),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      citizenPage.getByRole('heading', { level: 1, name: 'Tu ambulancia va en camino' }),
    ).toBeVisible();
  } finally {
    // Release the unit so a re-run starts clean: finish the accepted service.
    if (!finished && driverToken && requestId && unitId) {
      try {
        await driverPage.request.post(`${API}/solicitudes/${requestId}/finalizar`, {
          headers: { Authorization: `Bearer ${driverToken}` },
          data: { ambulanciaId: unitId },
        });
      } catch {
        // Best effort: the request expires on its own otherwise.
      }
    }
    await driverContext.close();
    await citizenContext.close();
  }
});
