import { asArray, asBoolean, asNumber, asString, isRecord, round2 } from '../../shared/parse';
import type { TargetItem } from '../../shared/types';
import { firstContenido } from '../../shared/units';
import { BaseAdapter, type ScrapedProduct } from './base';

const HANDLE_RE = /\/products\/([^/?#]+)/;

/**
 * Dermashop corre sobre Shopify. Para cada URL de producto se consulta
 * /products/<handle>.js, que (a diferencia de .json) incluye `available` por
 * variante. Los precios de .js vienen en céntimos.
 */
export class DermashopAdapter extends BaseAdapter {
  protected async scrape(item: TargetItem): Promise<ScrapedProduct> {
    const url = this.parseUrl(item.url);
    const handle = HANDLE_RE.exec(url.pathname)?.[1];
    if (!handle) throw this.fail(`No se encontró el handle de producto en ${item.url}`, item.url);

    const endpoint = `${url.origin}/products/${handle}.js`;
    const data = await this.request(endpoint);
    const product = mapProduct(data, url.searchParams.get('variant'));
    if (!product) throw this.fail(`Formato inesperado de Shopify en ${endpoint}`, item.url);
    return product;
  }
}

export function mapProduct(data: unknown, variantId: string | null): ScrapedProduct | undefined {
  if (!isRecord(data)) return undefined;
  const title = asString(data.title).trim();
  const variants = asArray(data.variants).filter(isRecord);
  const variant =
    (variantId ? variants.find((v) => String(v.id) === variantId) : undefined) ??
    variants.find((v) => asBoolean(v.available)) ??
    variants[0];
  const cents = variant ? asNumber(variant.price) : undefined;
  if (!title || !variant || cents === undefined || cents <= 0) return undefined;

  const variantTitle = asString(variant.title).trim();
  const hasVariantName = variants.length > 1 && variantTitle !== '' && variantTitle !== 'Default Title';
  return {
    producto: hasVariantName ? `${title} - ${variantTitle}` : title,
    precio: round2(cents / 100),
    stock: asBoolean(variant.available) ? 'Disponible' : 'Agotado',
    contenido: firstContenido(hasVariantName ? variantTitle : undefined, title),
  };
}
