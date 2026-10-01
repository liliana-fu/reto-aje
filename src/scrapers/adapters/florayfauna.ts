import { asArray, asBoolean, asNumber, asString, isRecord, round2 } from '../../shared/parse';
import type { TargetItem } from '../../shared/types';
import { firstContenido } from '../../shared/units';
import { BaseAdapter, type ScrapedProduct } from './base';

const SLUG_RE = /^\/([^/]+)\/p\/?$/;
const DEFAULT_IGV = 0.18;

/**
 * Flora y Fauna corre sobre VTEX. Para cada URL /<slug>/p se consulta
 * /api/catalog_system/pub/products/search/<slug>/p (un producto no existente
 * devuelve 200 con []).
 *
 * Ojo: `commertialOffer.Price` viene SIN IGV. El precio de la web es Price + Tax
 * (verificado: Badger 100.85 + 18.15 = 119.00; aceite de ricino 25.42 + 4.58 = 30.00).
 */
export class FloraYFaunaAdapter extends BaseAdapter {
  protected async scrape(item: TargetItem): Promise<ScrapedProduct> {
    const url = this.parseUrl(item.url);
    const slug = SLUG_RE.exec(url.pathname)?.[1];
    if (!slug) throw this.fail(`La URL no tiene el formato /<producto>/p: ${item.url}`, item.url);

    const endpoint = `${url.origin}/api/catalog_system/pub/products/search/${slug}/p`;
    const data = await this.request(endpoint);
    if (!Array.isArray(data) || data.length === 0) throw this.fail(`Producto no encontrado en VTEX: ${slug}`, item.url);

    const igv = asNumber(this.store.params?.igvRate) ?? DEFAULT_IGV;
    const product = mapProduct(data[0], igv);
    if (!product) throw this.fail(`Producto sin precio en VTEX: ${slug}`, item.url);
    return product;
  }
}

/** Precio con IGV a partir de la oferta VTEX. */
export function shelfPrice(offer: Record<string, unknown>, igvRate: number): number | undefined {
  const price = asNumber(offer.Price);
  const tax = asNumber(offer.Tax) ?? 0;
  if (price !== undefined && price > 0 && tax > 0) return round2(price + tax);
  const base = [offer.Price, offer.PriceWithoutDiscount, offer.ListPrice]
    .map(asNumber)
    .find((n): n is number => n !== undefined && n > 0);
  return base === undefined ? undefined : round2(base * (1 + igvRate));
}

export function mapProduct(product: unknown, igvRate: number): ScrapedProduct | undefined {
  if (!isRecord(product)) return undefined;
  const name = asString(product.productName).trim();
  const sku = asArray(product.items).find(isRecord);
  const offers = asArray(sku?.sellers)
    .filter(isRecord)
    .map((s) => s.commertialOffer)
    .filter(isRecord);
  const offer = offers.find((o) => asBoolean(o.IsAvailable)) ?? offers[0];
  if (!name || !offer) return undefined;
  const precio = shelfPrice(offer, igvRate);
  if (precio === undefined) return undefined;

  const disponible = asBoolean(offer.IsAvailable) && (asNumber(offer.AvailableQuantity) ?? 0) > 0;
  return {
    producto: name,
    precio,
    stock: disponible ? 'Disponible' : 'Agotado',
    contenido: firstContenido(name, asString(sku?.name)),
  };
}
