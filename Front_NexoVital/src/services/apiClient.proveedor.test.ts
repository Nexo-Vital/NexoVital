import { describe, expect, it } from 'vitest';
import { proveedorDeLogin } from '@/services/apiClient';

/**
 * Regla de ADR-0008: el login propio existe solo en desarrollo. Un build de
 * producción sin Firebase no cae al proveedor casero; falla en voz alta.
 */
describe('proveedorDeLogin', () => {
  it('usa el catálogo demo cuando el modo demo está activo, incluso con Firebase', () => {
    expect(proveedorDeLogin({ demo: true, firebase: true, desarrollo: false })).toBe('demo');
    expect(proveedorDeLogin({ demo: true, firebase: false, desarrollo: true })).toBe('demo');
  });

  it('usa Firebase cuando está configurado y no hay modo demo', () => {
    expect(proveedorDeLogin({ demo: false, firebase: true, desarrollo: false })).toBe('firebase');
    expect(proveedorDeLogin({ demo: false, firebase: true, desarrollo: true })).toBe('firebase');
  });

  it('solo cae al login local en un build de desarrollo sin Firebase', () => {
    expect(proveedorDeLogin({ demo: false, firebase: false, desarrollo: true })).toBe('local');
  });

  it('un build de producción sin Firebase no tiene proveedor: nunca usa el login local', () => {
    expect(proveedorDeLogin({ demo: false, firebase: false, desarrollo: false })).toBe('ninguno');
  });
});
