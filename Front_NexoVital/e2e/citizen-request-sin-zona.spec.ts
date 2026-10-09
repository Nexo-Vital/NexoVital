import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { type APIResponse, expect, test } from '@playwright/test';

/**
 * End-to-end proof that asking for an ambulance NO LONGER depends on an affected
 * zone: with ZERO emergencies reported, the citizen asks and the notification
 * reaches ALL five seeded units, then exactly one accepts and the other four stay
 * available (the professor's "all ambulances accept and only one wins").
 *
 * Runs against the REAL stack (Vite on :5173 proxying /api and /ws to the backend
 * on :8080). No mocks: every assertion reads the UI or a real HTTP response.
 *
 * ORDERING. The backend never re-delivers a broadcast: `POST /solicitudes` fans
 * the PENDIENTE frame out to each notified driver at creation time. All five
 * drivers must be signed in and subscribed BEFORE the citizen asks, so every
 * driver context opens first and the citizen opens last.
 */

const BASE_URL = 'http://localhost:5173';
const API = `${BASE_URL}/api/v1`;

/**
 * Auth key, copied from src/services/apiClient.ts (TOKEN_KEY). The app keeps the
 * session in `sessionStorage` (one session per tab), never in `localStorage`.
 */
const TOKEN_KEY = 'nexovital.token';

const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
/** The five seeded drivers, one per unit ABC101..ABC505 (Back_NexoVital DataSeeder). */
const DRIVERS = [
  { email: 'conductor1@nexovital.co', password: 'conductor123' },
  { email: 'conductor2@nexovital.co', password: 'conductor123' },
  { email: 'conductor3@nexovital.co', password: 'conductor123' },
  { email: 'conductor4@nexovital.co', password: 'conductor123' },
  { email: 'conductor5@nexovital.co', password: 'conductor123' },
];

interface AmbulanciaDto {
  id: string;
  placa: string;
  estado: string;
  ubicacion: { lat: number; lng: number };
  zona: string;
}

/** An isolated real browser session with the citizen's seeded geolocation. */
function newIsolatedContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    permissions: ['geolocation'],
    geolocation: { latitude: 4.728, longitude: -74.078 },
  });
}

/** Signs in through the real form. */
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

