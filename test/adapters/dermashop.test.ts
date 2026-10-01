import { DermashopAdapter, mapProduct } from '../../src/scrapers/adapters/dermashop';
import { ScrapingError } from '../../src/shared/errors';
import { fixture, mockFetch, storeConfig, target } from '../helpers';

const URL_ENLACE =
  'https://dermashop.pe/collections/proteccion-solar-facial/products/eucerin-sun-gel-crema-oil-control-toque-seco-spf50-50-ml';

afterEach(() => jest.restoreAllMocks());

describe('DermashopAdapter (Shopify /products/<handle>.js)', () => {
  test('consulta el .js del handle y normaliza (precio en céntimos)', async () => {
    const calls = mockFetch(() => fixture('dermashop-product.json'));
    const adapter = new DermashopAdapter(storeConfig('dermashop'));
    const [item] = await adapter.extract([target('dermashop', URL_ENLACE)]);

    expect(calls.map((c) => c.url)).toEqual([
      'https://dermashop.pe/products/eucerin-sun-gel-crema-oil-control-toque-seco-spf50-50-ml.js',
    ]);
    expect(item).toMatchObject({
      grupo: 'Protector solar facial',
      producto: 'Fotoprotector Eucerin Oil Control SPF 50 50 ml',
      tienda: 'Dermashop',
      precio: 119.9,
      moneda: 'PEN',
      contenido: '50 ml',
      precioPor100: 239.8,
      stock: 'Disponible',
      url: URL_ENLACE,
    });
    expect(adapter.raw).toHaveLength(1);
  });

  test('el contenido de la config tiene prioridad sobre el del nombre', async () => {
    mockFetch(() => fixture('dermashop-product.json'));
    const [item] = await new DermashopAdapter(storeConfig('dermashop')).extract([
      target('dermashop', URL_ENLACE, { contenido: { valor: 100, unidad: 'ml' } }),
    ]);
    expect(item).toMatchObject({ contenido: '100 ml', precioPor100: 119.9 });
  });

  test('respeta ?variant= y marca Agotado', () => {
    const data = {
      title: 'Base Coverage 30 ml',
      variants: [
        { id: 1, title: 'Claro', price: 8990, available: true },
        { id: 2, title: 'Medio', price: 8990, available: false },
      ],
    };
    expect(mapProduct(data, '2')).toMatchObject({ producto: 'Base Coverage 30 ml - Medio', precio: 89.9, stock: 'Agotado' });
    expect(mapProduct(data, null)).toMatchObject({ producto: 'Base Coverage 30 ml - Claro', stock: 'Disponible' });
  });

  test('producto inexistente (404) → ScrapingError', async () => {
    mockFetch(() => new Response('Not found', { status: 404 }));
    await expect(
      new DermashopAdapter(storeConfig('dermashop')).extract([target('dermashop', 'https://dermashop.pe/products/no-existe')]),
    ).rejects.toThrow(ScrapingError);
  });

  test('URL sin /products/<handle> → ScrapingError sin llamar a la red', async () => {
    const calls = mockFetch(() => ({}));
    await expect(
      new DermashopAdapter(storeConfig('dermashop')).extract([target('dermashop', 'https://dermashop.pe/collections/x')]),
    ).rejects.toThrow(/handle/);
    expect(calls).toHaveLength(0);
  });
});
