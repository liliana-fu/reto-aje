/**
 * Prueba local de los adapters contra los sitios reales, sin AWS:
 *   npx tsx scripts/run-local.ts            # todas las tiendas
 *   npx tsx scripts/run-local.ts dermashop
 * Escribe el resultado normalizado en out/<tienda>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdapter } from '../src/scrapers/adapters';
import { targetsFor } from '../src/scrapers/handler';
import type { StoresConfig } from '../src/shared/types';

async function main(): Promise<void> {
  const storeId = process.argv[2];
  const config = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'stores.json'), 'utf-8')) as StoresConfig;
  const stores = storeId ? config.stores.filter((s) => s.id === storeId) : config.stores;
  if (stores.length === 0) throw new Error(`Tienda "${storeId}" no está en config/stores.json`);

  mkdirSync('out', { recursive: true });
  for (const store of stores) {
    const items = await createAdapter(store).extract(targetsFor(store.id, config.products));
    console.log(`\n${store.name}: ${items.length} producto(s)`);
    console.table(items.map(({ grupo, producto, precio, contenido, precioPor100, stock }) => ({ grupo, producto, precio, contenido, precioPor100, stock })));
    writeFileSync(join('out', `${store.id}.json`), JSON.stringify(items, null, 2));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
