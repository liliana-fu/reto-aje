export type Stock = 'Disponible' | 'Agotado' | 'No disponible en tienda';

export type Unidad = 'ml' | 'g';

export interface Contenido {
  valor: number;
  unidad: Unidad;
}

/** Esquema normalizado de un precio extraído (o de un producto que la tienda no tiene). */
export interface ProductPrice {
  grupo: string;
  producto: string;
  tienda: string;
  precio: number | null;
  moneda: 'PEN';
  /** "50 ml", "118 ml" o "" si no se conoce. */
  contenido: string;
  precioPor100: number | null;
  stock: Stock;
  url: string;
  extraidoEn: string; // ISO 8601
}

/** Una tienda tal como se define en config/stores.json. */
export interface StoreConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** Parámetros propios del adapter (p. ej. el índice Algolia de Inkafarma). */
  params?: Record<string, string | number>;
}

/** Un producto de un grupo en una tienda, tal como viene de enlaces.md. */
export interface ConfigItem {
  store: string;
  nombre?: string;
  contenido?: Contenido;
  url: string;
}

export interface ProductGroup {
  grupo: string;
  items: ConfigItem[];
}

export interface StoresConfig {
  stores: StoreConfig[];
  products: ProductGroup[];
}

/** Lo que recibe un adapter: un item de config con su grupo. */
export interface TargetItem extends ConfigItem {
  grupo: string;
}

/** Entrada de la Lambda scraper (una iteración del Map). */
export interface ScrapeInput {
  store: StoreConfig;
  products: ProductGroup[];
  /** Fecha de corrida YYYY-MM-DD; si falta, se deriva de `startTime` en hora de Lima. */
  date?: string;
  /** `$$.Execution.StartTime` de Step Functions. */
  startTime?: string;
}

export interface ScrapeResultOk {
  store: string;
  status: 'OK';
  s3Key: string;
  itemsCount: number;
}

export interface ScrapeResultError {
  store: string;
  status: 'ERROR';
  /** Nombre del error (p. ej. "ScrapingError", "States.Timeout"). */
  error: string;
  /** Cause de Step Functions: para errores de Lambda es un JSON con errorType/errorMessage. */
  cause?: string;
}

export type ScrapeResult = ScrapeResultOk | ScrapeResultError;

/** Lo que se guarda en S3 por tienda y día. */
export interface StoreSnapshot {
  store: string;
  tienda: string;
  date: string;
  extraidoEn: string;
  itemsCount: number;
  normalized: ProductPrice[];
  raw: unknown[];
}

/** Mensaje que Step Functions envía a la DLQ cuando falla una tienda. */
export interface DlqMessage {
  store: string;
  tienda: string;
  url: string;
  error: string;
  cause: string;
  executionArn: string;
  timestamp: string;
  date: string;
}

/** Entrada de la Lambda report-generator. */
export interface ReportInput {
  date: string;
  executionArn: string;
  stores: StoreConfig[];
  products: ProductGroup[];
  results: ScrapeResult[];
}

export interface FailedStore {
  store: string;
  error: string;
}

/** Salida de la Lambda report-generator (la usa NotifySuccess). */
export interface ReportOutput {
  date: string;
  spreadsheetUrl: string;
  okStores: string[];
  failedStores: FailedStore[];
  totalProducts: number;
}
