import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
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

/**
 * Auth keys, copied from src/services/apiClient.ts (TOKEN_KEY / SESSION_KEY). The app
 * keeps the session in `sessionStorage` (one session per tab), never in `localStorage`.
 */
const TOKEN_KEY = 'nexovital.token';
const SESSION_KEY = 'nexovital.session';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
const ADMIN_CENTRO = { email: 'rangel@nexovital.co', password: 'rangel123' };
const DRIVER = { email: 'conductor1@nexovital.co', password: 'conductor123' };

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

/**
 * Opens a driver console in its own browser session and leaves the driver
 * connected, so the citizen has somebody to ask.
 *
 * A request only reaches a unit that is available, connected and has signal
 * (EP-04.F2.US1), and a unit is disconnected when its driver's last realtime
 * session ends. The scenarios that ran before this file closed their drivers, so
 * without a connected one "Pedir ambulancia" would be disabled and the request
 * would answer 409. The caller closes the returned context when it is done.
 */
async function connectedDriver(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: 'http://localhost:5173',
    permissions: ['geolocation'],
    geolocation: { latitude: 4.728, longitude: -74.078 },
  });
  const page = await context.newPage();
  const realtime = page.waitForEvent('websocket', {
    predicate: (socket) => socket.url().includes('/ws'),
    timeout: 20_000,
  });
  await page.goto('/login');
  await page.fill('#login-email', DRIVER.email);
  await page.fill('#login-password', DRIVER.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('complementary', { name: 'Panel del conductor' })).toBeVisible({
    timeout: 30_000,
  });
  await realtime;

  // The buttons stay disabled until the console has read its unit: wait for one
  // of the two settled states, and press "Conectarse" only when disconnected.
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
  // Wait until the SERVER says the unit can receive a request (connected and
  // with signal), so the citizen never races the driver's first position report.
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
  return context;
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
  // EP-02.F1.US3: the type is required; the select is keyed by the UI enum.
  await dialog.getByLabel('Tipo de emergencia').selectOption('ACCIDENT');
  await dialog
    .getByLabel('Comentario')
    .fill('Reproducción E2E: zona afectada para habilitar la solicitud de ambulancia.');
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

/**
 * Withdraws the request this citizen just raised, through the same
 * `POST /solicitudes/{id}/cancelar` the "Cancelar solicitud" button calls. Best
 * effort: a body that is not a created request is left alone.
 */
