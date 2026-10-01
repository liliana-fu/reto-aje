import { asBoolean, asNumber, asString, isRecord } from '../../shared/parse';
import type { TargetItem } from '../../shared/types';
import { firstContenido } from '../../shared/units';
import { BaseAdapter, type ScrapedProduct } from './base';

const PRODUCT_RE = /^\/producto\/[^/]+\/([^/?#]+)/;
const ATTRIBUTES = 'name,brand,uri,presentation,priceList,pricePromo,validPrice';

/**
 * Inkafarma es una SPA en Angular: el HTML no trae productos y su API propia
 * exige un token de Cognito (403 sin él). El front lee el catálogo del índice
 * Algolia `products` con una clave search-only pública; el último segmento de
 * /producto/<slug>/<id> es el objectID, así que se consulta con getObject.
 */
export class InkafarmaAdapter extends BaseAdapter {
  protected async scrape(item: TargetItem): Promise<ScrapedProduct> {
    const url = this.parseUrl(item.url);
    const objectId = PRODUCT_RE.exec(url.pathname)?.[1];
    if (!objectId) throw this.fail(`La URL no tiene el formato /producto/<slug>/<id>: ${item.url}`, item.url);

    const appId = this.param('algoliaAppId');
    const index = this.param('algoliaIndex');
    const endpoint = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/${encodeURIComponent(objectId)}?attributesToRetrieve=${ATTRIBUTES}`;
    const data = await this.request(endpoint, {
      headers: {
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': this.param('algoliaApiKey'),
        Origin: url.origin,
        Referer: `${url.origin}/`,
      },
    });

    const product = mapObject(data);
    if (!product) throw this.fail(`Producto ${objectId} sin precio válido en Algolia`, item.url);
    return product;
  }

  private param(key: string): string {
    const v = this.store.params?.[key];
    if (typeof v !== 'string' || v === '') throw new Error(`Falta stores[inkafarma].params.${key} en la config`);
    return v;
  }
}

export function mapObject(data: unknown): ScrapedProduct | undefined {
  if (!isRecord(data)) return undefined;
  const name = asString(data.name).trim();
  const promo = asNumber(data.pricePromo) ?? 0;
  const list = asNumber(data.priceList) ?? 0;
  // pricePromo es el precio web vigente; priceWithCard (tarjeta Oh!) no se considera.
  const precio = promo > 0 ? promo : list;
  if (!name || precio <= 0) return undefined;

  return {
    producto: name,
    precio,
    // Algolia no expone stock; `validPrice` es el indicador de vendibilidad que usa el front.
    stock: asBoolean(data.validPrice) ? 'Disponible' : 'Agotado',
    // El tamaño suele venir solo en `presentation` ("FRASCO 50 ML").
    contenido: firstContenido(asString(data.presentation), name),
  };
}
