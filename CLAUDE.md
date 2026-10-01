# Prompt base – Pipeline de Monitoreo de Precios (AWS CDK + TypeScript)

## Rol y contexto

Actúa como **Senior AWS Serverless Engineer**. Vamos a construir, en menos de 2 horas, un pipeline **Serverless, Event-Driven y Resiliente** en AWS para la Gerencia Comercial de AJE. El pipeline monitorea periódicamente los precios de productos dermo-cosméticos y de cuidado personal en 3 competidores:

| Tienda | URL objetivo |
|---|---|
| Dermashop | https://dermashop.pe/ |
| Flora & Fauna | https://www.florayfauna.pe/cuidado-personal/cuidado-corporal |
| Inkafarma | https://inkafarma.pe/categoria/dermatologia-cosmetica |

El pipeline debe:

1. Extraer precio y stock de los productos listados en **`enlaces.md`** en las 3 tiendas (ver "Alcance de productos").
2. Gestionar los fallos con una cola de errores (SQS DLQ) y notificarlos por correo a **oscar.toledo@ajegroup.com** y a **lilianafuye@gmail.com**.
3. Generar automáticamente un Google Sheet en Google Drive, dentro de la carpeta `/YYYY/MM/`, con el nombre `Precios_Comparativos_YYYY_MM_DD`.
4. Notificar por correo cuando el reporte se cargue en Google Sheets, con el link al Sheet. El estado es "COMPLETADO" o "COMPLETADO CON ERRORES".

**Stack obligatorio:** AWS CDK v2 en **TypeScript**. Las Lambdas también van en TypeScript (Node.js 22, `NodejsFunction` con esbuild, arquitectura ARM64).

## Alcance de productos

**La fuente de verdad de los productos es `enlaces.md`, en la raíz del repo.** Ahí están los productos a monitorear, con sus URLs directas por tienda. **No busques ni propongas productos por tu cuenta:** usa solo los de esa lista.

Contexto: las 3 tiendas venden marcas distintas. Dermashop vende dermo-cosmética (CeraVe, Eucerin, Sesderma…) y Flora y Fauna vende marcas naturales (Nua, Mishki, Catalina Bath…). Por eso la lista puede agrupar **productos equivalentes** (mismo tipo de producto en distintas tiendas) y no necesariamente el mismo SKU.

- Lee `enlaces.md` y conviértelo en `config/stores.json`, que se publica en SSM Parameter Store. Respeta el agrupamiento y los nombres tal como están en el archivo. Si el formato es ambiguo o falta algún dato (por ejemplo, el tamaño), **pregúntame** antes de asumir.
- Estructura esperada de la config:

```json
{
  "stores": [
    { "id": "dermashop",   "name": "Dermashop",     "baseUrl": "https://dermashop.pe/" },
    { "id": "florayfauna", "name": "Flora y Fauna", "baseUrl": "https://www.florayfauna.pe/cuidado-personal/cuidado-corporal" },
    { "id": "inkafarma",   "name": "Inkafarma",     "baseUrl": "https://inkafarma.pe/categoria/dermatologia-cosmetica" }
  ],
  "products": [
    {
      "grupo": "Crema corporal hidratante",
      "items": [
        { "store": "dermashop",   "nombre": "...", "contenido": { "valor": 400, "unidad": "ml" }, "url": "..." },
        { "store": "florayfauna", "nombre": "...", "contenido": { "valor": 200, "unidad": "ml" }, "url": "..." },
        { "store": "inkafarma",   "nombre": "...", "contenido": { "valor": 250, "unidad": "ml" }, "url": "..." }
      ]
    }
  ]
}
```

