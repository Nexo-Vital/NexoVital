import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { type APIResponse, expect, test } from '@playwright/test';

/**
 * End-to-end proof of the driver's request inbox against the REAL stack (Vite
 * on :5173 proxying /api and /ws to the backend on :8080). No mocks: every
 * assertion reads the UI and every setup/cleanup step goes through REST.
 *
 * Covers two stories that had UI but no live evidence:
 *
 *   EP-04.F2.US3 (detail) a notified driver opens a request and sees its real
 *     detail — the emergency it points at, the zone, and how many units were
 *     notified — from both the live card and the registry sheet.
 *
 *   EP-04.F2.US3 (reject) a driver declines a broadcast and the request stays
 *     PENDIENTE for the remaining units: a second driver accepts it afterwards
 *     and wins. The rejection is a PER-UNIT decision (AC4), never a whole-request
 *     close (RechazarSolicitudUseCaseImpl).
 *
 * ORDERING. The backend never re-delivers a broadcast: `POST /solicitudes` fans
 * the PENDIENTE frame out to each notified driver at creation time. Every driver
 * context must therefore be signed in and subscribed BEFORE the citizen asks, so
 * the driver(s) open first and the citizen last.
 */

const BASE_URL = 'http://localhost:5173';
const API = `${BASE_URL}/api/v1`;

/** Persisted auth key, copied from src/services/apiClient.ts (TOKEN_KEY). */
const TOKEN_KEY = 'nexovital.token';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
/** Seeded drivers of the units ABC101 and ABC202 (Back_NexoVital DataSeeder). */
const DRIVER_1 = { email: 'conductor1@nexovital.co', password: 'conductor123' };
const DRIVER_2 = { email: 'conductor2@nexovital.co', password: 'conductor123' };

interface AmbulanciaDto {
  id: string;
  placa: string;
  estado: string;
  ubicacion: { lat: number; lng: number };
  zona: string;
}

interface RecordedCall {
  method: string;
  url: string;
  status: number;
  readBody: () => Promise<string>;
}

/** Records every /api/v1/ response with its method, URL, status and lazy body. */
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

