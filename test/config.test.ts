import { loadGoogleConfig, parseOAuthSecret, type ParameterFetcher } from '../src/shared/config';

const OAUTH = '/price-monitor/google-oauth';
const DRIVE = '/price-monitor/drive-root-folder-id';
const LAMBDA_ENV = { GOOGLE_OAUTH_PARAM: OAUTH, DRIVE_ROOT_PARAM: DRIVE };
const SECRET = JSON.stringify({ client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtoken' });

describe('getGoogleConfig / loadGoogleConfig', () => {
  test('local: usa el .env y no consulta SSM', async () => {
    const fetcher = jest.fn<ReturnType<ParameterFetcher>, Parameters<ParameterFetcher>>();
    const cfg = await loadGoogleConfig(
      { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'r', DRIVE_ROOT_FOLDER_ID: 'folder' },
      fetcher,
    );
    expect(cfg).toEqual({ clientId: 'cid', clientSecret: 's', refreshToken: 'r', driveRootFolderId: 'folder' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('local: falla si el .env está incompleto', async () => {
    await expect(loadGoogleConfig({ GOOGLE_CLIENT_ID: 'cid' }, jest.fn())).rejects.toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  test('Lambda: un solo GetParameters con los nombres de las variables de entorno', async () => {
    const fetcher = jest.fn<ReturnType<ParameterFetcher>, Parameters<ParameterFetcher>>().mockResolvedValue({
      [OAUTH]: SECRET,
      [DRIVE]: 'folder-123',
    });
    const cfg = await loadGoogleConfig(LAMBDA_ENV, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith([OAUTH, DRIVE]);
    expect(cfg).toEqual({ clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken', driveRootFolderId: 'folder-123' });
  });

  test('Lambda: indica qué parámetro falta', async () => {
    await expect(loadGoogleConfig(LAMBDA_ENV, async () => ({ [OAUTH]: SECRET }))).rejects.toThrow(DRIVE);
  });

  test('parseOAuthSecret valida el JSON', () => {
    expect(() => parseOAuthSecret('no-json')).toThrow(/JSON válido/);
    expect(() => parseOAuthSecret('{"client_id":"a"}')).toThrow(/client_secret/);
  });
});
