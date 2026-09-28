import { describe, expect, it } from 'vitest';
import { centerLevel, centerNeedLabel, centerShortName } from '@/features/ciudadano/citizen-view';
import { resolveDriverAmbulanceId } from '@/features/conductor/driver-session';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import { DEMO_ACCOUNTS } from '@/mocks/demo-users';
import { MOCK_AMBULANCIAS, MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';

/**
 * Pins the demo data against the v2 mockup so a future edit cannot silently drop
 * a unit, rename a driver, or hardcode a center level.
 */
describe('demo fixtures parity with the v2 mockup', () => {
  it('ships the five mockup units, distinct and with plate/model/type', () => {
    expect(MOCK_AMBULANCIAS.map((unit) => unit.id)).toEqual([
      'A-07',
      'A-12',
      'A-03',
      'A-09',
      'A-15',
    ]);
    for (const unit of MOCK_AMBULANCIAS) {
      expect(unit.placa).toBeTruthy();
      expect(unit.modelo).toBeTruthy();
      expect(unit.tipo).toBeTruthy();
    }
    expect(new Set(MOCK_AMBULANCIAS.map((unit) => unit.placa)).size).toBe(5);
    expect(new Set(MOCK_AMBULANCIAS.map((unit) => unit.modelo)).size).toBe(5);
  });

  it('keeps A-07 literal from the mockup', () => {
    expect(MOCK_AMBULANCIAS.find((unit) => unit.id === 'A-07')).toMatchObject({
      placa: 'WNR-418',
      modelo: 'Renault Master 2023',
      tipo: 'Básica (TAB)',
      estado: 'AVAILABLE',
    });
  });

  it('splits availability as the mockup: three available, two busy', () => {
    const available = MOCK_AMBULANCIAS.filter((unit) => unit.estado === 'AVAILABLE').map(
      (u) => u.id,
    );
    expect(available).toEqual(['A-07', 'A-12', 'A-03']);

    const busy = MOCK_AMBULANCIAS.filter(
      (unit) => unit.estado === 'ASSIGNED' || unit.estado === 'EN_ROUTE',
    ).map((unit) => unit.id);
    expect(busy).toEqual(['A-09', 'A-15']);
  });

  /** The three mockup centers; the demo hospitals are front-only extras. */
  const ACOPIOS = MOCK_CENTROS_AYUDA.filter((centro) => centro.tipo !== 'HOSPITAL');

  it('derives each center level from its inventory, never hardcoded', () => {
    expect(ACOPIOS.map((centro) => [centerShortName(centro), centerLevel(centro)])).toEqual([
      ['Suba Norte', 'critical'],
      ['La Gaitana', 'alert'],
      ['Tibabuyes', 'stable'],
    ]);
    // Same derivation the map pin and the legend read, so they cannot disagree.
    expect(ACOPIOS.map(centroSemaforo)).toEqual(['RED', 'AMBER', 'GREEN']);
  });

  it('ships the front-only demo hospitals with no inventory and no traffic light', () => {
    const hospitals = MOCK_CENTROS_AYUDA.filter((centro) => centro.tipo === 'HOSPITAL');

    expect(hospitals.map((hospital) => hospital.id)).toEqual(['HOSP-SUBA', 'HOSP-KENNEDY']);
    for (const hospital of hospitals) {
      // HOSPITAL is NOT a contract TipoOrganizacion value: it is demo-only, so
      // it has no inventory and derives no level (see TipoCentroAyuda).
      expect(hospital.items).toEqual([]);
      expect(centerLevel(hospital)).toBeNull();
    }
  });

  it('writes each center need literally as the mockup, from its worst item', () => {
    expect(ACOPIOS.map((centro) => [centerShortName(centro), centerNeedLabel(centro)])).toEqual([
      ['Suba Norte', 'Faltante: agua potable'],
      ['La Gaitana', 'Faltante: alimentos'],
      ['Tibabuyes', 'Inventario suficiente'],
    ]);

    // Not hardcoded per center: emptying "Agua potable" makes it the scarcest
    // item instead of "Alimentos", so the label must follow the inventory.
    const gaitana = MOCK_CENTROS_AYUDA.find((centro) => centro.id === 'CA-LA-GAITANA');
    if (!gaitana) {
      throw new Error('missing demo center CA-LA-GAITANA');
    }
    const reshuffled = {
      ...gaitana,
      items: gaitana.items.map((item) =>
        item.id === 'INV-LG-2' ? { ...item, disponible: 0 } : item,
      ),
    };
    expect(centerNeedLabel(reshuffled)).toBe('Faltante: agua potable');
  });

  it('writes Suba Norte inventory and address literally from the mockup c7 card', () => {
    const suba = MOCK_CENTROS_AYUDA.find((centro) => centro.id === 'CA-SUBA-NORTE');
    // The address is the mockup's demo address; the units are the mockup's, not
    // invented. "Alimentos" (La Gaitana/Tibabuyes) has no mockup unit, so it is
    // left undefined rather than made up.
    expect(suba?.direccion).toBe('Cl. 145 #91-19');
    expect(
      suba?.items.map((item) => [item.nombre, item.disponible, item.requerido, item.unidad]),
    ).toEqual([
      ['Agua potable', 12, 60, 'bidones'],
      ['Kits de higiene', 18, 40, 'kits'],
      ['Medicamentos básicos', 32, 35, 'cajas'],
      ['Cobijas', 44, 50, 'unidades'],
    ]);
    const alimentos = MOCK_CENTROS_AYUDA.flatMap((centro) => centro.items).find(
      (item) => item.nombre === 'Alimentos',
    );
    expect(alimentos?.unidad).toBeUndefined();

    // The c8 stepper's more specific unit is the mockup's line 876 ("bidones de
    // 5 L"); it is declared, not derived, and only water carries one.
    const agua = suba?.items.find((item) => item.id === 'INV-SN-1');
    expect(agua?.unitDetail).toBe('bidones de 5 L');
  });

  it('matches every demo driver name to the unit it drives', () => {
    const drivers = DEMO_ACCOUNTS.filter((account) => account.rol === 'CONDUCTOR');
    expect(drivers).toHaveLength(5);

    for (const driver of drivers) {
      const unit = MOCK_AMBULANCIAS.find((item) => item.id === resolveDriverAmbulanceId(driver.id));
      expect(unit?.driverName).toBe(driver.nombre);
    }
  });
});
