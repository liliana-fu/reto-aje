# AJE Price Monitor

Pipeline serverless en AWS (CDK v2 + TypeScript) que cada día extrae precio y stock de productos dermo-cosméticos en Dermashop, Flora y Fauna e Inkafarma, genera un Google Sheet comparativo y notifica por correo.

## Arquitectura

Diagrama: [`docs/arquitectura.drawio`](docs/arquitectura.drawio)

```
EventBridge Scheduler (08:00 America/Lima)
  └─► Step Functions
        ├─ LoadConfig        lee tiendas y productos de SSM
        ├─ Map (3 tiendas en paralelo)
        │    └─ ScrapeStore  Lambda → S3 (Retry 3x)
        │         └─ Catch → SQS DLQ → MarkFailed
        ├─ GenerateReport    Lambda → Google Sheets
        │    └─ Catch → SNS (ERROR) → Fail
        └─ NotifySuccess     SNS (SUCCESS / PARTIAL)

SQS DLQ ─► Lambda error-notifier ─► SNS ─► correos
CloudWatch Alarm (mensajes en la DLQ) ─► SNS
```

### Flujo

1. El Scheduler inicia la State Machine todos los días a las 8:00 (hora de Lima).
2. `LoadConfig` lee `/price-monitor/stores-config` de SSM.
3. El `Map` ejecuta un scraper por tienda. Cada uno guarda el resultado en `s3://<bucket>/raw/YYYY/MM/DD/<tienda>.json`.
4. Si una tienda falla tras 3 reintentos, el error va a la DLQ y la tienda se marca como `ERROR`. Las demás continúan.
5. `GenerateReport` lee S3 y crea o sobrescribe `Precios_Comparativos_YYYY_MM_DD` en la carpeta `/YYYY/MM/` de Drive.
6. `NotifySuccess` envía el correo con el link al Sheet y el estado: `COMPLETADO` o `COMPLETADO CON ERRORES`.
7. `error-notifier` consume la DLQ y envía un correo por cada error.

### Extracción por tienda

| Tienda | Fuente | Precio | Stock |
|---|---|---|---|
| Dermashop (Shopify) | `/products/<handle>.js` | `price` / 100 (viene en céntimos) | `available` de la variante |
| Flora y Fauna (VTEX) | `/api/catalog_system/pub/products/search/<slug>/p` | `Price + Tax` (la API devuelve el precio sin IGV) | `IsAvailable` y `AvailableQuantity > 0` |
| Inkafarma (SPA) | Índice Algolia público `products` (id al final de la URL) | `pricePromo` o, si no hay, `priceList` | `validPrice` |

La API propia de Inkafarma devuelve 403 sin token de Cognito; por eso se usa Algolia.

## Alcance de productos

- Los productos están en [`docs/enlaces.md`](docs/enlaces.md): una lista curada con URLs directas por tienda.
- Las tiendas venden marcas distintas, así que cada grupo reúne **productos equivalentes**, no el mismo SKU.
- Se comparan por **precio por 100 ml/g**. "MEJOR PRECIO" se asigna al menor valor de cada grupo, solo entre los disponibles.
- Si un grupo no tiene URL para una tienda, la fila sale como "No disponible en tienda".
- **Para agregar productos no se toca código:**
  1. Edita `docs/enlaces.md`.
  2. Ejecuta `npm run config` (regenera `config/stores.json`).
  3. Ejecuta `npm run deploy`.

Formato de `enlaces.md`:

```
# <Grupo>

Enlaces <Tienda>
<url> (<contenido opcional, ej. 118 ml>)
```

## Reporte (Google Sheets)

| Producto / Categoría | Tienda | Precio (PEN) | Precio x 100 ml/g | Stock | URL del producto | Menor precio alerta |
|---|---|---|---|---|---|---|

- Una fila por tienda, agrupada por grupo.
- Las tiendas que fallaron aparecen con "Error de extracción".
- El encabezado va en negrita, la fila 1 está congelada y "MEJOR PRECIO" se resalta en verde.

## Requisitos

- Node.js 22+
- AWS CLI con credenciales configuradas (región `us-east-1`)
- Cuenta de Google con Drive

## Despliegue

```bash
npm ci
npx cdk bootstrap
cp .env.example .env      # completar los valores (ver abajo)
npm run deploy            # push-secrets + cdk deploy
```

Después del deploy, cada destinatario debe **confirmar la suscripción** desde el correo que envía AWS SNS. Los correos están en `cdk.json` → `context.notificationEmails`.

