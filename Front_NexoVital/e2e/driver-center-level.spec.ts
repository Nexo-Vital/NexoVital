import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * End-to-end proof that the DRIVER console shows every aid center with its REAL
 * level, and that the level reacts live, without a reload.
 *
 * The bug: `/api/v1/mapa` carries no inventory, only the alert projection, so a
 * driver screen that reads the map alone derives "Sin declarar" for every center
 * and never shows CRITICO/ESTABLE. The citizen screen already merged the
 * inventory (EP-03); this locks the same source discipline into the driver.
 *
 * The level of a center is its WORST inventory traffic light and nothing else
 * (`centerLevel`): a shortage alert does not raise it. So the expected labels
 * are computed from each center's inventory, read from the backend itself, and
 * the live half moves a real traffic light: a platform administrator withdraws
 * stock (only administrators may) until one supply is at half of what the
 * center needs, the driver rail turns to "En alerta" with no reload, and a
 * donation of the same amount brings the center back to where it was.
 */

const API = 'http://localhost:5173/api/v1';
const DRIVER = { email: 'conductor1@nexovital.co', password: 'conductor123' };
/** Seeded platform administrator: the only role that may withdraw from any center. */
const ADMIN = { email: 'admin@nexovital.co', password: 'admin123' };

type Semaforo = 'ROJO' | 'AMARILLO' | 'VERDE' | 'COMPLETO';

interface CentroDto {
  id: string;
  nombre: string;
  tipo: string;
}

interface ItemDto {
  id: string;
  nombre?: string;
  disponible: number;
  requerido: number;
  semaforo: Semaforo;
}

const LEVEL_LABEL = {
  critical: 'Crítico',
  alert: 'En alerta',
  stable: 'Estable',
  complete: 'Completo',
} as const;

/** Signs in through the API and returns the bearer token. */
async function apiLogin(
  request: APIRequestContext,
  account: { email: string; password: string },
): Promise<string> {
  const response = await request.post(`${API}/sesiones`, { data: account });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { token: string }).token;
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

/**
 * The label the driver rail must show, computed from the backend: the worst
 * traffic light of the center's inventory (the same `centerLevel` rule), with
 * the precedence CRITICAL > ALERT > STABLE > COMPLETE. `null` for a center with
 * no declared supply, which this test does not assert.
 */
function expectedLabel(items: ItemDto[]): string | null {
  if (items.length === 0) {
    return null;
  }
  if (items.some((item) => item.semaforo === 'ROJO')) {
    return LEVEL_LABEL.critical;
  }
  if (items.some((item) => item.semaforo === 'AMARILLO')) {
    return LEVEL_LABEL.alert;
  }
  if (items.some((item) => item.semaforo === 'VERDE')) {
    return LEVEL_LABEL.stable;
  }
  return LEVEL_LABEL.complete;
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

/** Signs in through the real form and waits for the driver console + socket. */
async function loginAsDriver(page: Page): Promise<void> {
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
}

/** The rail row of a center, located by its full name. */
function centerRow(page: Page, fullName: string) {
  return page.getByRole('listitem').filter({ hasText: fullName }).first();
}

test('los centros del conductor muestran su estado real y reaccionan en vivo', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  const token = await apiLogin(request, DRIVER);
  const adminToken = await apiLogin(request, ADMIN);
  const centros = (await getCentros(request, token)).filter(
    (centro) => centro.tipo === 'CENTRO_ACOPIO',
  );

  // Expected state, straight from the backend, for every supply center.
  const expected = new Map<string, string>();
  // The target for the LIVE half: a center that is NOT in alert or critical now
  // (so "En alerta" is a real change) with a supply that can be taken to half.
  let target: CentroDto | undefined;
  let targetItem: ItemDto | undefined;
  let targetLabel = '';
  for (const centro of centros) {
    const inventario = await getInventario(request, token, centro.id);
    const label = expectedLabel(inventario);
    if (label === null) {
      continue;
    }
    expected.set(centro.nombre, label);
    if (target || (label !== LEVEL_LABEL.stable && label !== LEVEL_LABEL.complete)) {
      continue;
    }
    const candidate = inventario.find((entry) => withdrawalToAmber(entry) > 0);
    if (candidate) {
      target = centro;
      targetItem = candidate;
      targetLabel = label;
    }
  }
  console.log(`[nivel-conductor] expected=${JSON.stringify(Object.fromEntries(expected))}`);
  if (!target || !targetItem) {
    throw new Error(
      'no CENTRO_ACOPIO in Estable/Completo with a supply to withdraw is available to run the ' +
        'live scenario (restart the backend to get the seeded inventory back)',
    );
  }

  const targetId = target.id;
  const itemId = targetItem.id;
  const original = targetItem.disponible;
  const cantidad = withdrawalToAmber(targetItem);

  try {
    await loginAsDriver(page);

    // Every center shows its real level, not "Sin declarar".
    for (const [nombre, label] of expected) {
      await expect(centerRow(page, nombre)).toContainText(label, { timeout: 20_000 });
    }
    console.log('[nivel-conductor] every rail row matched the backend-computed level');

    // A driver may not withdraw stock: the server refuses it.
    const refused = await request.post(`${API}/centros-acopio/${targetId}/inventario/despacho`, {
      headers: auth(token),
      data: { itemId, cantidad },
    });
    expect(refused.status()).toBe(403);

    // Live: the administrator withdraws stock and the supply drops to AMARILLO.
    const despacho = await request.post(`${API}/centros-acopio/${targetId}/inventario/despacho`, {
      headers: auth(adminToken),
      data: { itemId, cantidad },
    });
    expect(despacho.status()).toBe(200);
    expect(((await despacho.json()) as ItemDto).semaforo).toBe('AMARILLO');
    console.log(
      `[nivel-conductor] despacho ${target.nombre} item=${targetItem.nombre ?? itemId} ` +
        `cantidad=${cantidad} -> AMARILLO`,
    );

    // The driver rail changes WITHOUT a reload.
    await expect(centerRow(page, target.nombre)).toContainText(LEVEL_LABEL.alert, {
      timeout: 20_000,
    });
    console.log(`[nivel-conductor] live: ${target.nombre} -> ${LEVEL_LABEL.alert} sin recargar`);

    // A donation of the same amount brings the center back to where it was.
    const cobertura = await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
      headers: auth(token),
      data: { itemId, cantidad },
    });
    expect(cobertura.ok()).toBeTruthy();

    await expect(centerRow(page, target.nombre)).toContainText(targetLabel, {
      timeout: 20_000,
    });
    console.log(`[nivel-conductor] cleanup: ${target.nombre} -> ${targetLabel}`);
  } finally {
    // Safety net: give back whatever is still missing if an assertion failed
    // mid-flight, so the next scenario finds the inventory as it was.
    const now = (await getInventario(request, token, targetId)).find(
      (entry) => entry.id === itemId,
    );
    const missing = now ? original - now.disponible : 0;
    if (missing > 0) {
      await request.post(`${API}/centros-acopio/${targetId}/inventario/donacion`, {
        headers: auth(token),
        data: { itemId, cantidad: missing },
      });
      console.log(`[nivel-conductor] safety cleanup donated ${missing}`);
    }
  }
});