- Cada scraper visita **solo las URLs de su tienda** de esa lista. No hace falta buscar ni hacer matching por nombre.
- Si un grupo no tiene URL para una tienda, la fila sale como `stock: "No disponible en tienda"` y sin precio. No es un error de extracción.
- Como los productos de un grupo pueden tener tamaños distintos, calcula también **precio por 100 ml/g**. "MEJOR PRECIO" se asigna por grupo usando ese valor, solo entre los disponibles.
- Si el contenido no viene en `enlaces.md`, extráelo del nombre o de la página del producto.
- Hallazgos previos de la exploración, que debes validar en la Fase 0:
  - Dermashop es Shopify: usa `/products/<handle>.json` o `/products.json`.
  - Flora y Fauna es VTEX: usa `/api/catalog_system/pub/products/search?fq=...`. El `Price` de la API parece venir **sin IGV**: confirma contra la web y reporta el precio con IGV.
  - Inkafarma es una SPA sin productos en el HTML: identifica su API interna.
- Para agregar productos solo se edita `enlaces.md` o la config, sin tocar código. Documenta este supuesto en el README.

## Arquitectura (respétala tal cual)

```
EventBridge Scheduler (cron 0 8 * * ? *, zona America/Lima)
   └─► Step Functions (Standard)
         ├─ LoadConfig: lee tiendas y productos objetivo desde SSM Parameter Store
         ├─ Map state (MaxConcurrency 3, ItemsPath $.stores) — Retry 3x · Catch por iteración
         │    └─ Iteración:
         │         ScrapeStore (Lambda scraper, Retry: 3 intentos, IntervalSeconds 2, BackoffRate 2)
         │           ├─ OK → guarda en S3 y devuelve { store, status: "OK", s3Key, itemsCount }
         │           └─ Catch (States.ALL) → SendToDLQ (integración nativa sqs:sendMessage)
         │                                 → MarkFailed (Pass) → { store, status: "ERROR", error }
         ├─ GenerateReport (Lambda report-generator: lee S3, credenciales en SSM SecureString, escribe Google Sheets)
         │     └─ Catch (States.ALL) → NotifyReportFailure (sns:publish nativo) → Fail
         └─ NotifySuccess (sns:publish nativo, con el link al Sheet) → Succeed

SQS scraping-errors-dlq ──► Lambda error-notifier ──► SNS topic price-monitor-notifications ──► emails
CloudWatch Alarm (ApproximateNumberOfMessagesVisible > 0 en la DLQ) ──► SNS
CloudWatch Logs + X-Ray: todas las Lambdas y la State Machine
```

**Reglas críticas:**

- El `Catch` de scraping va **dentro de cada iteración del Map**, no en el estado Map. Si una tienda falla, las demás continúan y el reporte se genera igual, con esa tienda marcada como "Error de extracción".
- La DLQ es **solo para errores**. La notificación de éxito va **directo de Step Functions a SNS**: nunca pasa por SQS.

## Estructura del repositorio

```
price-monitor/
├── CLAUDE.md                     # este prompt (contexto permanente del agente)
├── bin/app.ts
├── lib/
│   ├── price-monitor-stack.ts
│   └── constructs/ (storage.ts, scraping.ts, alerting.ts, orchestration.ts, reporting.ts)
├── src/
│   ├── shared/ (types.ts, logger.ts, http.ts, s3.ts, units.ts, config.ts)
│   ├── scrapers/
│   │   ├── handler.ts            # elige el adapter según store.id
│   │   └── adapters/ (dermashop.ts, florayfauna.ts, inkafarma.ts, base.ts)
│   ├── report/handler.ts
│   └── notifier/handler.ts
├── enlaces.md                     # lista de productos y URLs (fuente de verdad)
├── config/stores.json            # generado a partir de enlaces.md
├── scripts/push-secrets.ts       # lee .env y publica los parámetros en SSM
├── .env.example                  # claves vacías (versionado); .env real en .gitignore
├── test/                         # Jest: adapters, units y lógica del reporte
├── docs/ (arquitectura.drawio, prompts/, evidencias/)
├── template.yaml                 # salida de `cdk synth` versionada (entregable IaC)
└── README.md
```

## Requisitos por componente

### 1. Extracción (scrapers)

- **Antes de escribir los adapters, inspecciona cada sitio.** Haz peticiones reales con `curl` y revisa:
  - el HTML;
  - `<script type="application/ld+json">` y `__NEXT_DATA__`;
  - endpoints JSON, como `/products.json` en Shopify, `/api/catalog_system/pub/products/search` en VTEX o la API interna de una SPA.

  **No inventes selectores ni endpoints:** muéstrame lo que encontraste y valida con datos reales.
