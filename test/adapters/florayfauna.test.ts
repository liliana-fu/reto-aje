import { FloraYFaunaAdapter, mapProduct, shelfPrice } from '../../src/scrapers/adapters/florayfauna';
import { ScrapingError } from '../../src/shared/errors';
import { fixture, mockFetch, storeConfig, target } from '../helpers';

const URL_ENLACE = 'https://www.florayfauna.pe/bloqueador-solar-mineral-diario-spf-30-badger/p';

afterEach(() => jest.restoreAllMocks());

describe('FloraYFaunaAdapter (VTEX catalog_system)', () => {
  test('consulta por slug, suma IGV y usa el contenido de la config', async () => {
    const calls = mockFetch(() => fixture('florayfauna-product.json'));
    const [item] = await new FloraYFaunaAdapter(storeConfig('florayfauna')).extract([
      target('florayfauna', URL_ENLACE, { contenido: { valor: 118, unidad: 'ml' } }),
    ]);

    expect(calls[0].url).toBe(
      'https://www.florayfauna.pe/api/catalog_system/pub/products/search/bloqueador-solar-mineral-diario-spf-30-badger/p',
    );
    expect(item).toMatchObject({
      producto: 'Bloqueador Solar mineral diario SPF 30 Badger',
      tienda: 'Flora y Fauna',
      precio: 119, // Price 100.85 + Tax 18.15
      contenido: '118 ml',
      precioPor100: 100.85,
      stock: 'Disponible',
      url: URL_ENLACE,
    });
  });

  test('sin contenido en config ni en el nombre → precioPor100 null', async () => {
    mockFetch(() => fixture('florayfauna-product.json'));
    const [item] = await new FloraYFaunaAdapter(storeConfig('florayfauna')).extract([target('florayfauna', URL_ENLACE)]);
    expect(item).toMatchObject({ contenido: '', precioPor100: null });
  });

  test('VTEX responde [] para un producto inexistente → ScrapingError', async () => {
    mockFetch(() => []);
    await expect(
      new FloraYFaunaAdapter(storeConfig('florayfauna')).extract([target('florayfauna', 'https://www.florayfauna.pe/no-existe/p')]),
    ).rejects.toThrow(ScrapingError);
  });

  test('precio de góndola: aplica la tasa si Tax no viene', () => {
    expect(shelfPrice({ Price: 100, Tax: 0 }, 0.18)).toBe(118);
    expect(shelfPrice({ Price: 0, ListPrice: 50 }, 0.18)).toBe(59);
    expect(shelfPrice({ Price: 0, ListPrice: 0 }, 0.18)).toBeUndefined();
  });

  test('stock Agotado cuando no hay cantidad disponible', () => {
    const product = {
      productName: 'Jabón X 100g',
      items: [{ sellers: [{ commertialOffer: { Price: 10, Tax: 1.8, AvailableQuantity: 0, IsAvailable: false } }] }],
    };
    expect(mapProduct(product, 0.18)).toMatchObject({ stock: 'Agotado', precio: 11.8, contenido: { valor: 100, unidad: 'g' } });
  });
});
