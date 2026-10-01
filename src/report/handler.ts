import type { Context } from 'aws-lambda';
import { getGoogleConfig } from '../shared/config';
import { describeError } from '../shared/errors';
import { logger } from '../shared/logger';
import { isRecord } from '../shared/parse';
import { getJson } from '../shared/s3';
import type { FailedStore, ProductPrice, ReportInput, ReportOutput, StoreSnapshot } from '../shared/types';
import { buildRows, toSheetValues } from './build-rows';
import { writeReport } from './google';

function isSnapshot(value: unknown): value is StoreSnapshot {
  return isRecord(value) && Array.isArray(value.normalized);
}

/**
 * Lee de S3 los JSON del día (solo los s3Key de esta ejecución, así una tienda
 * que falló hoy no reutiliza datos de una corrida anterior), arma las filas y
 * escribe Precios_Comparativos_YYYY_MM_DD en Drive /YYYY/MM/.
 */
export async function handler(event: ReportInput, context?: Context): Promise<ReportOutput> {
  if (context) logger.addContext(context);
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) throw new Error('BUCKET_NAME no está configurado');
  logger.appendKeys({ date: event.date, executionArn: event.executionArn });

  const storeName = (id: string): string => event.stores.find((s) => s.id === id)?.name ?? id;
  const items: ProductPrice[] = [];
  const okStores: string[] = [];
  const failedStores: FailedStore[] = [];
  const failedStoreIds = new Set<string>();

  for (const result of event.results) {
    if (result.status === 'OK') {
      const snapshot = await getJson(bucket, result.s3Key);
      if (!isSnapshot(snapshot)) throw new Error(`Formato inesperado en s3://${bucket}/${result.s3Key}`);
      items.push(...snapshot.normalized);
      okStores.push(storeName(result.store));
    } else {
      failedStoreIds.add(result.store);
      failedStores.push({ store: storeName(result.store), error: describeError(result.error, result.cause) });
    }
  }

  const rows = buildRows({ stores: event.stores, products: event.products, items, failedStoreIds });
  const config = await getGoogleConfig();
  const { spreadsheetUrl, created } = await writeReport({ config, date: event.date, values: toSheetValues(rows) });

  const output: ReportOutput = {
    date: event.date,
    spreadsheetUrl,
    okStores,
    failedStores,
    totalProducts: rows.filter((r) => r.precio !== null).length,
  };
  logger.info(created ? 'Reporte creado' : 'Reporte sobrescrito', { ...output });
  return output;
}