### Credenciales de Google

1. En Google Cloud Console, crea un proyecto y habilita **Google Drive API** y **Google Sheets API**.
2. Configura la pantalla de consentimiento OAuth y agrega tu cuenta como usuario de prueba.
3. Crea un **OAuth Client ID** de tipo **Desktop app**.
4. Copia el client ID y el secret en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del `.env`.
5. Ejecuta `npm run google-token`, autoriza en el navegador y copia el `GOOGLE_REFRESH_TOKEN` que imprime. Scopes: `drive` y `spreadsheets`.
6. Crea en Drive la carpeta raíz y copia su ID (lo que va después de `/folders/` en la URL) en `DRIVE_ROOT_FOLDER_ID`.

### Ejecución manual

```bash
aws stepfunctions start-execution \
  --state-machine-arn <StateMachineArn de los outputs> \
  --input '{}'
```

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm test` | Tests de Jest (adapters, unidades, reporte, infraestructura) |
| `npm run local [tienda]` | Corre los scrapers contra los sitios reales, sin AWS. Escribe en `out/` |
| `npm run config` | Regenera `config/stores.json` desde `docs/enlaces.md` |
| `npm run push-secrets` | Publica el `.env` en SSM |
| `npx cdk synth > template.yaml` | Regenera el template versionado |

## Secretos

| Parámetro SSM | Tipo | Contenido |
|---|---|---|
| `/price-monitor/google-oauth` | SecureString (`aws/ssm`) | JSON con `client_id`, `client_secret` y `refresh_token` |
| `/price-monitor/drive-root-folder-id` | String | ID de la carpeta raíz de Drive |

- `npm run push-secrets` publica los dos parámetros desde `.env`.
- La Lambda recibe solo los **nombres** de los parámetros y los lee en tiempo de ejecución.
- Ningún valor queda en el template de CloudFormation.
- `.env` está en `.gitignore`.

## Decisiones de diseño

| Decisión | Motivo |
|---|---|
| Step Functions en vez de solo SQS | Orquestación visible, Retry/Catch declarativo y un punto claro para generar el reporte cuando terminan todas las tiendas. |
| Catch dentro de cada iteración del Map | Si una tienda falla, las otras siguen y el reporte se genera igual. |
| DLQ solo para errores | El éxito va directo de Step Functions a SNS; la DLQ queda como evidencia de fallos y dispara la alarma. |
| OAuth de usuario en vez de Service Account | Una Service Account no tiene cuota en "Mi unidad" de una cuenta personal. |
| SSM SecureString en vez de Secrets Manager | Cuesta $0 frente a $0.40/mes por secreto. La contrapartida es que no hay rotación automática. |
| `.env` solo en local | Los valores nunca llegan al `environment` de la Lambda ni al template. |
| Lista curada en vez del catálogo completo | Menos requests, menos riesgo de bloqueo y comparación controlada por negocio. |
| Productos equivalentes + precio por 100 ml/g | Las tiendas no comparten SKU; normalizar por contenido hace comparables los precios. |

## Limitaciones

- Si la app OAuth está en modo **Testing**, el refresh token vence a los **7 días**. Para evitarlo, publícala en modo Production o regenera el token con `npm run google-token` y `npm run push-secrets`.
- Si falla una URL, falla toda la tienda (se reintenta y luego va a la DLQ).
- Inkafarma no expone stock; se infiere de `validPrice`.
- Los scrapers dependen de APIs no oficiales que pueden cambiar sin aviso.

## Costos

Una ejecución diaria con 3 tiendas queda dentro de la capa gratuita o en centavos al mes: Lambda, Step Functions Standard (~10 transiciones por ejecución), S3, SQS, SNS y SSM Standard.

Estimación: [AWS Pricing Calculator](https://calculator.aws/#/)

## Evidencias

En [`docs/evidencias/`](docs/evidencias/):

- Ejecución de Step Functions (exitosa y con fallo forzado)
- Mensajes en la DLQ
- Correo de error y correo de reporte (`COMPLETADO` / `COMPLETADO CON ERRORES`)
- Google Sheet generado

## Uso de Agente de IA

- **Herramienta:** Claude Code.
- **Contexto permanente:** [`CLAUDE.md`](CLAUDE.md).
- **Prompt base:** [`docs/prompt_base_cdk_typescript.md`](docs/prompt_base_cdk_typescript.md).
- **Prompts principales por fase:** [`docs/prompts/`](docs/prompts/).
