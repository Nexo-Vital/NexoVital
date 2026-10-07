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

/**
 * Auth key, copied from src/services/apiClient.ts (TOKEN_KEY). The app keeps the
 * session in `sessionStorage` (one session per tab), never in `localStorage`.
 */
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

/**
 * Leaves the driver connected to the service, whatever state the unit is in.
 *
 * The connection is DATA of the unit on the server (EP-04.F2.US1): the console
 * shows what the server holds and surfaces no request while disconnected. A unit
 * is born connected, and it is disconnected when its driver's last realtime
 * session ends, which is what closing the page of an earlier scenario does. So
 * the same driver can open the console already connected or disconnected.
 *
 * The buttons stay disabled until the console has read its unit, so the helper
 * waits for one of the two settled states before deciding, and presses
 * "Conectarse" only when the unit is disconnected.
 */
async function goOnline(page: Page): Promise<void> {
  const unit = page.getByRole('region', { name: 'Tu ambulancia' });
  const connected = unit.getByText('En línea', { exact: true });
  const connect = unit.getByRole('button', { name: 'Conectarse', exact: true });
  await expect(async () => {
    if (await connected.isVisible()) {
      return;
    }
    await expect(connect).toBeEnabled({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  if (!(await connected.isVisible())) {
    await connect.click();
  }
  await expect(connected).toBeVisible({ timeout: 10_000 });
  // A request only reaches a unit that is connected AND has signal. A driver of
  // an earlier scenario left its unit without signal, and it recovers it with
  // the first position report after connecting. Wait until the SERVER says the
  // unit can receive a request, so the next step never races that report.
  await expect(async () => {
    const mia = await page.evaluate(async (key) => {
      const token = sessionStorage.getItem(key);
      const response = await fetch('/api/v1/flota/ambulancias/mia', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok ? ((await response.json()) as Record<string, unknown> | null) : null;
    }, TOKEN_KEY);
    expect(mia?.conectada).toBe(true);
    expect(mia?.sinSenal).not.toBe(true);
  }).toPass({ timeout: 15_000 });
}

/** Signs in as a specific driver, waits for the console plus its socket and connects. */
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
  await goOnline(page);
}

/** Ids of the open requests the server still offers to this driver's unit. */
async function pendingRequestIds(page: Page): Promise<string[]> {
  const token = await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
  const response = await page.request.get(`${API}/flota/ambulancias/mia/solicitudes/pendientes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as Array<{ id: string }> | null;
  return Array.isArray(body) ? body.map((row) => row.id) : [];
}

/**
 * Leaves the driver with NO open request before the scenario raises its own.
 *
 * A request stays PENDIENTE for its whole accept window, and a driver that
 * connects gets back every request that is still open for its unit
 * (EP-04.F2.US1). So a request an earlier scenario left unanswered is offered
 * again here, and since the console shows the OLDEST request first, that
 * leftover would take the card and the pop-up of the request under test.
 *
 * Every scenario asks as the same seeded citizen, so the leftovers are withdrawn
 * with that citizen's own `POST /solicitudes/{id}/cancelar`. Whatever cannot be
 * withdrawn (a request of somebody else) is waited out: its window closes by
 * itself within a minute.
 */
async function clearLeftoverRequests(page: Page): Promise<void> {
  const leftovers = await pendingRequestIds(page);
  if (leftovers.length > 0) {
    const session = await page.request.post(`${API}/sesiones`, { data: CITIZEN });
    expect(session.ok()).toBeTruthy();
    const citizenToken = ((await session.json()) as { token: string }).token;
    for (const id of leftovers) {
      const cancelled = await page.request
        .post(`${API}/solicitudes/${id}/cancelar`, {
          headers: { Authorization: `Bearer ${citizenToken}` },
        })
        .catch(() => null);
      console.log(`[limpieza] solicitud previa ${id} -> ${cancelled?.status() ?? 'sin respuesta'}`);
    }
  }
  await expect
    .poll(async () => (await pendingRequestIds(page)).length, {
      timeout: 70_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(0);
  // The console agrees: no request card and no notice are left on the screen.
  await expect(page.getByRole('region', { name: 'Solicitud de ambulancia' })).toBeHidden({
    timeout: 15_000,
  });
  await expect(page.getByRole('alertdialog', { name: 'Nueva solicitud de ambulancia' })).toBeHidden(
    { timeout: 15_000 },
  );
}

/** Current bearer token the app keeps for this page's session (per-tab `sessionStorage`). */
async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
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
  // EP-02.F1.US3: the type is required; the select is keyed by the UI enum.
  await dialog.getByLabel('Tipo de emergencia').selectOption('ACCIDENT');
  await dialog
    .getByLabel('Comentario')
    .fill('EP-04.F2.US3 E2E: zona afectada para habilitar la solicitud de ambulancia.');
  // The context grants geolocation, so the report takes the device point. The
  // address shown is cosmetic: the report does not wait for the geocoder.
  await dialog.getByRole('button', { name: 'Mi ubicación actual' }).click();
  await expect(dialog.getByTestId('citizen-report-chosen-location')).toBeVisible();
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
async function requestAmbulance(page: Page): Promise<{
  id: string;
  emergenciaId: string | null;
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
    emergenciaId: string | null;
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
  test.setTimeout(180_000);

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
    // Nothing an earlier scenario left open may take the card of this request.
    await clearLeftoverRequests(driverPage);

    // 2. Citizen reports a real emergency (a map warning) and asks for an
    //    ambulance. The request no longer depends on it: the aid/zone report is
    //    recorded, but the request is standalone and carries the pickup point.
    const emergencyId = await citizenWithEmergency(citizenPage);
    const request = await requestAmbulance(citizenPage);
    requestId = request.id;
    expect(request.estado).toBe('PENDIENTE');
    expect(request.emergenciaId ?? null).toBeNull();
    console.log(
      `[US3-detalle] solicitud=${request.id} emergenciaReportada=${emergencyId} ` +
        `notificadas=${request.ambulanciasNotificadas.length}`,
    );

    // 3. The live card shows the request's own pickup point and distance: the
    //    request no longer carries an emergency or a zone.
    const card = driverPage.getByRole('region', { name: 'Solicitud de ambulancia' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    // The request points at no emergency: the row is left out of the card.
    await expect(card.getByText('Emergencia', { exact: true })).toHaveCount(0);
    await expect(card.getByText('4.7280, -74.0780')).toBeVisible();
    await expect(card.getByText(/km/)).toBeVisible();
    console.log('[US3-detalle] live card shows the pickup point and the distance');

    // The same request is announced in the middle of the screen (EP-04.F2.US2).
    // Closing the notice is not a rejection: the request stays in the panel.
    const popup = driverPage.getByRole('alertdialog', { name: 'Nueva solicitud de ambulancia' });
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await popup.getByRole('button', { name: 'Cerrar aviso' }).click();
    await expect(popup).toBeHidden();
    await expect(card).toBeVisible();

    // 4. The registry shows the full detail too, opened by tapping the row. The
    //    row names the request by its short reference (never the whole id), and
    //    the detail opens inline, below the list.
    const reference = `#${request.id.replace(/-/g, '').slice(0, 6)}`;
    const registry = driverPage.getByRole('list', { name: 'Lista de solicitudes' });
    const row = registry.getByRole('button').filter({ hasText: reference });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');

    const sheet = driverPage.getByTestId('solicitud-detail');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    // The detail is the server's: opening the row reads GET /solicitudes/{id},
    // and the server answers 200 because this driver's unit was notified.
    await expect
      .poll(
        () =>
          driverCalls.some(
            (call) =>
              call.method === 'GET' &&
              call.url.endsWith(`/api/v1/solicitudes/${request.id}`) &&
              call.status === 200,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    console.log('[US3-detalle] GET /solicitudes/{id} -> 200');
    await expect(sheet.getByRole('heading', { name: new RegExp(reference) })).toBeVisible();
    // No emergency and no type behind a citizen request: those two rows are
    // left out instead of saying what is missing.
    await expect(sheet.getByText('Emergencia', { exact: true })).toHaveCount(0);
    await expect(sheet.getByText('Tipo', { exact: true })).toHaveCount(0);
    await expect(sheet.getByText('Ubicación', { exact: true })).toBeVisible();
    await expect(sheet.getByText('4.7280, -74.0780')).toBeVisible();
    await expect(sheet.getByText('Distancia', { exact: true })).toBeVisible();
    // The notified units are listed by plate; the request reached at least this
    // driver's unit, so the row never reads as "nobody was notified".
    expect(request.ambulanciasNotificadas).toContain(unitId);
    await expect(sheet.getByText('Unidades avisadas', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Sin unidades avisadas')).toHaveCount(0);

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
  test.setTimeout(180_000);

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
    // Nothing an earlier scenario left open may take the card of this request.
    await clearLeftoverRequests(driver1Page);
    await clearLeftoverRequests(driver2Page);

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

/**
 * Off demo mode the request registry and the emergency store are fed ONLY by the
 * backend. Before this fix the console hydrated `MOCK_SOLICITUDES` off demo, so a
 * driver's inbox listed six fake `REQ-…` rows and an accept/reject would have
 * POSTed an id the server does not know. This scenario runs against the real
 * stack and asserts no fixture id is painted anywhere in the driver panel.
 */
test('el inbox del conductor no pinta identificadores de fixture', async ({ browser }) => {
  test.setTimeout(60_000);

  const context = await newIsolatedContext(browser);
  const page = await context.newPage();

  try {
    await loginAsSpecificDriver(page, DRIVER_1);

    const panel = page.getByRole('complementary', { name: 'Panel del conductor' });
    await expect(panel).toBeVisible({ timeout: 30_000 });

    // The registry is a view of the real backend: no `REQ-…` fixture request and
    // no `EMG-…` fixture emergency can appear anywhere in the panel. A real
    // request uses a UUID, so this assertion stays true even if one is live.
    await expect(panel.getByText(/REQ-\d+/)).toHaveCount(0);
    await expect(panel.getByText(/EMG-\d+/)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
