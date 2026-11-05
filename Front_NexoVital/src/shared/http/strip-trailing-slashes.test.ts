import { describe, expect, it } from 'vitest';
import { stripTrailingSlashes } from '@/shared/http/strip-trailing-slashes';

describe('stripTrailingSlashes', () => {
  it('quita una o varias barras finales', () => {
    expect(stripTrailingSlashes('http://localhost:8080/')).toBe('http://localhost:8080');
    expect(stripTrailingSlashes('http://localhost:8080///')).toBe('http://localhost:8080');
  });

  it('deja intacta una URL sin barras finales', () => {
    expect(stripTrailingSlashes('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it('cubre los bordes: vacío y solo barras', () => {
    expect(stripTrailingSlashes('')).toBe('');
    expect(stripTrailingSlashes('/')).toBe('');
    expect(stripTrailingSlashes('///')).toBe('');
  });

  it('no toca una barra invertida: no es separador de URL', () => {
    expect(stripTrailingSlashes('C:\\api\\')).toBe('C:\\api\\');
  });

  it('una cadena larga de barras no degrada el tiempo (sin backtracking)', () => {
    const entrada = 'https://x.test' + '/'.repeat(20000);
    const inicio = performance.now();
    expect(stripTrailingSlashes(entrada)).toBe('https://x.test');
    expect(performance.now() - inicio).toBeLessThan(50);
  });
});