- Prioridad: API JSON > JSON-LD > HTML con `cheerio`. Evita los navegadores headless salvo que sea imprescindible. Si lo fuera, avísame antes de usarlo.
- Patrón Adapter: cada adapter implementa `extract(items: TargetItem[]): Promise<ProductPrice[]>`, con los items de su tienda tomados de la config.
- Esquema normalizado:
  ```ts
  interface ProductPrice {
    grupo: string; producto: string; tienda: string;
    precio: number | null; moneda: "PEN"; contenido: string; precioPor100: number | null;
    stock: "Disponible" | "Agotado" | "No disponible en tienda";
    url: string; extraidoEn: string; // ISO 8601
  }
  ```
- `fetch` nativo con timeout (`AbortSignal.timeout(10000)`), User-Agent realista y lanzamiento de errores tipados (`ScrapingError`) para que Step Functions reintente.
- Guarda el resultado crudo y el normalizado en S3: `raw/YYYY/MM/DD/<tienda>.json`. Las claves deben ser idempotentes: si se re-ejecuta, se sobrescribe.
- `shared/units.ts`: normaliza el contenido (ml/g) y calcula el precio por 100 ml/g.

### 2. Resiliencia y notificación de errores

- DLQ SQS con cifrado SSE y retención de 14 días.
- El mensaje a la DLQ incluye `store`, `url`, `error`, `cause`, `executionArn` y `timestamp`.
- `error-notifier` (trigger SQS, batch size 10, `reportBatchItemFailures`) arma un correo legible y publica en SNS con `eventType = ERROR`.
- Un único SNS topic `price-monitor-notifications` con suscripciones de email fijas para `oscar.toledo@ajegroup.com` y `lilianafuye@gmail.com`, definidas en el context de CDK (`cdk.json` → `notificationEmails`). Recuerda en el README que cada suscripción se debe confirmar.
- CloudWatch Alarm sobre la DLQ como respaldo, con acción hacia el SNS.
- Logs estructurados con `@aws-lambda-powertools/logger` y tracing con X-Ray en Lambdas y Step Functions.

### 3. Reporte en Google Sheets / Drive

- Usa la librería `googleapis`.
- Credenciales **OAuth de usuario** (client_id, client_secret, refresh_token) en **SSM Parameter Store SecureString** `/price-monitor/google-oauth`, cifrado con la llave `aws/ssm`. Ver la sección "Secretos y configuración". No uses Service Account, porque no tiene cuota en el "Mi unidad" de una cuenta personal.
- El ID de la carpeta raíz de Drive va en el parámetro SSM `String` `/price-monitor/drive-root-folder-id`.
- Lógica:
  1. Leer de S3 los JSON del día.
  2. Buscar o crear la carpeta `YYYY` y, dentro, la carpeta `MM`.
  3. Crear el Spreadsheet `Precios_Comparativos_YYYY_MM_DD` dentro de `MM`. Si ya existe, sobrescribir el contenido.
  4. Escribir las columnas: **Producto / Categoría | Tienda | Precio (PEN) | Precio x 100 ml/g | Stock | URL del producto | Menor precio alerta**. En "Producto / Categoría" va `grupo — nombre del producto`. Agrupa por grupo, con una fila por tienda.
  5. "MEJOR PRECIO" va en el menor **precio por 100 ml/g** de cada grupo, **solo entre los disponibles**. En el resto va "-".
  6. Tiendas fallidas: una fila con "Error de extracción".
  7. Formato: encabezado en negrita, congelar la fila 1 y aplicar formato condicional en verde a "MEJOR PRECIO".
- Devuelve `{ spreadsheetUrl, okStores[], failedStores[], totalProducts }`.

### 4. Secretos y configuración (SSM + .env)

