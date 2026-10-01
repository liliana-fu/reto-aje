/**
 * Filas del reporte: una por (grupo, tienda) y la alerta "MEJOR PRECIO" en el
 * menor precio por 100 ml/g del grupo, solo entre los disponibles.
 */
import type { ProductGroup, ProductPrice, StoreConfig } from '../shared/types';

export const HEADER = [
  'Producto / Categoría',
  'Tienda',
  'Precio (PEN)',
  'Precio x 100 ml/g',
  'Stock',
  'URL del producto',
  'Menor precio alerta',
] as const;

export const BEST_PRICE = 'MEJOR PRECIO';
export const EXTRACTION_ERROR = 'Error de extracción';
export const NOT_IN_STORE = 'No disponible en tienda';

export interface ReportRow {
  grupo: string;
  producto: string;
  tienda: string;
  precio: number | null;
  precioPor100: number | null;
  stock: ProductPrice['stock'] | typeof EXTRACTION_ERROR;
  url: string;
  alerta: typeof BEST_PRICE | '-';
}

export type Cell = string | number;

export interface BuildRowsInput {
  stores: StoreConfig[];
  products: ProductGroup[];
  /** Productos normalizados de las tiendas que terminaron OK. */
  items: ProductPrice[];
  failedStoreIds: Set<string>;
}

export function buildRows({ stores, products, items, failedStoreIds }: BuildRowsInput): ReportRow[] {
  const rows: ReportRow[] = [];

  for (const group of products) {
    const groupRows: ReportRow[] = [];
    for (const store of stores) {
      const targets = group.items.filter((i) => i.store === store.id);
      const base = { grupo: group.grupo, tienda: store.name, precio: null, precioPor100: null, alerta: '-' } as const;

      if (targets.length === 0) {
        groupRows.push({ ...base, producto: '', stock: NOT_IN_STORE, url: '' });
        continue;
      }
      for (const target of targets) {
        // Se cruza por (grupo, url): el scraper conserva la URL de enlaces.md.
        const scraped = failedStoreIds.has(store.id)
          ? undefined
          : items.find((p) => p.grupo === group.grupo && p.url === target.url);
        groupRows.push(
          scraped
            ? {
                ...base,
                producto: scraped.producto,
                precio: scraped.precio,
                precioPor100: scraped.precioPor100,
                stock: scraped.stock,
                url: scraped.url,
              }
            : { ...base, producto: target.nombre ?? '', stock: EXTRACTION_ERROR, url: target.url },
        );
      }
    }
    rows.push(...markBestPrice(groupRows));
  }
  return rows;
}

/** Marca el menor precio por 100 ml/g entre los disponibles (en empate, todos). */
function markBestPrice(rows: ReportRow[]): ReportRow[] {
  const prices = rows
    .filter((r) => r.stock === 'Disponible' && r.precioPor100 !== null)
    .map((r) => r.precioPor100 as number);
  if (prices.length === 0) return rows;
  const min = Math.min(...prices);
  return rows.map((r) => (r.stock === 'Disponible' && r.precioPor100 === min ? { ...r, alerta: BEST_PRICE } : r));
}

export function toSheetValues(rows: ReportRow[]): Cell[][] {
  return [
    [...HEADER],
    ...rows.map((r) => [
      r.producto ? `${r.grupo} — ${r.producto}` : r.grupo,
      r.tienda,
      r.precio ?? '',
      r.precioPor100 ?? '',
      r.stock,
      r.url,
      r.alerta,
    ]),
  ];
}
