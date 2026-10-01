import { ScrapingError } from '../../shared/errors';
import { fetchJson, type FetchJsonOptions } from '../../shared/http';
import type { Contenido, ProductPrice, Stock, StoreConfig, TargetItem } from '../../shared/types';
import { formatContenido, precioPor100 } from '../../shared/units';

export interface StoreAdapter {
  /** Extrae precio y stock de cada URL objetivo de la tienda. Lanza ScrapingError si alguna falla. */
  extract(items: TargetItem[]): Promise<ProductPrice[]>;
  /** Respuestas crudas recibidas durante el último `extract`, para auditar en S3. */
  readonly raw: unknown[];
}

export interface ScrapedProduct {
  producto: string;
  precio: number;
  stock: Exclude<Stock, 'No disponible en tienda'>;
  /** Contenido detectado en la tienda; el de la config tiene prioridad. */
  contenido?: Contenido;
}

export abstract class BaseAdapter implements StoreAdapter {
  readonly raw: unknown[] = [];

  constructor(protected readonly store: StoreConfig) {}

  /** Extrae un único producto a partir de su URL de la tienda. */
  protected abstract scrape(item: TargetItem): Promise<ScrapedProduct>;

  async extract(items: TargetItem[]): Promise<ProductPrice[]> {
    const extraidoEn = new Date().toISOString();
    const out: ProductPrice[] = [];
    // Secuencial: pocas URLs por tienda y así no se dispara el rate limiting del sitio.
    for (const item of items) {
      const p = await this.scrapeItem(item);
      const contenido = item.contenido ?? p.contenido;
      out.push({
        grupo: item.grupo,
        producto: p.producto,
        tienda: this.store.name,
        precio: p.precio,
        moneda: 'PEN',
        contenido: formatContenido(contenido),
        precioPor100: precioPor100(p.precio, contenido),
        stock: p.stock,
        // Se conserva la URL de enlaces.md: el reporte cruza por (grupo, url).
        url: item.url,
        extraidoEn,
      });
    }
    return out;
  }

  /** Envuelve `scrape` para que todo error identifique la URL del producto. */
  private async scrapeItem(item: TargetItem): Promise<ScrapedProduct> {
    try {
      return await this.scrape(item);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ScrapingError(`${this.store.name} – ${item.url}: ${reason}`, {
        store: this.store.id,
        url: item.url,
        cause: err,
      });
    }
  }

  /** fetchJson que además registra la respuesta cruda. */
  protected async request(url: string, init: Omit<FetchJsonOptions, 'store'> = {}): Promise<unknown> {
    const data = await fetchJson(url, { ...init, store: this.store.id });
    this.raw.push({ url, data });
    return data;
  }

  protected fail(message: string, url: string): ScrapingError {
    return new ScrapingError(message, { store: this.store.id, url });
  }

  protected parseUrl(raw: string): URL {
    try {
      return new URL(raw);
    } catch (err) {
      throw new ScrapingError(`URL inválida: ${raw}`, { store: this.store.id, url: raw, cause: err });
    }
  }
}