async function cancelOwnRequest(page: Page, createdBody: string): Promise<void> {
  let requestId: string | undefined;
  try {
    requestId = (JSON.parse(createdBody) as { id?: string }).id;
  } catch {
    return;
  }
  const token = await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
  if (!requestId || !token) {
    return;
  }
  const cancelled = await page.request
    .post(`http://localhost:5173/api/v1/solicitudes/${requestId}/cancelar`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .catch(() => null);
  console.log(`[A] cleanup: POST /cancelar -> ${cancelled?.status() ?? 'sin respuesta'}`);
}

/**
 * The citizen legend must count the REAL fleet, not a front-side mock. The
 * rendered "Disponible", "Ocupada", "Fuera de servicio" and "Sin señal" rows are
 * compared against the backend's own `GET /api/v1/flota/ambulancias` response, read with the
 * CITIZEN's real token, so the assertion can never drift from the seed (no count
 * is hardcoded).
 *
 * The backend's domain states map onto the legend's unit buckets: DISPONIBLE is
 * "Disponible" and EN_MISION/EN_RUTA are "Ocupada". A unit that lost its signal
 * (`sinSenal`, EP-04.F1.US1) is drawn gray whatever its state, so it is counted
 * in "Sin señal" and in NONE of the others. A unit whose driver is disconnected
 * (`conectada: false`, EP-04.F2.US1) or that is in MANTENIMIENTO is "Fuera de
 * servicio" whatever its state. The four rows add up to the fleet.
 *
 * The fleet is LIVE: a unit can lose or recover its signal between the REST read
 * and the moment the legend is read (a driver of a previous scenario that
 * disconnected is marked 30 s later). So the whole comparison, REST read
 * included, is retried until both sides agree instead of comparing the legend
 * with a snapshot that may already be old.
 */
async function expectLegendMatchesBackend(page: Page): Promise<void> {
  const token = await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();

  const legend = page.getByRole('complementary', { name: 'Leyenda del mapa' });
  const legendCount = (label: string) =>
    legend.locator('li').filter({ hasText: label }).locator('b');

  let summary = '';
  await expect(async () => {
    const response = await page.request.get('http://localhost:5173/api/v1/flota/ambulancias', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBeTruthy();
    const fleet = (await response.json()) as Array<{
      estado: string;
      sinSenal?: boolean;
      conectada?: boolean;
    }>;

    const withSignal = fleet.filter((unit) => unit.sinSenal !== true);
    const noSignal = fleet.length - withSignal.length;
    const outOfService = withSignal.filter(
      (unit) => unit.conectada === false || unit.estado === 'MANTENIMIENTO',
    );
    const inService = withSignal.filter((unit) => !outOfService.includes(unit));
    const free = inService.filter((unit) => unit.estado === 'DISPONIBLE').length;
    const busy = inService.filter(
      (unit) => unit.estado === 'EN_MISION' || unit.estado === 'EN_RUTA',
    ).length;

    // A vacuous comparison would pass on an empty fleet; the backend must have units.
    expect(fleet.length).toBeGreaterThan(0);
    await expect(legendCount('Disponible')).toHaveText(String(free), { timeout: 1_000 });
    await expect(legendCount('Ocupada')).toHaveText(String(busy), { timeout: 1_000 });
    await expect(legendCount('Fuera de servicio')).toHaveText(String(outOfService.length), {
      timeout: 1_000,
    });
    await expect(legendCount('Sin señal')).toHaveText(String(noSignal), { timeout: 1_000 });
    // Every unit is accounted for in exactly one row: no mock inflates the total.
    expect(free + busy + outOfService.length + noSignal).toBe(fleet.length);

    summary =
      `Disponible=${free} Ocupada=${busy} Fuera de servicio=${outOfService.length} ` +
      `Sin señal=${noSignal} (backend total=${fleet.length})`;
  }).toPass({ timeout: 20_000 });

  console.log(`[A] fleet legend: ${summary}`);
}

/*
 * Both scenarios press "Pedir ambulancia", so both need a driver connected for
 * as long as they run. It lives in its own browser session, apart from the
 * citizen's `page`, and it is closed afterwards: closing it ends the driver's
 * realtime session, and the server disconnects the unit again.
 */
let driverContext: BrowserContext | null = null;

test.beforeEach(async ({ browser }) => {
  driverContext = await connectedDriver(browser);
});

test.afterEach(async () => {
  await driverContext?.close();
  driverContext = null;
});

test('Scenario A: a clean citizen login creates the request with 201 and no red error', async ({
  page,
}) => {
  const calls = recordApiCalls(page);
  await loginAsCitizen(page);

  // The legend is a view of the REAL fleet: compare its rows with the backend's
  // own /flota/ambulancias response instead of a hardcoded count.
  await expectLegendMatchesBackend(page);

  // Regression: "zonas afectadas" are point reports, never painted areas. The
  // backend still serves zone geometry through /api/v1/mapa, but the citizen map
  // must draw no zone polygon (`MapCanvas` no longer renders `.nv-zone-area`).
  await expect(page.locator('path.nv-zone-area')).toHaveCount(0);

  await reportAffectedZone(page);

  const response = await requestAmbulance(page);
  const body = await response.text();
  console.log(`[A] POST /api/v1/solicitudes -> ${response.status()} ${body}`);
  console.log(`[A] observed calls:\n${await describeCalls(calls)}`);

  try {
    expect(response.status()).toBe(201);
    // The request really opened: the search rail replaced the action rail.
    await expect(page.getByText('Buscando ambulancia')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(DENIED_MESSAGE)).toHaveCount(0);
  } finally {
    // Leave no open request behind. Nobody answers this one, and a request stays
    // PENDIENTE for its whole accept window: the next driver that connects gets
    // it back (EP-04.F2.US1) and it would take the card of a later scenario.
    await cancelOwnRequest(page, body);
  }
});

test('Scenario B: a foreign persisted token is never sent; the app states the session changed', async ({
  page,
}) => {
  const calls = recordApiCalls(page);
  await loginAsCitizen(page);
  await reportAffectedZone(page);

  const admin = await fetchCredentials(page, ADMIN_CENTRO);
  /*
   * Drop the admin's token and session into sessionStorage, where apiClient
   * keeps them, with the exact shape it persists. This is done from the SAME
   * document, so no `storage` event fires here: the real condition is the
   * in-memory citizen session surviving while the persisted token belongs to
   * another role. Since the session is per tab another tab can no longer cause
   * it, but the guard is kept as defence in depth and this proves it still holds.
   *
   * Before the fix the click travelled with the admin token and the backend
   * answered a misleading 403 ACCESO_DENEGADO. Now the screen detects the
   * desync first: it does NOT send, and states the honest session reason.
   */
  await page.evaluate(
    ({ tokenKey, sessionKey, token, session }) => {
      sessionStorage.setItem(tokenKey, token);
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
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
