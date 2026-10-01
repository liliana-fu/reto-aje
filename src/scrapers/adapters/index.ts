import type { StoreConfig } from '../../shared/types';
import type { StoreAdapter } from './base';
import { DermashopAdapter } from './dermashop';
import { FloraYFaunaAdapter } from './florayfauna';
import { InkafarmaAdapter } from './inkafarma';

const FACTORIES: Record<string, (store: StoreConfig) => StoreAdapter> = {
  dermashop: (store) => new DermashopAdapter(store),
  florayfauna: (store) => new FloraYFaunaAdapter(store),
  inkafarma: (store) => new InkafarmaAdapter(store),
};

/** Crea un adapter nuevo según `store.id`. */
export function createAdapter(store: StoreConfig): StoreAdapter {
  const factory = Object.hasOwn(FACTORIES, store.id) ? FACTORIES[store.id] : undefined;
  if (!factory) throw new Error(`No existe adapter para la tienda "${store.id}"`);
  return factory(store);
}
