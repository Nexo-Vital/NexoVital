import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * End-to-end proof that an aid center's level is the REAL backend state and
 * reacts live, without a page reload.
 *
 * The level of a center is its WORST inventory traffic light and nothing else
 * (`centerLevel`): a shortage alert does not raise it. So the scenario moves a
 * real traffic light against the running stack (Vite on :5173 proxying /api and
 * /ws to the backend on :8080):
 *
 *   1. the citizen screen (map pin AND rail chip) shows the center with the
 *      level its inventory has in the backend;
 *   2. a platform administrator withdraws stock (only administrators may; the
 *      citizen is refused with 403) until one supply is at half of what the
 *      center needs, which is AMARILLO, and the center turns to "En alerta"
 *      WITHOUT reloading;
 *   3. a donation of the same amount brings the center back to where it was,
 *      again without a reload.
 *
 * Setup and cleanup go through the REST context; every ASSERTION reads the UI.
 * The cleanup gives back exactly what was withdrawn, so the run leaves the
 * inventory as it found it.
 */

const API = 'http://localhost:5173/api/v1';
const CITIZEN = { email: 'ciudadano@nexovital.co', password: 'ciudadano123' };
/** Seeded platform administrator: the only role that may withdraw from any center. */
const ADMIN = { email: 'admin@nexovital.co', password: 'admin123' };

type Semaforo = 'ROJO' | 'AMARILLO' | 'VERDE' | 'COMPLETO';
type Level = 'critical' | 'alert' | 'stable' | 'complete';

interface CentroDto {
  id: string;
  nombre: string;
  tipo: string;
}

interface ItemDto {
  id: string;
  centroAcopioId: string;
  nombre: string;
  disponible: number;
  requerido: number;
  semaforo: Semaforo;
}

/** The chip text of each level (`CITIZEN_LEVEL_META`). */
const LEVEL_LABEL: Record<Level, string> = {
  critical: 'Crítico',
  alert: 'En alerta',
  stable: 'Estable',
  complete: 'Completo',
};

/**
 * The level the screen must show, computed from the backend: the worst traffic
 * light of the center's inventory, with the precedence CRITICAL > ALERT >
 * STABLE > COMPLETE. `null` for a center with no declared supply.
 */
function expectedLevel(items: ItemDto[]): Level | null {
  if (items.length === 0) {
    return null;
  }
  if (items.some((item) => item.semaforo === 'ROJO')) {
    return 'critical';
  }
  if (items.some((item) => item.semaforo === 'AMARILLO')) {
    return 'alert';
  }
  if (items.some((item) => item.semaforo === 'VERDE')) {
    return 'stable';
  }
  return 'complete';
}

/**
 * How many units to withdraw so the supply lands at HALF of what the center
 * needs, which is AMARILLO by the backend rule (35% <= available < 70%). Zero
 * when the supply cannot be used: no requirement, too small to split, more
 * stock than required (a donation could not bring it back), or already there.
 */
function withdrawalToAmber(item: ItemDto): number {
  if (item.requerido < 4 || item.disponible > item.requerido) {
    return 0;
  }
  const half = Math.floor(item.requerido / 2);
  return Math.max(0, item.disponible - half);
}

/** Signs in through the API and returns the bearer token. */
async function apiLogin(
  request: APIRequestContext,
  account: { email: string; password: string },
): Promise<string> {
  const response = await request.post(`${API}/sesiones`, { data: account });
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

test('el nivel del centro sube a En alerta y vuelve a su estado sin recargar', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const token = await apiLogin(request, CITIZEN);
  const adminToken = await apiLogin(request, ADMIN);
  const headers = auth(token);

  // Pick the target: a CENTRO_ACOPIO that is NOT in alert or critical now (so
  // "En alerta" is a real change) with a supply that can be taken to half.
  const centros = await getCentros(request, token);
  let target: CentroDto | undefined;
  let item: ItemDto | undefined;
  let initialLevel: Level | undefined;
  for (const centro of centros) {
    if (centro.tipo !== 'CENTRO_ACOPIO') {
      continue;
    }
    const inventario = await getInventario(request, token, centro.id);
    const level = expectedLevel(inventario);
    if (level !== 'stable' && level !== 'complete') {
      continue;
    }
    const candidate = inventario.find((entry) => withdrawalToAmber(entry) > 0);
    if (candidate) {
      target = centro;
      item = candidate;
      initialLevel = level;
      break;
    }
  }
  if (!target || !item || !initialLevel) {
    throw new Error(
      'no CENTRO_ACOPIO in Estable/Completo with a supply to withdraw is available to run this ' +
        'scenario (restart the backend to get the seeded inventory back)',
    );
  }

  const targetId = target.id;
  const targetName = target.nombre;
  const shortName = targetName.replace(/^Acopio\s+/, '');
  const itemId = item.id;
  const original = item.disponible;
  const cantidad = withdrawalToAmber(item);

  console.log(
    `[nivel] target=${targetName} nivel=${initialLevel} item=${item.nombre} ` +
      `disponible=${original} requerido=${item.requerido} retiro=${cantidad}`,
  );

  try {
    await loginAsCitizen(page);

    const row = railRowOf(page, targetName);
    const marker = markerOf(page, shortName);

    // The real snapshot is in: map AND panel show the backend's level.
    await expect(row).toContainText(LEVEL_LABEL[initialLevel], { timeout: 20_000 });
    await expect(marker).toHaveAttribute('data-nv-level', initialLevel);

    // A citizen may not withdraw stock: the server refuses it.
    const refused = await request.post(`${API}/centros-acopio/${targetId}/inventario/despacho`, {
      headers,
      data: { itemId, cantidad },
    });
    expect(refused.status()).toBe(403);

    // The administrator withdraws stock and the supply drops to AMARILLO.
    const despacho = await request.post(`${API}/centros-acopio/${targetId}/inventario/despacho`, {
      headers: auth(adminToken),
      data: { itemId, cantidad },
    });
    expect(despacho.status()).toBe(200);
    expect(((await despacho.json()) as ItemDto).semaforo).toBe('AMARILLO');
    console.log(`[nivel] despacho cantidad=${cantidad} -> 200 AMARILLO`);

    // The center changed WITHOUT a reload, in the rail chip and in the map pin.
    await expect(row).toContainText(LEVEL_LABEL.alert, { timeout: 20_000 });
    await expect(marker).toHaveAttribute('data-nv-level', 'alert');
    console.log('[nivel] observe En alerta on the map pin and the rail chip');

    // A donation of the same amount brings the center back to where it was.
    const cobertura = await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
      headers,
      data: { itemId, cantidad },
    });
    expect(cobertura.ok()).toBeTruthy();
    console.log(`[nivel] donated back cantidad=${cantidad}`);

    await expect(row).toContainText(LEVEL_LABEL[initialLevel], { timeout: 20_000 });
    await expect(marker).toHaveAttribute('data-nv-level', initialLevel);

    // And the backend agrees: the supply has what it had.
    const final = (await getInventario(request, token, targetId)).find(
      (entry) => entry.id === itemId,
    );
    expect(final?.disponible).toBe(original);
  } finally {
    // Safety net: give back whatever is still missing if an assertion failed
    // mid-flight, so the next scenario finds the inventory as it was.
    const now = (await getInventario(request, token, targetId)).find(
      (entry) => entry.id === itemId,
    );
    const missing = now ? original - now.disponible : 0;
    if (missing > 0) {
      await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
        headers,
        data: { itemId, cantidad: missing },
      });
      console.log(`[nivel] safety cleanup donated ${missing}`);
    }
  }
});
