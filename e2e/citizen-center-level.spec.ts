import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * End-to-end proof that an aid center's level is the REAL backend state and
 * reacts live, without a page reload.
 *
 * It drives the real scarcity cycle of EP-03.F1.US5 against the running stack
 * (Vite on :5173 proxying /api and /ws to the backend on :8080):
 *
 *   1. an over-stock dispatch answers 409 STOCK_INSUFICIENTE and persists an
 *      active shortage alert (the backend alert, not a front mock);
 *   2. the citizen screen (map pin AND rail chip) shows the center as
 *      "En alerta" while its inventory is still GREEN — so the level really
 *      folds the alert source in, and it changed WITHOUT reloading;
 *   3. donating exactly the shortfall the backend reports clears the alert and
 *      the center returns to "Estable", again without a reload.
 *
 * Setup and cleanup go through the REST context; every ASSERTION reads the UI.
 * The cleanup donates exactly the backend's own reported faltante, so the run
 * leaves no active alert behind (same discipline as
 * Back_NexoVital/scripts/prueba-funcional-alerta-escasez.ps1).
 */

const API = 'http://localhost:5173/api/v1';
const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };

/** Extra units over the available stock to force the 409. */
const EXCESO = 5;

interface AlertaDto {
  itemId: string;
  nombre: string;
  cantidadSolicitada: number;
  faltante: number;
  creadaEn: string;
}

interface CentroDto {
  id: string;
  nombre: string;
  tipo: string;
  alerta?: AlertaDto | null;
  alertasActivas?: number;
}

interface ItemDto {
  id: string;
  centroAcopioId: string;
  nombre: string;
  disponible: number;
  requerido: number;
  semaforo: 'ROJO' | 'AMARILLO' | 'VERDE';
}

/** Signs in through the API and returns the bearer token. */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/sesiones`, { data: CITIZEN });
  expect(response.ok()).toBeTruthy();
  const session = (await response.json()) as { token: string };
  return session.token;
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function getCentros(request: APIRequestContext, token: string): Promise<CentroDto[]> {
  const response = await request.get(`${API}/mapa`, { headers: auth(token) });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { centros: CentroDto[] }).centros;
}

async function getInventario(
  request: APIRequestContext,
  token: string,
  centroId: string,
): Promise<ItemDto[]> {
  const response = await request.get(`${API}/centros-acopio/${centroId}/inventario`, {
    headers: auth(token),
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ItemDto[];
}

/** Signs in through the real form and waits for the citizen action rail. */
async function loginAsCitizen(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', CITIZEN.email);
  await page.fill('#login-password', CITIZEN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Pedir ambulancia' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page
      .getByRole('complementary', { name: 'Panel del ciudadano' })
      .getByRole('heading', { name: 'Centros de acopio' }),
  ).toBeVisible({ timeout: 20_000 });
}

/** The map pin of a center, located by its short label (`centerShortName`). */
function markerOf(page: Page, shortName: string) {
  return page.locator('.nv-marker--center').filter({ hasText: shortName }).first();
}

/** The citizen rail row of a center, located by its full name. */
function railRowOf(page: Page, fullName: string) {
  const rail = page.getByRole('complementary', { name: 'Panel del ciudadano' });
  return rail.getByRole('button', { name: new RegExp(escapeRegExp(fullName)) });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('el nivel del centro sube a En alerta y vuelve a Estable sin recargar', async ({
  page,
  request,
}) => {
  const token = await apiLogin(request);
  const headers = auth(token);

  // Pick an ESTABLE target: a CENTRO_ACOPIO with no active alert whose every
  // inventory item is GREEN, so the only thing that can raise its level is the
  // alert source under test (a donation of one unit never worsens a light).
  const centros = await getCentros(request, token);
  let target: CentroDto | undefined;
  let item: ItemDto | undefined;
  for (const centro of centros) {
    if (centro.tipo !== 'CENTRO_ACOPIO' || centro.alerta || (centro.alertasActivas ?? 0) > 0) {
      continue;
    }
    const inventario = await getInventario(request, token, centro.id);
    const allGreen = inventario.every((entry) => entry.semaforo === 'VERDE');
    const withStock = inventario.find((entry) => entry.disponible > 0);
    if (allGreen && withStock) {
      target = centro;
      item = withStock;
      break;
    }
  }
  if (!target || !item) {
    throw new Error('no all-GREEN CENTRO_ACOPIO with stock is available to run this scenario');
  }

  const targetId = target.id;
  const targetName = target.nombre;
  const shortName = targetName.replace(/^Acopio\s+/, '');
  const itemId = item.id;
  const disponible = item.disponible;

  console.log(`[nivel] target=${targetName} item=${item.nombre} disponible=${disponible}`);

  try {
    await loginAsCitizen(page);

    const row = railRowOf(page, targetName);
    const marker = markerOf(page, shortName);

    // The real snapshot is in and the center starts ESTABLE in map AND panel.
    await expect(row).toContainText('Estable', { timeout: 20_000 });
    await expect(marker).toHaveAttribute('data-nv-level', 'stable');

    // Scarcity: ask for more than exists -> 409 and a persisted alert.
    const pedido = disponible + EXCESO;
    const despacho = await request.post(`${API}/centros-acopio/${targetId}/inventario/despacho`, {
      headers,
      data: { itemId, cantidad: pedido },
    });
    expect(despacho.status()).toBe(409);
    expect(await despacho.text()).toContain('STOCK_INSUFICIENTE');
    console.log(`[nivel] despacho pedido=${pedido} -> ${despacho.status()} STOCK_INSUFICIENTE`);

    // Trigger a real inventory event so the live alert projection refreshes: a
    // one-unit donation. It cannot cover the demand yet, so the alert stays active.
    const partial = await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
      headers,
      data: { itemId, cantidad: 1 },
    });
    expect(partial.ok()).toBeTruthy();

    // The center changed WITHOUT a reload: the level now folds the alert in.
    await expect(row).toContainText('En alerta', { timeout: 20_000 });
    await expect(marker).toHaveAttribute('data-nv-level', 'alert');
    console.log('[nivel] observe En alerta on the map pin and the rail chip');

    // Cover the shortfall the BACKEND reports, using its own number.
    const [refreshed] = (await getCentros(request, token)).filter(
      (centro) => centro.id === targetId,
    );
    const faltante = refreshed?.alerta?.faltante;
    expect(faltante).toBeGreaterThan(0);
    const cobertura = await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
      headers,
      data: { itemId: refreshed?.alerta?.itemId ?? itemId, cantidad: faltante },
    });
    expect(cobertura.ok()).toBeTruthy();
    console.log(`[nivel] donated the reported faltante=${faltante}`);

    // Back to ESTABLE, again without a reload.
    await expect(row).toContainText('Estable', { timeout: 20_000 });
    await expect(marker).toHaveAttribute('data-nv-level', 'stable');

    // And the backend agrees there is no active alert left.
    const [final] = (await getCentros(request, token)).filter((centro) => centro.id === targetId);
    expect(final?.alerta ?? null).toBeNull();
    expect(final?.alertasActivas ?? 0).toBe(0);
  } finally {
    // Safety net: if an assertion failed mid-flight, still leave no active alert.
    const [leftover] = (await getCentros(request, token)).filter(
      (centro) => centro.id === targetId,
    );
    if (leftover?.alerta && leftover.alerta.faltante > 0) {
      await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
        headers,
        data: { itemId: leftover.alerta.itemId, cantidad: leftover.alerta.faltante },
      });
      console.log(`[nivel] cleanup donated faltante=${leftover.alerta.faltante}`);
    }
  }
});
