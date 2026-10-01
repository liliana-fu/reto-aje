/**
 * Contenido de un producto (ml/g) y precio por 100 ml/g, para comparar
 * productos equivalentes de distinto tamaño dentro de un grupo.
 */
import { round2 } from './parse';
import type { Contenido } from './types';

// 30 ml · 1.5L · 79GR · 1,5 kg · 50ml · FRASCO 473 ML
const CONTENIDO_RE = /(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litros?|gr|grs|g|kg|gramos?)(?![a-z])/i;

/** Extrae el contenido de un texto ("Gel 50 ml", "FRASCO 473 ML"); undefined si no hay. */
export function parseContenido(text: string): Contenido | undefined {
  const m = CONTENIDO_RE.exec(text);
  if (!m) return undefined;
  const valor = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(valor) || valor <= 0) return undefined;
  const unit = m[2].toLowerCase();
  if (unit === 'ml') return { valor, unidad: 'ml' };
  if (unit === 'l' || unit === 'lt' || unit.startsWith('litro')) return { valor: round2(valor * 1000), unidad: 'ml' };
  if (unit === 'kg') return { valor: round2(valor * 1000), unidad: 'g' };
  return { valor, unidad: 'g' };
}

/** Primer contenido encontrado entre varios textos, en orden de prioridad. */
export function firstContenido(...texts: (string | undefined)[]): Contenido | undefined {
  for (const t of texts) {
    const c = t ? parseContenido(t) : undefined;
    if (c) return c;
  }
  return undefined;
}

export function formatContenido(c: Contenido | undefined): string {
  return c ? `${c.valor} ${c.unidad}` : '';
}

/** Precio por 100 ml/g, redondeado a céntimos; null si falta precio o contenido. */
export function precioPor100(precio: number | null, c: Contenido | undefined): number | null {
  if (precio === null || !c) return null;
  return round2((precio / c.valor) * 100);
}
