/**
 * Obtiene el refresh token de Google (OAuth de usuario, cliente tipo "Desktop app").
 * Lee GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET del .env, abre el navegador para autorizar
 * y muestra el refresh token para copiarlo en GOOGLE_REFRESH_TOKEN.
 *   npm run google-token
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];

function requireEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Falta ${key} en .env (paso 5 de la guía)`);
  return v;
}

async function main(): Promise<void> {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');

  // Redirección "loopback" a 127.0.0.1 en un puerto libre: es el flujo soportado para clientes Desktop.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline', // necesario para recibir refresh_token
    prompt: 'consent', // fuerza a Google a emitir un refresh_token nuevo
    scope: SCOPES,
  });

  const code = await new Promise<string>((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri);
      const error = url.searchParams.get('error');
      const received = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        received
          ? '<h2>Listo. Ya puedes cerrar esta pestaña y volver a la terminal.</h2>'
          : `<h2>Autorización cancelada: ${error ?? 'sin código'}</h2>`,
      );
      if (received) resolve(received);
      else reject(new Error(`Autorización cancelada: ${error ?? 'sin código'}`));
    });

    console.log('\nAbre esta URL e inicia sesión con la cuenta de Google dueña de la carpeta de Drive:\n');
    console.log(authUrl, '\n');
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [authUrl], () => undefined);
  });
  server.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google no devolvió refresh_token. Quita el acceso de la app en https://myaccount.google.com/permissions y vuelve a ejecutar.',
    );
  }
  console.log('✔ Copia esta línea en tu .env:\n');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
