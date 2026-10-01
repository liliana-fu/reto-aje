/**
 * Error tipado de extracción. Su `name` es lo que Step Functions ve como
 * `Error` del estado, por eso la política de Retry se declara sobre "ScrapingError".
 */
export class ScrapingError extends Error {
  readonly store: string;
  readonly url: string;
  readonly statusCode?: number;

  constructor(message: string, opts: { store: string; url: string; statusCode?: number; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = 'ScrapingError';
    this.store = opts.store;
    this.url = opts.url;
    this.statusCode = opts.statusCode;
  }
}

/**
 * Texto legible a partir del Error/Cause que entrega Step Functions.
 * Para errores de Lambda, Cause es un JSON {"errorType","errorMessage","trace"}.
 */
export function describeError(error: string | undefined, cause: string | undefined): string {
  if (cause) {
    try {
      const parsed: unknown = JSON.parse(cause);
      if (typeof parsed === 'object' && parsed !== null && 'errorMessage' in parsed) {
        const msg = (parsed as { errorMessage: unknown }).errorMessage;
        if (typeof msg === 'string' && msg !== '') return msg;
      }
    } catch {
      // Cause no es JSON: se usa tal cual.
    }
    return cause.length > 500 ? `${cause.slice(0, 500)}…` : cause;
  }
  return error ?? 'Error desconocido';
}
