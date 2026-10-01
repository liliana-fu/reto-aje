import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { describeError } from '../shared/errors';
import { logger, tracer } from '../shared/logger';
import { isRecord } from '../shared/parse';
import type { DlqMessage } from '../shared/types';

export interface EmailMessage {
  subject: string;
  message: string;
}

export type Publisher = (email: EmailMessage) => Promise<void>;

function field(body: Record<string, unknown>, key: keyof DlqMessage): string {
  const v = body[key];
  return typeof v === 'string' ? v : '';
}

export function parseDlqMessage(raw: string): DlqMessage {
  const body: unknown = JSON.parse(raw);
  if (!isRecord(body) || typeof body.store !== 'string') throw new Error('Mensaje de DLQ sin "store"');
  return {
    store: body.store,
    tienda: field(body, 'tienda') || body.store,
    url: field(body, 'url'),
    error: field(body, 'error'),
    cause: field(body, 'cause'),
    executionArn: field(body, 'executionArn'),
    timestamp: field(body, 'timestamp'),
    date: field(body, 'date'),
  };
}

/** Asunto en ASCII (SNS rechaza saltos de línea y limita a 100 caracteres). */
export function formatErrorEmail(msg: DlqMessage): EmailMessage {
  const fecha = msg.date || msg.timestamp.slice(0, 10);
  const subject = `[AJE Price Monitor] Error de extraccion - ${msg.tienda} - ${fecha}`.slice(0, 99);
  const message = [
    'Falló la extracción de precios de una tienda.',
    'El resto del pipeline continúa y el reporte del día marcará esta tienda como "Error de extracción".',
    '',
    `Tienda:        ${msg.tienda} (${msg.store})`,
    `URL:           ${msg.url}`,
    `Error:         ${msg.error}`,
    `Detalle:       ${describeError(msg.error, msg.cause)}`,
    `Fecha/hora:    ${msg.timestamp}`,
    `Ejecución:     ${msg.executionArn}`,
    '',
    'Revisa la ejecución en la consola de AWS Step Functions y los logs de la Lambda scraper en CloudWatch.',
  ].join('\n');
  return { subject, message };
}

export async function processRecords(records: SQSRecord[], publish: Publisher): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of records) {
    try {
      const msg = parseDlqMessage(record.body);
      await publish(formatErrorEmail(msg));
      logger.info('Notificación de error enviada', { store: msg.store, executionArn: msg.executionArn });
    } catch (err) {
      logger.error('No se pudo procesar el mensaje de la DLQ', { messageId: record.messageId, error: err as Error });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

const sns = tracer.captureAWSv3Client(new SNSClient({}));

const publishToTopic: Publisher = async ({ subject, message }) => {
  const topicArn = process.env.TOPIC_ARN;
  if (!topicArn) throw new Error('TOPIC_ARN no está configurado');
  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: subject,
      Message: message,
      MessageAttributes: { eventType: { DataType: 'String', StringValue: 'ERROR' } },
    }),
  );
};

/** Trigger SQS (batch 10) con reportBatchItemFailures: solo se reintentan los mensajes fallidos. */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  return processRecords(event.Records, publishToTopic);
}
