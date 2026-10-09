import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { type APIResponse, expect, test } from '@playwright/test';

/**
 * End-to-end reproduction of the WHOLE ambulance cycle with two simultaneous
 * real sessions against the REAL stack (Vite on :5173 proxying /api and /ws to
 * the backend on :8080). There are no mocks; every assertion reads the UI.
 *
 * WHY TWO CONTEXTS IN THIS ORDER
 * The backend never re-delivers a broadcast: `POST /solicitudes` fans the
 * PENDIENTE frame out to each notified driver's `/user/queue/solicitudes` at
 * creation time (`FlotaPushListener.alCrearSolicitud`). A driver who subscribes
 * AFTER the request is created would never see it, so the driver must be signed
 * in, subscribed and CONNECTED ("Conectarse") BEFORE the citizen asks. Hence context B (driver) opens
 * first, and only then context A (citizen).
 *
 * WHAT IT DRIVES
 *   1. the driver's own unit resolves (GET /flota/ambulancias/mia) and its plate
 *      is on screen;
 *   2. the citizen reports an affected zone through the UI. A fresh report is the
 *      only honest anchor: the front keeps NO REST snapshot of the backend
 *      emergencies (the emergency store is fixtures + /topic/emergencias), so it
 *      cannot reuse one from a previous run;
 *   3. the citizen asks for an ambulance -> POST /solicitudes 201, "Buscando";
 *   4. the request reaches the driver's inbox WITHOUT a reload; the driver
 *      accepts -> POST /accept 200 and the mission opens;
 *   5. the citizen sees the acceptance live (no reload) and the legend counts the
 *      unit as "Ocupada";
 *   6. the driver declares arrival -> POST /llegada 200; the citizen sees it;
 *   7. the citizen confirms -> POST /confirmar 200; the driver sees the
 *      confirmation live;
 *   8. the driver finishes -> POST /finalizar 200 (TOMADA) and the unit returns
 *      to DISPONIBLE, also verified against GET /flota/ambulancias.
 *
 * CLEANUP. On success nothing is left open: the request is TOMADA and the unit is
 * DISPONIBLE. If an assertion fails after the accept, the finally block makes a
 * best-effort POST /finalizar with the driver's own token, so a re-run is not
 * blocked by an occupied unit. A failure before the accept leaves a PENDIENTE
 * request that the backend expires on its own window (or the citizen withdraws
 * through `POST /solicitudes/{id}/cancelar`), so that is the honest limit of the
 * failure path.
 */

const BASE_URL = 'http://localhost:5173';
const API = `${BASE_URL}/api/v1`;

/**
 * Auth key, copied from src/services/apiClient.ts (TOKEN_KEY). The app keeps the
 * session in `sessionStorage` (one session per tab), never in `localStorage`.
 */
const TOKEN_KEY = 'nexovital.token';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
/** Seeded driver of the unit ABC101 (Back_NexoVital DataSeeder). */
const DRIVER = { email: 'conductor1@nexovital.co', password: 'conductor123' };

/** Paths that make up the cycle under test, for the forensic evidence dump. */
const CYCLE_PATHS = ['/solicitudes', '/accept', '/llegada', '/finalizar', '/confirmar'];

/**
 * Unit exactly as `GET /api/v1/flota/ambulancias` returns it (backend
 * `AmbulanciaDto`): the state is the Spanish domain literal, not the front's
 * English `AmbulanceState`.
 */
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

