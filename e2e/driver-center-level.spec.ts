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
 * The expected labels are computed from the backend itself (centers + each
 * center's inventory), so the test asserts the UI against the real state instead
 * of a hardcoded seed that another scenario could have moved. The live half
 * drives the real scarcity cycle (over-stock despacho -> persisted alert) and
 * observes the driver rail change with no reload.
 */

const API = 'http://localhost:5173/api/v1';
const DRIVER = { email: 'conductor1@nexovital.co', password: 'conductor123' };

/** Extra units over the available stock to force the 409. */
const EXCESO = 5;

type Semaforo = 'ROJO' | 'AMARILLO' | 'VERDE';

interface AlertaDto {
  itemId: string;
  faltante: number;
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
  disponible: number;
  requerido: number;
  semaforo: Semaforo;
}

const LEVEL_LABEL = {
  critical: 'Crítico',
  alert: 'En alerta',
  stable: 'Estable',
  none: 'Sin declarar',
} as const;

/** Signs in through the API and returns the bearer token. */
async function apiLogin(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API}/sesiones`, { data: DRIVER });
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
 * The label the driver rail must show, computed from the backend: worst item
 * traffic light folded with the active alert (the same `centerLevel` rule), with
 * the same precedence CRITICAL > ALERT > STABLE > not-declared.
 */
function expectedLabel(centro: CentroDto, items: ItemDto[]): string {
  const hasAlert = (centro.alertasActivas ?? 0) > 0 || centro.alerta != null;
  if (items.some((item) => item.semaforo === 'ROJO')) {
    return LEVEL_LABEL.critical;
  }
  if (hasAlert || items.some((item) => item.semaforo === 'AMARILLO')) {
    return LEVEL_LABEL.alert;
  }
  if (items.some((item) => item.semaforo === 'VERDE')) {
    return LEVEL_LABEL.stable;
  }
  return LEVEL_LABEL.none;
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

  const token = await apiLogin(request);
  const centros = await getCentros(request, token);

  // Expected state, straight from the backend, for every supply center.
  const expected = new Map<string, string>();
  for (const centro of centros) {
    if (centro.tipo !== 'CENTRO_ACOPIO') {
      continue;
    }
    expected.set(
      centro.nombre,
      expectedLabel(centro, await getInventario(request, token, centro.id)),
    );
  }
  console.log(`[nivel-conductor] expected=${JSON.stringify(Object.fromEntries(expected))}`);

  // The target for the LIVE half: currently STABLE, with stock to overshoot.
  let target: CentroDto | undefined;
  let targetItem: ItemDto | undefined;
  for (const centro of centros) {
    if (centro.tipo !== 'CENTRO_ACOPIO' || expected.get(centro.nombre) !== LEVEL_LABEL.stable) {
      continue;
    }
    const inventario = await getInventario(request, token, centro.id);
    const withStock = inventario.find((entry) => entry.disponible > 0);
    if (withStock) {
      target = centro;
      targetItem = withStock;
      break;
    }
  }
  if (!target || !targetItem) {
    throw new Error('no STABLE CENTRO_ACOPIO with stock is available to run the live scenario');
  }

  try {
    await loginAsDriver(page);

    // Every center shows its real level, not "Sin declarar".
    for (const [nombre, label] of expected) {
      await expect(centerRow(page, nombre)).toContainText(label, { timeout: 20_000 });
    }
    console.log('[nivel-conductor] every rail row matched the backend-computed level');

    // Live: ask for more than exists -> 409 and a persisted alert.
    const pedido = targetItem.disponible + EXCESO;
    const despacho = await request.post(`${API}/centros-acopio/${target.id}/inventario/despacho`, {
      headers: auth(token),
      data: { itemId: targetItem.id, cantidad: pedido },
    });
    expect(despacho.status()).toBe(409);
    expect(await despacho.text()).toContain('STOCK_INSUFICIENTE');
    console.log(`[nivel-conductor] despacho pedido=${pedido} -> 409 STOCK_INSUFICIENTE`);

    // A one-unit donation emits the real inventory event; the center cannot cover
    // the demand yet, so the alert stays active and the driver rail must change
    // WITHOUT a reload.
    const partial = await request.post(`${API}/centros-acopio/${target.id}/inventario/donacion`, {
      headers: auth(token),
      data: { itemId: targetItem.id, cantidad: 1 },
    });
    expect(partial.ok()).toBeTruthy();

    await expect(centerRow(page, target.nombre)).toContainText(LEVEL_LABEL.alert, {
      timeout: 20_000,
    });
    console.log(`[nivel-conductor] live: ${target.nombre} -> ${LEVEL_LABEL.alert} sin recargar`);

    // Cover the shortfall the BACKEND reports and the row returns to STABLE.
    const [refreshed] = (await getCentros(request, token)).filter((c) => c.id === target.id);
    const faltante = refreshed?.alerta?.faltante;
    expect(faltante).toBeGreaterThan(0);
    const cobertura = await request.post(`${API}/centros-acopio/${target.id}/inventario/donacion`, {
      headers: auth(token),
      data: { itemId: refreshed?.alerta?.itemId ?? targetItem.id, cantidad: faltante },
    });
    expect(cobertura.ok()).toBeTruthy();

    await expect(centerRow(page, target.nombre)).toContainText(LEVEL_LABEL.stable, {
      timeout: 20_000,
    });
    console.log(`[nivel-conductor] cleanup: ${target.nombre} -> ${LEVEL_LABEL.stable}`);
  } finally {
    // Safety net: leave no active alert behind if an assertion failed mid-flight.
    const [leftover] = (await getCentros(request, token)).filter((c) => c.id === target.id);
    if (leftover?.alerta && leftover.alerta.faltante > 0) {
      await request.post(`${API}/centros-acopio/${target.id}/inventario/donacion`, {
        headers: auth(token),
        data: { itemId: leftover.alerta.itemId, cantidad: leftover.alerta.faltante },
      });
      console.log(`[nivel-conductor] safety cleanup donated faltante=${leftover.alerta.faltante}`);
    }
  }
});