- **No usar Secrets Manager.** Se usa SSM SecureString: es gratis, va cifrado con KMS y ya se usa SSM para la config.
- **Local:**
  - `.env` está en `.gitignore`.
  - `.env.example` va versionado con las claves vacías: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_ROOT_FOLDER_ID` y `AWS_REGION`.
- **`scripts/push-secrets.ts`** (`npm run push-secrets`, con `dotenv` + `tsx` + `@aws-sdk/client-ssm`):
  - Valida que estén todas las claves del `.env`.
  - Publica `/price-monitor/google-oauth` como `SecureString` (un JSON con client_id, client_secret y refresh_token) y `/price-monitor/drive-root-folder-id` como `String`, ambos con `Overwrite: true`.
- **`npm run deploy`** = `npm run push-secrets && cdk deploy`.
- **CDK:** CloudFormation no crea SecureString, así que CDK solo referencia los parámetros:
  - `StringParameter.fromSecureStringParameterAttributes` y `StringParameter.fromStringParameterName`, con `grantRead(reportFn)`.
  - A la Lambda se le pasan **solo los nombres** de los parámetros como variables de entorno (`GOOGLE_OAUTH_PARAM` y `DRIVE_ROOT_PARAM`).
- **NUNCA** pongas valores del `.env` en el `environment` de una Lambda: quedarían en texto plano en el template de CloudFormation y en `template.yaml`.
- **`src/shared/config.ts` → `getGoogleConfig()`:**
  - Si existe `process.env.GOOGLE_CLIENT_ID` (ejecución local), usa el `.env`.
  - Si no, hace un solo `GetParameters` con `WithDecryption: true`.
  - Cachea el resultado fuera del handler.

### 5. Notificación de éxito

- Tras GenerateReport, agrega el estado `NotifySuccess` con la integración nativa `arn:aws:states:::sns:publish` (sin Lambda) al mismo SNS topic.
- Mensaje: fecha, estado, tiendas OK, tiendas fallidas con su error, total de productos, spreadsheetUrl y executionArn.
  - Estado "COMPLETADO" si no hubo fallos; "COMPLETADO CON ERRORES" si alguna tienda falló.
  - Asunto: `[AJE Price Monitor] Reporte YYYY-MM-DD – <ESTADO>`.
- MessageAttribute `eventType` = SUCCESS | PARTIAL, según si hubo tiendas fallidas. Usa un estado `Choice` o `States.Format` / JSONata para construirlo.
- Catch en GenerateReport → `NotifyReportFailure` (sns:publish, `eventType = ERROR`, con el error y el executionArn) → estado `Fail`.

### 6. Infraestructura CDK

- Un stack con constructs separados por pilar: Orquestación, Extracción, Resiliencia, Reporte y Notificación.
- Permisos IAM de mínimo privilegio, con grants específicos (`bucket.grantReadWrite`, `parameter.grantRead`, `topic.grantPublish`, `queue.grantSendMessages`, etc.).
- Bucket S3: bloqueo de acceso público, cifrado, lifecycle de 90 días y `RemovalPolicy.DESTROY` con `autoDeleteObjects` (es un entorno de reto).
- Timeouts de Lambda: scrapers de 60 s y 512 MB; reporter de 120 s.
- Tags: `Project=price-monitor` y `Owner=Liliana`.
- `CfnOutput`: ARN de la State Machine, URL de la DLQ, nombre del bucket y ARN del Topic.
- Región: `us-east-1`.

## Forma de trabajo

Avanza **por fases**. Al final de cada fase, detente, muéstrame qué hiciste y cómo probarlo:

1. **Fase 0 – Exploración (15 min):** inspecciona los 3 sitios, lee `enlaces.md`, genera `config/stores.json`, valida con `curl` cada URL de la lista y propón la estrategia de extracción por tienda (de dónde sale el precio y el stock), con evidencia.
2. **Fase 1:** scaffold de CDK, S3, SSM y Lambdas scraper con tests de Jest. Prueba local con `npx tsx`.
3. **Fase 2:** Step Functions con Map, Retry/Catch, DLQ, notifier, SNS y alarma. `cdk deploy`.
4. **Fase 3:** `.env.example`, `scripts/push-secrets.ts`, `config.ts`, Lambda report-generator, Google Sheets, NotifySuccess y NotifyReportFailure.
5. **Fase 4:** pruebas end-to-end:
   - **(a) Ejecución exitosa:** correo de éxito con el link al Sheet.
   - **(b) Fallo forzado:** URL inválida en una tienda. Debe dejar evidencia en la DLQ, el correo de error y el correo "COMPLETADO CON ERRORES".
6. **Fase 5:** `cdk synth > template.yaml` y README.

## README.md (entregable)

Debe incluir:

- Descripción, diagrama (`docs/arquitectura.drawio`) y flujo paso a paso.
- Supuesto del alcance de productos: lista curada en `enlaces.md`, productos equivalentes por grupo y comparación por precio por 100 ml/g.
- Prerrequisitos y despliegue:
  1. `npm ci` y `cdk bootstrap`.
  2. `cp .env.example .env` y llenar los valores.
  3. `npm run deploy`, que hace push-secrets + cdk deploy.

  Incluye también cómo obtener el refresh token de Google (OAuth Client tipo Desktop, APIs de Drive y Sheets, scopes `drive` + `spreadsheets`) y cómo ejecutar manualmente la State Machine.
- Limitación conocida: si la app OAuth está en modo "Testing", el refresh token vence a los 7 días.
- Decisiones de diseño y trade-offs:
  - Step Functions vs. un esquema solo con SQS.
  - Catch por iteración.
  - DLQ solo para errores.
  - OAuth vs. Service Account.
  - SSM SecureString vs. Secrets Manager: costo $0 vs. $0.40/mes, sin rotación automática.
  - `.env` solo local vs. variables de entorno en Lambda.
  - Lista curada (`enlaces.md`) vs. catálogo completo.
  - Productos equivalentes + precio por 100 ml/g vs. SKU idéntico.
- Estimación de costos (enlace a la AWS Pricing Calculator).
- Evidencias: capturas de la DLQ, de ambos correos, de la ejecución de Step Functions y del Google Sheet.
- **Sección "Uso de Agente de IA":** herramienta usada (Claude Code) y los prompts principales empleados (ver `docs/prompts/`).

## Restricciones

- Código limpio, tipado estricto (`strict: true`) y sin `any`.
- Ningún secreto en el código ni en el repo.
- Si algo del enunciado es ambiguo o un sitio bloquea el scraping, **pregúntame** antes de improvisar.

Empieza por la **Fase 0**.

---

## Decisiones tomadas durante la implementación

- `enlaces.md` vive en `docs/enlaces.md` (decisión de la usuaria). Formato: `# <grupo>`, líneas `Enlaces <tienda>` opcionales, y `<url> (<contenido>)` con el contenido opcional. `npm run config` regenera `products` en `config/stores.json`; un test verifica que estén sincronizados.
- Grupo actual: "Protector solar facial". El contenido del Badger (118 ml) lo indicó la usuaria porque Flora y Fauna no lo publica.
- Extracción validada con curl:
  - **Dermashop (Shopify):** `/products/<handle>.js`. Incluye `available` por variante; el precio viene en céntimos.
  - **Flora y Fauna (VTEX):** `/api/catalog_system/pub/products/search/<slug>/p`. `Price` viene sin IGV, así que el precio web es `Price + Tax` (100.85 + 18.15 = 119.00). Un producto inexistente devuelve 200 con `[]`.
  - **Inkafarma (SPA):** su API propia devuelve 403 sin token de Cognito. Se usa el índice Algolia público `products` (getObject por el id final de la URL). El precio es `pricePromo` y, si no hay, `priceList`. No hay campo de stock: se usa `validPrice`.
- Una URL que falla hace fallar la tienda completa (ScrapingError → Retry → Catch → DLQ).
- Tag `Owner=Liliana`.
- Secretos: SSM SecureString `/price-monitor/google-oauth` y String `/price-monitor/drive-root-folder-id`, publicados por `npm run push-secrets` desde `.env`. Secrets Manager quedó eliminado del proyecto. Los nombres de los parámetros están en `src/shared/config.ts` y los usan tanto el script como CDK.
