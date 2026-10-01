export const TIME_ZONE = 'America/Lima';

/** Fecha YYYY-MM-DD de un instante, en la zona horaria de Lima. */
export function limaDate(instant: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
  yyyy: string;
  mm: string;
  dd: string;
}

export function dateParts(date: string): DateParts {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Fecha inválida "${date}", se esperaba YYYY-MM-DD`);
  return { yyyy: m[1], mm: m[2], dd: m[3] };
}

/** Resuelve la fecha de corrida: `date` explícita > `startTime` de la ejecución > ahora. */
export function resolveRunDate(input: { date?: string; startTime?: string }): string {
  if (input.date) {
    dateParts(input.date);
    return input.date;
  }
  if (input.startTime) {
    const d = new Date(input.startTime);
    if (!Number.isNaN(d.getTime())) return limaDate(d);
  }
  return limaDate();
}

/** Prefijo S3 idempotente del día: raw/YYYY/MM/DD/ */
export function rawPrefix(date: string): string {
  const { yyyy, mm, dd } = dateParts(date);
  return `raw/${yyyy}/${mm}/${dd}/`;
}

export function rawKey(date: string, storeId: string): string {
  return `${rawPrefix(date)}${storeId}.json`;
}
