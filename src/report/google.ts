/**
 * Escritura del reporte en Google Drive / Sheets con OAuth de usuario.
 * Se importan solo los módulos de Drive y Sheets de `googleapis` para no
 * empaquetar las 300+ APIs en la Lambda.
 */
import { auth, drive_v3 } from 'googleapis/build/src/apis/drive';
import { sheets_v4 } from 'googleapis/build/src/apis/sheets';
import type { GoogleConfig } from '../shared/config';
import type { Cell } from './build-rows';
import { BEST_PRICE } from './build-rows';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SHEET_TITLE = 'Precios';

export interface WriteReportInput {
  config: GoogleConfig;
  /** YYYY-MM-DD */
  date: string;
  values: Cell[][];
}

export interface WriteReportOutput {
  spreadsheetId: string;
  spreadsheetUrl: string;
  created: boolean;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findChild(drive: drive_v3.Drive, parentId: string, name: string, mimeType: string): Promise<string | undefined> {
  const res = await drive.files.list({
    q: `'${escapeQuery(parentId)}' in parents and name = '${escapeQuery(name)}' and mimeType = '${mimeType}' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
    spaces: 'drive',
  });
  return res.data.files?.[0]?.id ?? undefined;
}

async function findOrCreateFolder(drive: drive_v3.Drive, parentId: string, name: string): Promise<string> {
  const existing = await findChild(drive, parentId, name, FOLDER_MIME);
  if (existing) return existing;
  const res = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id',
  });
  if (!res.data.id) throw new Error(`Drive no devolvió el id de la carpeta ${name}`);
  return res.data.id;
}

export async function writeReport({ config, date, values }: WriteReportInput): Promise<WriteReportOutput> {
  const client = new auth.OAuth2(config.clientId, config.clientSecret);
  client.setCredentials({ refresh_token: config.refreshToken });
  const drive = new drive_v3.Drive({ auth: client });
  const sheets = new sheets_v4.Sheets({ auth: client });

  // 1. /<raíz>/YYYY/MM/
  const [yyyy, mm, dd] = date.split('-');
  const yearId = await findOrCreateFolder(drive, config.driveRootFolderId, yyyy);
  const monthId = await findOrCreateFolder(drive, yearId, mm);

  // 2. Spreadsheet del día: se reutiliza si existe (re-ejecución idempotente).
  const name = `Precios_Comparativos_${yyyy}_${mm}_${dd}`;
  let spreadsheetId = await findChild(drive, monthId, name, SHEET_MIME);
  const created = !spreadsheetId;
  if (!spreadsheetId) {
    const res = await drive.files.create({ requestBody: { name, mimeType: SHEET_MIME, parents: [monthId] }, fields: 'id' });
    if (!res.data.id) throw new Error(`Drive no devolvió el id del Spreadsheet ${name}`);
    spreadsheetId = res.data.id;
  }

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title),conditionalFormats)',
  });
  const sheet = meta.data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId ?? 0;
  const previousTitle = sheet?.properties?.title ?? 'Sheet1';
  const previousRules = sheet?.conditionalFormats?.length ?? 0;

  // 3. Contenido: se limpia la hoja completa y se reescribe.
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${previousTitle}'` });

  // 4. Formato: título, encabezado en negrita, fila 1 congelada, números y verde en "MEJOR PRECIO".
  const rowCount = values.length;
  const requests: sheets_v4.Schema$Request[] = [
    // Al re-ejecutar se eliminan las reglas previas para no duplicarlas.
    ...Array.from({ length: previousRules }, () => ({ deleteConditionalFormatRule: { sheetId, index: 0 } })),
    {
      updateSheetProperties: {
        properties: { sheetId, title: SHEET_TITLE, gridProperties: { frozenRowCount: 1 } },
        fields: 'title,gridProperties.frozenRowCount',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 2, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: BEST_PRICE }] },
            format: {
              backgroundColor: { red: 0.72, green: 0.88, blue: 0.72 },
              textFormat: { bold: true, foregroundColor: { red: 0.1, green: 0.4, blue: 0.1 } },
            },
          },
        },
      },
    },
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_TITLE}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: values[0]?.length ?? 7 } } },
      ],
    },
  });

  return { spreadsheetId, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, created };
}
