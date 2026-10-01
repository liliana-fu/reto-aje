import { handler, targetsFor } from '../src/scrapers/handler';
import { ScrapingError } from '../src/shared/errors';
import { putJson } from '../src/shared/s3';
import { fixture, loadConfig, mockFetch, storeConfig } from './helpers';

jest.mock('../src/shared/s3', () => ({ putJson: jest.fn() }));
const putJsonMock = jest.mocked(putJson);
const { products } = loadConfig();

beforeEach(() => {
  process.env.BUCKET_NAME = 'test-bucket';
  putJsonMock.mockReset();
});
afterEach(() => jest.restoreAllMocks());

describe('scraper handler', () => {
  test('targetsFor toma solo las URLs de la tienda, con su grupo', () => {
    expect(targetsFor('inkafarma', products)).toEqual([
      {
        grupo: 'Protector solar facial',
        store: 'inkafarma',
        url: 'https://inkafarma.pe/producto/protector-solar-eucerin-oil-control-toque-seco-fps/009064',
      },
    ]);
  });

  test('guarda raw + normalizado con clave idempotente del día (hora Lima)', async () => {
    mockFetch(() => fixture('florayfauna-product.json'));
    // 02:00 UTC del 2 de octubre = 21:00 del 1 de octubre en Lima
    const result = await handler({ store: storeConfig('florayfauna'), products, startTime: '2026-10-02T02:00:00.000Z' });

    expect(result).toEqual({ store: 'florayfauna', status: 'OK', s3Key: 'raw/2026/10/01/florayfauna.json', itemsCount: 1 });
    expect(putJsonMock).toHaveBeenCalledWith(
      'test-bucket',
      'raw/2026/10/01/florayfauna.json',
      expect.objectContaining({
        store: 'florayfauna',
        tienda: 'Flora y Fauna',
        date: '2026-10-01',
        normalized: [expect.objectContaining({ precio: 119, precioPor100: 100.85 })],
      }),
    );
  });

  test('fecha explícita tiene prioridad', async () => {
    mockFetch(() => fixture('florayfauna-product.json'));
    const result = await handler({ store: storeConfig('florayfauna'), products, date: '2026-01-15' });
    expect(result.s3Key).toBe('raw/2026/01/15/florayfauna.json');
  });

  test('una URL inválida hace fallar la tienda y no escribe en S3', async () => {
    mockFetch(() => new Response('Not found', { status: 404 }));
    await expect(handler({ store: storeConfig('dermashop'), products, date: '2026-10-01' })).rejects.toThrow(ScrapingError);
    expect(putJsonMock).not.toHaveBeenCalled();
  });

  test('tienda sin adapter falla', async () => {
    await expect(
      handler({ store: { id: 'desconocida', name: 'X', baseUrl: 'https://x' }, products, date: '2026-10-01' }),
    ).rejects.toThrow(/No existe adapter/);
  });
});
