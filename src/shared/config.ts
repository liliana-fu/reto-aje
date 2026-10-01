/**
 * Configuración de Google (OAuth de usuario + carpeta raíz de Drive).
 *
 * - Local: si existe GOOGLE_CLIENT_ID en el entorno (cargado desde .env), se usa el entorno.
 * - Lambda: un solo GetParameters con WithDecryption sobre los parámetros SSM cuyos
 *   NOMBRES llegan en GOOGLE_OAUTH_PARAM y DRIVE_ROOT_PARAM (los valores nunca van en el environment).
 * El resultado se cachea a nivel de módulo, fuera del handler.
 */
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { tracer } from './logger';
import { isRecord } from './parse';

export const GOOGLE_OAUTH_PARAM_NAME = '/price-monitor/google-oauth';
export const DRIVE_ROOT_PARAM_NAME = '/price-monitor/drive-root-folder-id';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  driveRootFolderId: string;
}

/** Obtiene valores de parámetros SSM por nombre (descifrados). */
export type ParameterFetcher = (names: string[]) => Promise<Record<string, string>>;

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Falta la variable de entorno ${key}`);
  return v;
}

/** Parsea el JSON del SecureString /price-monitor/google-oauth. */
export function parseOAuthSecret(value: string): Omit<GoogleConfig, 'driveRootFolderId'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('El parámetro de OAuth de Google no es un JSON válido');
  }
  if (!isRecord(parsed)) throw new Error('El parámetro de OAuth de Google debe ser un objeto JSON');
  const field = (key: string): string => {
    const v = parsed[key];
    if (typeof v !== 'string' || v === '') throw new Error(`El parámetro de OAuth de Google no tiene "${key}"`);
    return v;
  };
  return { clientId: field('client_id'), clientSecret: field('client_secret'), refreshToken: field('refresh_token') };
}

export async function loadGoogleConfig(env: Env, fetchParameters: ParameterFetcher): Promise<GoogleConfig> {
  if (env.GOOGLE_CLIENT_ID) {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: required(env, 'GOOGLE_CLIENT_SECRET'),
      refreshToken: required(env, 'GOOGLE_REFRESH_TOKEN'),
      driveRootFolderId: required(env, 'DRIVE_ROOT_FOLDER_ID'),
    };
  }
  const oauthName = required(env, 'GOOGLE_OAUTH_PARAM');
  const driveName = required(env, 'DRIVE_ROOT_PARAM');
  const values = await fetchParameters([oauthName, driveName]);
  const oauth = values[oauthName];
  const drive = values[driveName];
  if (!oauth || !drive) {
    throw new Error(`Parámetros SSM no encontrados: ${[oauth ? '' : oauthName, drive ? '' : driveName].filter(Boolean).join(', ')}`);
  }
  return { ...parseOAuthSecret(oauth), driveRootFolderId: drive };
}

let ssm: SSMClient | undefined;

const ssmGetParameters: ParameterFetcher = async (names) => {
  ssm ??= tracer.captureAWSv3Client(new SSMClient({}));
  const res = await ssm.send(new GetParametersCommand({ Names: names, WithDecryption: true }));
  const out: Record<string, string> = {};
  for (const p of res.Parameters ?? []) if (p.Name && p.Value) out[p.Name] = p.Value;
  return out;
};

let cached: Promise<GoogleConfig> | undefined;

export function getGoogleConfig(): Promise<GoogleConfig> {
  cached ??= loadGoogleConfig(process.env, ssmGetParameters).catch((err: unknown) => {
    cached = undefined; // no cachear fallos: el siguiente intento vuelve a consultar SSM
    throw err;
  });
  return cached;
}
