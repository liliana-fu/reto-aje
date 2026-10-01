/**
 * Parser de docs/enlaces.md → `products` de config/stores.json.
 *
 * Formato:
 *   # <grupo>
 *   Enlaces <tienda>            (etiqueta opcional; la tienda se deduce del dominio de la URL)
 *   <url> (118 ml)              (contenido opcional entre paréntesis)
 */
import type { ConfigItem, ProductGroup, StoreConfig } from './types';
import { parseContenido } from './units';

const URL_LINE = /^(https?:\/\/\S+)(?:\s+\(([^)]*)\))?\s*$/;

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

export function parseEnlaces(markdown: string, stores: StoreConfig[]): ProductGroup[] {
  const byHost = new Map(stores.map((s) => [hostOf(s.baseUrl), s.id]));
  const groups: ProductGroup[] = [];
  let current: ProductGroup | undefined;

  markdown.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const where = `enlaces.md:${idx + 1}`;
    if (line.startsWith('#')) {
      current = { grupo: line.replace(/^#+\s*/, ''), items: [] };
      groups.push(current);
      return;
    }
    const m = URL_LINE.exec(line);
    if (!m) return; // líneas vacías y etiquetas "Enlaces <tienda>"
    if (!current) throw new Error(`${where}: URL fuera de un grupo; agrega "# <grupo>" antes`);

    const url = m[1];
    const store = byHost.get(hostOf(url));
    if (!store) throw new Error(`${where}: el dominio de ${url} no corresponde a ninguna tienda`);
    const item: ConfigItem = { store, url };
    if (m[2] !== undefined) {
      const contenido = parseContenido(m[2]);
      if (!contenido) throw new Error(`${where}: contenido "${m[2]}" no reconocido (usa p. ej. "118 ml" o "50 g")`);
      item.contenido = contenido;
    }
    current.items.push(item);
  });

  return groups;
}
