import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnlaces } from '../src/shared/enlaces';
import { loadConfig } from './helpers';

const { stores, products } = loadConfig();

describe('enlaces.md → config', () => {
  test('config/stores.json está sincronizado con docs/enlaces.md (correr `npm run config`)', () => {
    const md = readFileSync(join(__dirname, '..', 'docs', 'enlaces.md'), 'utf-8');
    expect(parseEnlaces(md, stores)).toEqual(products);
  });

  test('agrupa por encabezado, asigna tienda por dominio y lee el contenido opcional', () => {
    const md = [
      '# Crema corporal',
      'Enlaces Flora y Fauna',
      'https://www.florayfauna.pe/crema-x/p (200 ml)',
      '',
      'Enlaces Dermashop',
      'https://dermashop.pe/products/crema-y',
      '# Jabón',
      'https://inkafarma.pe/producto/jabon/123 (90 g)',
    ].join('\n');
    expect(parseEnlaces(md, stores)).toEqual([
      {
        grupo: 'Crema corporal',
        items: [
          { store: 'florayfauna', url: 'https://www.florayfauna.pe/crema-x/p', contenido: { valor: 200, unidad: 'ml' } },
          { store: 'dermashop', url: 'https://dermashop.pe/products/crema-y' },
        ],
      },
      { grupo: 'Jabón', items: [{ store: 'inkafarma', url: 'https://inkafarma.pe/producto/jabon/123', contenido: { valor: 90, unidad: 'g' } }] },
    ]);
  });

  test('errores claros: URL sin grupo, dominio desconocido, contenido inválido', () => {
    expect(() => parseEnlaces('https://dermashop.pe/products/x', stores)).toThrow(/fuera de un grupo/);
    expect(() => parseEnlaces('# G\nhttps://otra.pe/x', stores)).toThrow(/no corresponde a ninguna tienda/);
    expect(() => parseEnlaces('# G\nhttps://dermashop.pe/products/x (grande)', stores)).toThrow(/no reconocido/);
  });
});
