/**
 * Publica en SSM los valores del .env local (nunca pasan por CloudFormation):
 *   /price-monitor/google-oauth          SecureString (JSON client_id/client_secret/refresh_token, llave aws/ssm)
 *   /price-monitor/drive-root-folder-id  String
 * Uso: npm run push-secrets   (también lo ejecuta `npm run deploy`)
 */
import 'dotenv/config';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DRIVE_ROOT_PARAM_NAME, GOOGLE_OAUTH_PARAM_NAME } from '../src/shared/config';

const REQUIRED_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'DRIVE_ROOT_FOLDER_ID', 'AWS_REGION'] as const;
type Key = (typeof REQUIRED_KEYS)[number];

function readEnv(): Record<Key, string> {
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(`Faltan claves en .env: ${missing.join(', ')} (copia .env.example a .env y complétalo)`);
  }
  const env = {} as Record<Key, string>;
  for (const k of REQUIRED_KEYS) env[k] = (process.env[k] ?? '').trim();
  return env;
}

async function main(): Promise<void> {
  const env = readEnv();
  const ssm = new SSMClient({ region: env.AWS_REGION });

  await ssm.send(
    new PutParameterCommand({
      Name: GOOGLE_OAUTH_PARAM_NAME,
      Description: 'Credenciales OAuth de usuario de Google (price-monitor)',
      Type: 'SecureString',
      KeyId: 'alias/aws/ssm',
      Value: JSON.stringify({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
      }),
      Overwrite: true,
    }),
  );
  console.log(`✔ ${GOOGLE_OAUTH_PARAM_NAME} (SecureString) actualizado en ${env.AWS_REGION}`);

  await ssm.send(
    new PutParameterCommand({
      Name: DRIVE_ROOT_PARAM_NAME,
      Description: 'ID de la carpeta raíz de Google Drive para los reportes (price-monitor)',
      Type: 'String',
      Value: env.DRIVE_ROOT_FOLDER_ID,
      Overwrite: true,
    }),
  );
  console.log(`✔ ${DRIVE_ROOT_PARAM_NAME} (String) actualizado en ${env.AWS_REGION}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