/** One line per inbox-relevant call (method, URL, status), body on failure. */
async function describeInboxCalls(calls: RecordedCall[]): Promise<string> {
  const lines: string[] = [];
  for (const call of calls) {
    if (!/solicitudes|emergencias|flota/.test(call.url)) {
      continue;
    }
    let suffix = '';
    if (call.status >= 400) {
      const body = await call.readBody();
      suffix = body ? ` ${body.length > 400 ? `${body.slice(0, 400)}...` : body}` : '';
    }
    lines.push(`${call.method} ${call.url} -> ${call.status}${suffix}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no inbox calls captured)';
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

/** Signs in as a specific driver and waits for the console plus its socket. */
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

/** Reads the fleet read-model with the given token. */
async function getFleet(page: Page, token: string): Promise<AmbulanciaDto[]> {
  const response = await page.request.get(`${API}/flota/ambulancias`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as AmbulanciaDto[];
}

/**
 * Reports a zone through the UI so the store holds a REAL emergency (the mock
 * fixtures carry non-UUID ids the backend would reject). Returns the created
 * emergency id, so the assertions can name the exact emergency the request
 * points at.
 */
async function reportAffectedZone(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Reportar zona afectada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reportar zona afectada' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel('Descripción')
    .fill('EP-04.F2.US3 E2E: zona afectada para habilitar la solicitud de ambulancia.');
  await dialog.getByRole('button', { name: 'Usar el centro del mapa' }).click();
  const [emergencyResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/emergencias') && response.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Reportar', exact: true }).click(),
  ]);
  expect(emergencyResponse.status()).toBe(201);
  const body = (await emergencyResponse.json()) as { id: string };
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  return body.id;
}

/** Citizen login plus a real affected zone, ready to ask for an ambulance. */
async function citizenWithEmergency(page: Page): Promise<string> {
  await login(page, CITIZEN);
  await expect(page.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /Acopio/i }).first()).toBeVisible({
    timeout: 20_000,
  });
  return reportAffectedZone(page);
}

/** Clicks "Pedir ambulancia" and returns the 201 request body. */
async function requestAmbulance(
  page: Page,
): Promise<{ id: string; emergenciaId: string; estado: string; ambulanciasNotificadas: string[] }> {
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
    emergenciaId: string;
    estado: string;
    ambulanciasNotificadas: string[];
  };
}

/** Best-effort close of an assigned request (accept then finish) via REST. */
async function closeRequest(
  page: Page,
  token: string,
  requestId: string,
  unitId: string,
): Promise<void> {
  try {
    const accepted: APIResponse = await page.request.post(
      `${API}/solicitudes/${requestId}/accept`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { ambulanciaId: unitId },
      },
    );
    if (accepted.ok()) {
      await page.request.post(`${API}/solicitudes/${requestId}/finalizar`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { ambulanciaId: unitId },
      });
    }
  } catch {
    // Cleanup is best effort; the request expires on its own window otherwise.
  }
}

test('EP-04.F2.US3 detalle: el conductor ve el detalle de la solicitud notificada', async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const driverContext = await newIsolatedContext(browser);
  const citizenContext = await newIsolatedContext(browser);
  const driverPage = await driverContext.newPage();
  const citizenPage = await citizenContext.newPage();
  const driverCalls = recordApiCalls(driverPage);

  let driverToken: string | null = null;
  let unitId: string | null = null;
  let requestId: string | null = null;
  let closed = false;

  try {
    // 1. Driver first: subscribed BEFORE the request is broadcast.
    await loginAsSpecificDriver(driverPage, DRIVER_1);
    driverToken = await bearer(driverPage);
    const mia = (await driverPage.request.get(`${API}/flota/ambulancias/mia`, {
      headers: { Authorization: `Bearer ${driverToken}` },
    })) as APIResponse;
    expect(mia.ok()).toBeTruthy();
    unitId = ((await mia.json()) as AmbulanciaDto | null)?.id ?? null;
    expect(unitId).toBeTruthy();

    // 2. Citizen reports a real emergency and asks for an ambulance.
    const emergencyId = await citizenWithEmergency(citizenPage);
    const request = await requestAmbulance(citizenPage);
    requestId = request.id;
    expect(request.estado).toBe('PENDIENTE');
    console.log(
      `[US3-detalle] solicitud=${request.id} emergencia=${emergencyId} notificadas=${request.ambulanciasNotificadas.length}`,
    );

    // 3. The live card names the real emergency and the real zone: that IS the
    //    detail of the request that reached this driver.
    const card = driverPage.getByRole('region', { name: 'Solicitud de ambulancia' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText(request.emergenciaId)).toBeVisible();
    await expect(card.getByText('Suba', { exact: true })).toBeVisible();
    console.log('[US3-detalle] live card shows the emergency id and the zone');

    // 4. The registry sheet shows the full detail too, opened by tapping the row.
    const registry = driverPage.getByRole('list', { name: 'Lista de solicitudes' });
    const row = registry.getByRole('button').filter({ hasText: request.id });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    const sheet = driverPage.getByRole('dialog', { name: `Solicitud ${request.id}` });
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText('Emergencia')).toBeVisible();
    await expect(sheet.getByText(request.emergenciaId)).toBeVisible();
    await expect(sheet.getByText('Tipo')).toBeVisible();
    await expect(sheet.getByText('Ubicación')).toBeVisible();
    await expect(sheet.getByText('Unidades avisadas')).toBeVisible();
    await expect(
      sheet.getByText(String(request.ambulanciasNotificadas.length), { exact: true }),
    ).toBeVisible();

    const evidence = await describeInboxCalls(driverCalls);
    console.log(`[US3-detalle] calls:\n${evidence}`);
    await test.info().attach('us3-detalle-calls.txt', {
      body: `solicitud=${request.id}\nemergencia=${emergencyId}\n${evidence}`,
      contentType: 'text/plain',
    });

    // 5. Leave the state clean: accept and finish the request with this driver.
    if (driverToken && unitId && requestId) {
      await closeRequest(driverPage, driverToken, requestId, unitId);
      closed = true;
    }
  } finally {
    if (!closed && driverToken && unitId && requestId) {
      await closeRequest(driverPage, driverToken, requestId, unitId);
    }
    await driverContext.close();
    await citizenContext.close();
  }
});

test('EP-04.F2.US3 rechazo: un conductor rechaza y la solicitud sigue para otro', async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const driver1Context = await newIsolatedContext(browser);
  const driver2Context = await newIsolatedContext(browser);
  const citizenContext = await newIsolatedContext(browser);
  const driver1Page = await driver1Context.newPage();
  const driver2Page = await driver2Context.newPage();
  const citizenPage = await citizenContext.newPage();
  const driver1Calls = recordApiCalls(driver1Page);
  const driver2Calls = recordApiCalls(driver2Page);

  let driver1Token: string | null = null;
  let driver2Token: string | null = null;
  let unit1Id: string | null = null;
  let unit2Id: string | null = null;
  let requestId: string | null = null;
  let finished = false;

  /** The unit a driver's `/mia` resolves to. */
  const myUnit = async (page: Page, token: string): Promise<string | null> => {
    const response = (await page.request.get(`${API}/flota/ambulancias/mia`, {
      headers: { Authorization: `Bearer ${token}` },
    })) as APIResponse;
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as AmbulanciaDto | null)?.id ?? null;
  };

  try {
    // 1. Both drivers first: both are subscribed when the broadcast goes out.
    await loginAsSpecificDriver(driver1Page, DRIVER_1);
    await loginAsSpecificDriver(driver2Page, DRIVER_2);
    driver1Token = await bearer(driver1Page);
    driver2Token = await bearer(driver2Page);
    unit1Id = await myUnit(driver1Page, driver1Token);
    unit2Id = await myUnit(driver2Page, driver2Token);
    expect(unit1Id).toBeTruthy();
    expect(unit2Id).toBeTruthy();
    expect(unit1Id).not.toBe(unit2Id);

    // 2. Citizen reports a real emergency and asks for an ambulance.
    await citizenWithEmergency(citizenPage);
    const request = await requestAmbulance(citizenPage);
    requestId = request.id;
    expect(request.ambulanciasNotificadas).toContain(unit1Id);
    expect(request.ambulanciasNotificadas).toContain(unit2Id);
    console.log(
      `[US3-rechazo] solicitud=${request.id} notificadas=${request.ambulanciasNotificadas.length}`,
    );

    // 3. Driver 1 declines from the inbox card.
    const card1 = driver1Page.getByRole('region', { name: 'Solicitud de ambulancia' });
    await expect(card1).toBeVisible({ timeout: 20_000 });
    const [rejectResponse] = await Promise.all([
      driver1Page.waitForResponse(
        (candidate) =>
          candidate.url().includes('/reject') && candidate.request().method() === 'POST',
      ),
      card1.getByRole('button', { name: 'Rechazar' }).click(),
    ]);
    expect(rejectResponse.status()).toBe(200);
    const rejected = (await rejectResponse.json()) as { id: string; estado: string };
    expect(rejected.id).toBe(request.id);
    expect(rejected.estado).toBe('PENDIENTE');
    await expect(driver1Page.getByText('Solicitud rechazada')).toBeVisible({ timeout: 10_000 });
    console.log(`[US3-rechazo] driver1 rechazo -> 200 estado=${rejected.estado}`);

    // 4. The request is STILL offered to driver 2 and its accept is enabled.
    const card2 = driver2Page.getByRole('region', { name: 'Solicitud de ambulancia' });
    await expect(card2).toBeVisible({ timeout: 20_000 });
    const acceptButton = card2.getByRole('button', { name: 'Aceptar solicitud' });
    await expect(acceptButton).toBeEnabled();

    // 5. Driver 2 accepts and wins: the request was not closed by the decline.
    const [acceptResponse] = await Promise.all([
      driver2Page.waitForResponse(
        (candidate) =>
          candidate.url().includes('/accept') && candidate.request().method() === 'POST',
      ),
      acceptButton.click(),
    ]);
    expect(acceptResponse.status()).toBe(200);
    const accepted = (await acceptResponse.json()) as {
      ganador: boolean;
      solicitud: { id: string; estado: string; ambulanciaAsignadaId: string | null };
    };
    expect(accepted.ganador).toBe(true);
    expect(accepted.solicitud.id).toBe(request.id);
    expect(accepted.solicitud.estado).toBe('ASIGNADA');
    expect(accepted.solicitud.ambulanciaAsignadaId).toBe(unit2Id);
    await expect(driver2Page.getByText('Solicitud aceptada')).toBeVisible({ timeout: 15_000 });
    console.log(`[US3-rechazo] driver2 acepto -> 200 ganador=true unidad=${unit2Id}`);

    // 6. The backend agrees: driver 2's unit is in mission, driver 1's is free.
    const fleet = await getFleet(driver2Page, driver2Token);
    expect(fleet.find((unit) => unit.id === unit2Id)?.estado).toBe('EN_MISION');
    expect(fleet.find((unit) => unit.id === unit1Id)?.estado).toBe('DISPONIBLE');

    const evidence = [
      '# driver1 calls',
      await describeInboxCalls(driver1Calls),
      '# driver2 calls',
      await describeInboxCalls(driver2Calls),
    ].join('\n');
    console.log(evidence);
    await test.info().attach('us3-rechazo-calls.txt', {
      body: `solicitud=${request.id}\n${evidence}`,
      contentType: 'text/plain',
    });

    // 7. Leave the state clean: finish the service as driver 2.
    if (driver2Token && unit2Id && requestId) {
      const finish = await driver2Page.request.post(`${API}/solicitudes/${requestId}/finalizar`, {
        headers: { Authorization: `Bearer ${driver2Token}` },
        data: { ambulanciaId: unit2Id },
      });
      expect(finish.ok()).toBeTruthy();
      const finalFleet = await getFleet(driver2Page, driver2Token);
      expect(finalFleet.find((unit) => unit.id === unit2Id)?.estado).toBe('DISPONIBLE');
      finished = true;
    }
  } finally {
    if (!finished && driver2Token && unit2Id && requestId) {
      await driver2Page.request
        .post(`${API}/solicitudes/${requestId}/finalizar`, {
          headers: { Authorization: `Bearer ${driver2Token}` },
          data: { ambulanciaId: unit2Id },
        })
        .catch(() => undefined);
    }
    await driver1Context.close();
    await driver2Context.close();
    await citizenContext.close();
  }
});
