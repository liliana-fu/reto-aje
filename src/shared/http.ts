import { ScrapingError } from './errors';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions {
  store: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * GET/POST que devuelve el JSON parseado como `unknown`.
 * Cualquier fallo (red, timeout, HTTP no-2xx, JSON inválido) se convierte en ScrapingError.
 */
export async function fetchJson(url: string, opts: FetchJsonOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        'Accept-Language': 'es-PE,es;q=0.9',
        ...opts.headers,
      },
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new ScrapingError(`Fallo de red al consultar ${url} (${reason})`, { store: opts.store, url, cause: err });
  }

  if (!res.ok) {
    throw new ScrapingError(`HTTP ${res.status} al consultar ${url}`, {
      store: opts.store,
      url,
      statusCode: res.status,
    });
  }

  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ScrapingError(`Respuesta no es JSON válido en ${url}`, { store: opts.store, url, cause: err });
  }
}
