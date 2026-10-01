import type { Context } from 'aws-lambda';
import { rawKey, resolveRunDate } from '../shared/dates';
import { logger } from '../shared/logger';
import { putJson } from '../shared/s3';
import type { ProductGroup, ScrapeInput, ScrapeResultOk, StoreSnapshot, TargetItem } from '../shared/types';
import { createAdapter } from './adapters';

/** Items de la config que corresponden a una tienda, con su grupo. */
export function targetsFor(storeId: string, products: ProductGroup[]): TargetItem[] {
  return products.flatMap((g) => g.items.filter((i) => i.store === storeId).map((i) => ({ ...i, grupo: g.grupo })));
}

/**
 * Una iteración del Map: visita solo las URLs de la tienda, guarda raw + normalizado
 * en s3://<bucket>/raw/YYYY/MM/DD/<tienda>.json (se sobrescribe al re-ejecutar)
 * y devuelve un resumen pequeño para Step Functions.
 */
export async function handler(event: ScrapeInput, context?: Context): Promise<ScrapeResultOk> {
  if (context) logger.addContext(context);
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) throw new Error('BUCKET_NAME no está configurado');

  const { store } = event;
  const date = resolveRunDate(event);
  const targets = targetsFor(store.id, event.products);
  logger.appendKeys({ store: store.id, date });
  logger.info('Iniciando extracción', { urls: targets.map((t) => t.url) });

  const adapter = createAdapter(store);
  const items = await adapter.extract(targets);

  const key = rawKey(date, store.id);
  const snapshot: StoreSnapshot = {
    store: store.id,
    tienda: store.name,
    date,
    extraidoEn: new Date().toISOString(),
    itemsCount: items.length,
    normalized: items,
    raw: adapter.raw,
  };
  await putJson(bucket, key, snapshot);

  logger.info('Extracción completada', { itemsCount: items.length, s3Key: key, items });
  return { store: store.id, status: 'OK', s3Key: key, itemsCount: items.length };
}
