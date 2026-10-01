/**
 * Regenera la sección `products` de config/stores.json a partir de docs/enlaces.md.
 * La sección `stores` (dominios y parámetros de cada tienda) se conserva.
 *   npm run config
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnlaces } from '../src/shared/enlaces';
import type { StoresConfig } from '../src/shared/types';

const root = join(__dirname, '..');
const configPath = join(root, 'config', 'stores.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8')) as StoresConfig;
const products = parseEnlaces(readFileSync(join(root, 'docs', 'enlaces.md'), 'utf-8'), config.stores);

writeFileSync(configPath, `${JSON.stringify({ stores: config.stores, products }, null, 2)}\n`);
const urls = products.reduce((n, g) => n + g.items.length, 0);
console.log(`config/stores.json: ${products.length} grupo(s), ${urls} URL(s)`);