/** Signs in as a driver, waits for the console plus its socket and connects. */
async function loginAsDriver(
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

/** Current bearer token the app keeps for this page's session (per-tab `sessionStorage`). */
async function bearer(page: Page): Promise<string> {
  const token = await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();
  return token as string;
}

/** The unit a driver's `/mia` resolves to. */
async function myUnit(page: Page, token: string): Promise<string> {
  const response = (await page.request.get(`${API}/flota/ambulancias/mia`, {
    headers: { Authorization: `Bearer ${token}` },
  })) as APIResponse;
  expect(response.ok()).toBeTruthy();
  const mia = (await response.json()) as AmbulanciaDto | null;
  expect(mia?.id).toBeTruthy();
  return mia?.id as string;
}

/** Reads the fleet read-model with the given token. */
async function getFleet(page: Page, token: string): Promise<AmbulanciaDto[]> {
  const response = await page.request.get(`${API}/flota/ambulancias`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as AmbulanciaDto[];
}

test('sin emergencias: el ciudadano pide y las cinco unidades reciben la notificacion', async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const contexts: BrowserContext[] = [];
  try {
    // 1. All five drivers first: every one is subscribed before the broadcast.
    const driverPages: Page[] = [];
    const unitIds: string[] = [];
    for (const account of DRIVERS) {
      const context = await newIsolatedContext(browser);
      contexts.push(context);
      const page = await context.newPage();
      await loginAsDriver(page, account);
      driverPages.push(page);
      unitIds.push(await myUnit(page, await bearer(page)));
    }
    expect(new Set(unitIds).size).toBe(5);

    // 2. Citizen last. NO zone is reported: the request must stand on its own.
    const citizenContext = await newIsolatedContext(browser);
    contexts.push(citizenContext);
    const citizenPage = await citizenContext.newPage();
    await login(citizenPage, CITIZEN);
    await expect(citizenPage.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
      timeout: 30_000,
    });
    // The map is loaded (its centers arrived) and still NO emergency was reported.
    await expect(citizenPage.getByRole('button', { name: /Acopio/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    const [requestResponse] = await Promise.all([
      citizenPage.waitForResponse(
        (response: Response) =>
          response.url().includes('/api/v1/solicitudes') && response.request().method() === 'POST',
      ),
      citizenPage.getByRole('button', { name: 'Pedir ambulancia' }).click(),
    ]);
    expect(requestResponse.status()).toBe(201);
    const request = (await requestResponse.json()) as {
      id: string;
      emergenciaId: string | null;
      estado: string;
      ambulanciasNotificadas: string[];
      ubicacion: { lat: number; lng: number };
    };
    console.log(
      `[sin-zona] solicitud=${request.id} notificadas=${request.ambulanciasNotificadas.length} ` +
        `ubicacion=${JSON.stringify(request.ubicacion)}`,
    );

    // The request is standalone: no emergency, all five units notified, and the
    // citizen's own pickup point travelled with it.
    expect(request.estado).toBe('PENDIENTE');
    expect(request.emergenciaId ?? null).toBeNull();
    expect(request.ambulanciasNotificadas).toHaveLength(5);
    for (const id of unitIds) {
      expect(request.ambulanciasNotificadas).toContain(id);
    }
    expect(request.ubicacion).toEqual({ lat: 4.728, lng: -74.078 });

    // 3. EVERY driver received the card, and it shows where to go: the pickup
    //    coordinates and the distance from the driver's own unit.
    for (const page of driverPages) {
      const card = page.getByRole('region', { name: 'Solicitud de ambulancia' });
      await expect(card).toBeVisible({ timeout: 25_000 });
      // A citizen request points at no emergency: the row is left out.
      await expect(card.getByText('Emergencia', { exact: true })).toHaveCount(0);
      await expect(card.getByText('4.7280, -74.0780')).toBeVisible();
      await expect(card.getByText(/km/)).toBeVisible();
    }
    console.log('[sin-zona] las 5 unidades muestran la tarjeta con punto de recogida y distancia');

    // 4. One unit accepts; the other four stay available.
    const winnerPage = driverPages[0];
    const winnerCard = winnerPage.getByRole('region', { name: 'Solicitud de ambulancia' });
    const [acceptResponse] = await Promise.all([
      winnerPage.waitForResponse(
        (response: Response) =>
          response.url().includes('/accept') && response.request().method() === 'POST',
      ),
      winnerCard.getByRole('button', { name: 'Aceptar solicitud' }).click(),
    ]);
    expect(acceptResponse.status()).toBe(200);
    const accepted = (await acceptResponse.json()) as {
      ganador: boolean;
      solicitud: { ambulanciaAsignadaId: string | null };
    };
    expect(accepted.ganador).toBe(true);
    expect(accepted.solicitud.ambulanciaAsignadaId).toBe(unitIds[0]);
    await expect(winnerPage.getByText('Solicitud aceptada')).toBeVisible({ timeout: 15_000 });

    const winnerToken = await bearer(winnerPage);
    const fleet = await getFleet(winnerPage, winnerToken);
    expect(fleet.find((unit) => unit.id === unitIds[0])?.estado).toBe('EN_MISION');
    for (const id of unitIds.slice(1)) {
      expect(fleet.find((unit) => unit.id === id)?.estado).toBe('DISPONIBLE');
    }
    console.log(`[sin-zona] ${unitIds[0]} acepto; las otras cuatro siguen DISPONIBLE`);

    // 5. Leave the state clean: declare the arrival, then finish (EP-04.F2.US8).
    await winnerPage.request.post(`${API}/solicitudes/${request.id}/llegada`, {
      headers: { Authorization: `Bearer ${winnerToken}` },
      data: { ambulanciaId: unitIds[0] },
    });
    const finish = await winnerPage.request.post(`${API}/solicitudes/${request.id}/finalizar`, {
      headers: { Authorization: `Bearer ${winnerToken}` },
      data: { ambulanciaId: unitIds[0] },
    });
    expect(finish.ok()).toBeTruthy();
  } finally {
    for (const context of contexts) {
      await context.close();
    }
  }
});
