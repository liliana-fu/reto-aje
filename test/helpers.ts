import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoreConfig, StoresConfig, TargetItem } from '../src/shared/types';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8')) as unknown;
}

export interface RecordedCall {
  url: string;
  init?: RequestInit;
}

/** Reemplaza fetch global por una función que responde según la URL/llamada. */
export function mockFetch(respond: (url: string, call: number) => unknown): RecordedCall[] {
  const calls: RecordedCall[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const out = respond(url, calls.length - 1);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  });
  return calls;
}

export function loadConfig(): StoresConfig {
  return JSON.parse(readFileSync(join(__dirname, '..', 'config', 'stores.json'), 'utf-8')) as StoresConfig;
}

export function storeConfig(id: string): StoreConfig {
  const store = loadConfig().stores.find((s) => s.id === id);
  if (!store) throw new Error(`store ${id} no existe`);
  return store;
}

export function target(store: string, url: string, extra: Partial<TargetItem> = {}): TargetItem {
  return { grupo: 'Protector solar facial', store, url, ...extra };
}
