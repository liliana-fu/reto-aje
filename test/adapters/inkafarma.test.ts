import { InkafarmaAdapter, mapObject } from '../../src/scrapers/adapters/inkafarma';
import { ScrapingError } from '../../src/shared/errors';
import { fixture, mockFetch, storeConfig, target } from '../helpers';

const URL_ENLACE = 'https://inkafarma.pe/producto/protector-solar-eucerin-oil-control-toque-seco-fps/009064';

afterEach(() => jest.restoreAllMocks());

describe('InkafarmaAdapter (Algolia getObject)', () => {
  test('consulta el objectID de la URL con las cabeceras de Algolia y normaliza', async () => {
    const calls = mockFetch(() => fixture('inkafarma-object.json'));
    const [item] = await new InkafarmaAdapter(storeConfig('inkafarma')).extract([target('inkafarma', URL_ENLACE)]);

    expect(new URL(calls[0].url).pathname).toBe('/1/indexes/products/009064');
    expect(new URL(calls[0].url).host).toBe('15w622laq4-dsn.algolia.net');
    expect(calls[0].init?.headers).toMatchObject({ 'X-Algolia-Application-Id': '15W622LAQ4' });
    expect(item).toMatchObject({
      producto: 'Protector Solar Facial en Gel Crema Eucerin Oil Control FPS50+',
      tienda: 'Inkafarma',
      precio: 89.9, // pricePromo tiene prioridad sobre priceList (119.9)
      contenido: '50 ml', // de presentation "FRASCO 50 ML"
      precioPor100: 179.8,
      stock: 'Disponible',
      url: URL_ENLACE,
    });
  });

  test('objectID inexistente (404 de Algolia) → ScrapingError', async () => {
    mockFetch(() => new Response('{"message":"ObjectID does not exist","status":404}', { status: 404 }));
    await expect(
      new InkafarmaAdapter(storeConfig('inkafarma')).extract([target('inkafarma', 'https://inkafarma.pe/producto/x/999999')]),
    ).rejects.toThrow(ScrapingError);
  });

  test('URL que no es de producto → ScrapingError', async () => {
    await expect(
      new InkafarmaAdapter(storeConfig('inkafarma')).extract([target('inkafarma', 'https://inkafarma.pe/categoria/x')]),
    ).rejects.toThrow(/\/producto\//);
  });

  test('usa priceList si no hay promo; sin precio → undefined', () => {
    expect(mapObject({ name: 'Crema X', priceList: 50, pricePromo: 0, validPrice: false })).toMatchObject({
      precio: 50,
      stock: 'Agotado',
    });
    expect(mapObject({ name: 'Crema X', priceList: 0 })).toBeUndefined();
  });
});