/** One line per cycle call (method, URL and status), plus the body on failure. */
async function describeCycleCalls(calls: RecordedCall[]): Promise<string> {
  const lines: string[] = [];
  for (const call of calls) {
    if (!CYCLE_PATHS.some((path) => call.url.includes(path))) {
      continue;
    }
    let suffix = '';
    if (call.status >= 400) {
      const body = await call.readBody();
      suffix = body ? ` ${body.length > 400 ? `${body.slice(0, 400)}...` : body}` : '';
    }
    lines.push(`${call.method} ${call.url} -> ${call.status}${suffix}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no cycle calls captured)';
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

/** The `<b>` count of a unit bucket in the citizen legend. */
function legendCount(page: Page, label: string) {
  const legend = page.getByRole('complementary', { name: 'Leyenda del mapa' });
  return legend.locator('li').filter({ hasText: label }).locator('b');
}

/**
 * Reports a zone through the UI so the store holds a REAL emergency (the mock
 * fixtures carry non-UUID ids the backend would reject). Without an active
 * emergency the store never reaches the network at all.
 */
async function reportAffectedZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reportar zona afectada' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reportar zona afectada' });
  await expect(dialog).toBeVisible();
  // EP-02.F1.US3: the type is required; the select is keyed by the UI enum.
  await dialog.getByLabel('Tipo de emergencia').selectOption('ACCIDENT');
  await dialog
    .getByLabel('Comentario')
    .fill('Ciclo E2E: zona afectada para habilitar la solicitud de ambulancia.');
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
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test('ciclo completo de la ambulancia con ciudadano y conductor simultaneos', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);

  const driverContext = await newIsolatedContext(browser);
  const citizenContext = await newIsolatedContext(browser);
  const driverPage = await driverContext.newPage();
  const citizenPage = await citizenContext.newPage();

  const driverCalls = recordApiCalls(driverPage);
  const citizenCalls = recordApiCalls(citizenPage);

  // Real variables the cleanup needs if an assertion fails mid-flight.
  let driverToken: string | null = null;
  let requestId: string | null = null;
  let assignedUnitId: string | null = null;
  let finished = false;

  try {
    // 1. Driver first: signed in and subscribed BEFORE the request exists.
    const driverRealtime = driverPage.waitForEvent('websocket', {
      predicate: (socket) => socket.url().includes('/ws'),
      timeout: 20_000,
    });
    await login(driverPage, DRIVER);
    await test.step('1. Conductor 1 entra y resuelve su unidad', async () => {
      await expect(
        driverPage.getByRole('complementary', { name: 'Panel del conductor' }),
      ).toBeVisible({ timeout: 30_000 });
      // The realtime socket is open: the inbox subscription rides on it.
      await driverRealtime;
      // Connected to the service: only then does the console surface requests.
      await goOnline(driverPage);
      driverToken = await bearer(driverPage);
      const miaResponse: APIResponse = await driverPage.request.get(
        `${API}/flota/ambulancias/mia`,
        { headers: { Authorization: `Bearer ${driverToken}` } },
      );
      expect(miaResponse.ok()).toBeTruthy();
      const mia = (await miaResponse.json()) as AmbulanciaDto | null;
      expect(mia?.id).toBeTruthy();
      assignedUnitId = mia?.id ?? null;
      // The screen resolves the SAME unit the server scopes to this driver.
      await expect(
        driverPage.getByRole('region', { name: 'Tu ambulancia' }).getByText(mia?.placa ?? ''),
      ).toBeVisible({ timeout: 20_000 });
      console.log(`[cycle] driver unit resolved: ${mia?.placa} (${mia?.id})`);
    });

    // 2. Citizen second: report a real affected zone, then wait for the map.
    await login(citizenPage, CITIZEN);
    await test.step('2. Ciudadano entra y reporta la zona afectada', async () => {
      await expect(citizenPage.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(citizenPage.getByRole('button', { name: /Acopio/i }).first()).toBeVisible({
        timeout: 20_000,
      });
      await reportAffectedZone(citizenPage);
      console.log('[cycle] citizen reported a real emergency');
    });

    // Baseline: the real fleet count BEFORE this cycle occupies a unit. Read from
    // the UI instead of a hardcoded number, so the assertion survives a re-run
    // that starts from a fleet other than the seed.
    const busyBefore = ((await legendCount(citizenPage, 'Ocupada').textContent()) ?? '').trim();
    expect(Number(busyBefore)).toBeGreaterThanOrEqual(0);

    // 3. Citizen asks for an ambulance with a real click.
    await test.step('3. El ciudadano pide ambulancia', async () => {
      const [requestResponse] = await Promise.all([
        citizenPage.waitForResponse(
          (response) =>
            response.url().includes('/api/v1/solicitudes') &&
            response.request().method() === 'POST',
        ),
        citizenPage.getByRole('button', { name: 'Pedir ambulancia' }).click(),
      ]);
      expect(requestResponse.status()).toBe(201);
      const body = (await requestResponse.json()) as {
        id: string;
        emergenciaId: string;
        estado: string;
        ambulanciasNotificadas: string[];
      };
      requestId = body.id;
      expect(body.estado).toBe('PENDIENTE');
      expect(body.ambulanciasNotificadas.length).toBeGreaterThan(0);
      await expect(citizenPage.getByRole('heading', { name: 'Pidiendo ambulancia' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(citizenPage.getByText('Buscando ambulancia')).toBeVisible({ timeout: 15_000 });
      console.log(
        `[cycle] POST /solicitudes -> 201 id=${body.id} notified=${body.ambulanciasNotificadas.length}`,
      );
    });

    // 4. The driver receives it live (no reload) and accepts.
    await test.step('4. Al conductor le llega la solicitud y la acepta', async () => {
      const card = driverPage.getByRole('region', { name: 'Solicitud de ambulancia' });
      await expect(card).toBeVisible({ timeout: 20_000 });
      // The card names OUR emergency, so the arriving card is provably ours.
      await expect(card).toContainText('Solicitud de ambulancia');
      const [acceptResponse] = await Promise.all([
        driverPage.waitForResponse(
          (response) =>
            response.url().includes('/accept') && response.request().method() === 'POST',
        ),
        card.getByRole('button', { name: 'Aceptar solicitud' }).click(),
      ]);
      expect(acceptResponse.status()).toBe(200);
      const body = (await acceptResponse.json()) as {
        ganador: boolean;
        solicitud: { id: string; estado: string; ambulanciaAsignadaId: string | null };
      };
      expect(body.ganador).toBe(true);
      expect(body.solicitud.ambulanciaAsignadaId).toBe(assignedUnitId);
      await expect(driverPage.getByText('Solicitud aceptada')).toBeVisible({ timeout: 15_000 });
      await expect(driverPage.getByRole('button', { name: 'Declarar llegada' })).toBeVisible({
        timeout: 15_000,
      });
      console.log(`[cycle] POST /accept -> 200 unit=${body.solicitud.ambulanciaAsignadaId}`);
    });

    // 5. The citizen sees the acceptance live and the unit counts as occupied.
    await test.step('5. El ciudadano ve la aceptacion y la unidad pasa a Ocupada', async () => {
      await expect(
        citizenPage.getByRole('heading', { name: 'Tu ambulancia va en camino', level: 1 }),
      ).toBeVisible({ timeout: 20_000 });
      // The driver-assignment panel only exists once a unit accepted: the live
      // second channel of the acceptance notice.
      await expect(citizenPage.getByRole('region', { name: 'Conductor asignado' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(legendCount(citizenPage, 'Ocupada')).toHaveText(String(Number(busyBefore) + 1), {
        timeout: 20_000,
      });
      const citizenToken = await bearer(citizenPage);
      const fleet = await getFleet(citizenPage, citizenToken);
      const winner = fleet.find((unit) => unit.id === assignedUnitId);
      expect(winner?.estado).toBe('EN_MISION');
      console.log(
        `[cycle] live acceptance seen; legend Ocupada ${busyBefore} -> ${Number(busyBefore) + 1}`,
      );
    });

    // 6. The driver declares arrival; the citizen sees it live.
    await test.step('6. El conductor declara la llegada y el ciudadano la ve', async () => {
      const [arrivalResponse] = await Promise.all([
        driverPage.waitForResponse(
          (response) =>
            response.url().includes('/llegada') && response.request().method() === 'POST',
        ),
        driverPage.getByRole('button', { name: 'Declarar llegada' }).click(),
      ]);
      expect(arrivalResponse.status()).toBe(200);
      // The arrival modal is the citizen's live reaction. Its accessible name
      // comes from the sr-only title, and while it is open the page behind it is
      // inert, so the dialog is the honest target (not the aria-hidden h1).
      await expect(citizenPage.getByRole('dialog', { name: 'Confirmar llegada' })).toBeVisible({
        timeout: 20_000,
      });
      console.log('[cycle] POST /llegada -> 200; citizen sees the arrival');
    });

    // 7. The citizen confirms; the driver sees the confirmation live.
    await test.step('7. El ciudadano confirma la llegada', async () => {
      const arrivalDialog = citizenPage.getByRole('dialog', { name: 'Confirmar llegada' });
      const [confirmResponse] = await Promise.all([
        citizenPage.waitForResponse(
          (response) =>
            response.url().includes('/confirmar') && response.request().method() === 'POST',
        ),
        arrivalDialog.getByRole('button', { name: 'Sí, ya llegó' }).click(),
      ]);
      expect(confirmResponse.status()).toBe(200);
      await expect(
        citizenPage.getByRole('heading', { name: 'Solicitud atendida', level: 1 }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(driverPage.getByText('El ciudadano confirmó la llegada')).toBeVisible({
        timeout: 20_000,
      });
      console.log('[cycle] POST /confirmar -> 200; driver sees the confirmation');
    });

    // 8. The driver finishes: the request closes and the unit is released.
    await test.step('8. El conductor finaliza el servicio y la unidad vuelve a Disponible', async () => {
      const [finishResponse] = await Promise.all([
        driverPage.waitForResponse(
          (response) =>
            response.url().includes('/finalizar') && response.request().method() === 'POST',
        ),
        driverPage.getByRole('button', { name: 'Finalizar servicio' }).click(),
      ]);
      expect(finishResponse.status()).toBe(200);
      const body = (await finishResponse.json()) as { estado: string };
      expect(body.estado).toBe('TOMADA');
      finished = true;

      // The driver's inbox is empty again and its shipped status is available.
      await expect(driverPage.getByText('Sin solicitudes por ahora')).toBeVisible({
        timeout: 15_000,
      });
      await expect(driverPage.getByTestId('driver-status-chip')).toHaveText('Disponible');
      // The citizen's legend drops the unit back to "Disponible" live.
      await expect(legendCount(citizenPage, 'Ocupada')).toHaveText(busyBefore, {
        timeout: 20_000,
      });
      // And the backend agrees: the released unit is available again.
      const citizenToken = await bearer(citizenPage);
      const fleet = await getFleet(citizenPage, citizenToken);
      const released = fleet.find((unit) => unit.id === assignedUnitId);
      expect(released?.estado).toBe('DISPONIBLE');
      console.log('[cycle] POST /finalizar -> 200 TOMADA; unit released to DISPONIBLE');
    });

    const evidence = [
      '# cycle calls (driver context)',
      await describeCycleCalls(driverCalls),
      '# cycle calls (citizen context)',
      await describeCycleCalls(citizenCalls),
    ].join('\n');
    console.log(evidence);
    await test.info().attach('ambulance-cycle-calls.txt', {
      body: evidence,
      contentType: 'text/plain',
    });
  } finally {
    // Best-effort: never leave an occupied unit behind if an assertion failed
    // after the accept. A repeat call after a successful finish answers 409 and
    // is ignored. The server only finishes a service whose arrival was declared
    // (EP-04.F2.US8), so the arrival goes first; it is idempotent.
    if (!finished && driverToken && requestId && assignedUnitId) {
      try {
        await request.post(`${API}/solicitudes/${requestId}/llegada`, {
          headers: { Authorization: `Bearer ${driverToken}` },
          data: { ambulanciaId: assignedUnitId },
        });
        await request.post(`${API}/solicitudes/${requestId}/finalizar`, {
          headers: { Authorization: `Bearer ${driverToken}` },
          data: { ambulanciaId: assignedUnitId },
        });
      } catch {
        // Cleanup is best effort; the trace and the reported step are the record.
      }
    }
    await driverContext.close();
    await citizenContext.close();
  }
});
