import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { PriceMonitorFunction } from './node-function';

export interface AlertingProps {
  topic: sns.ITopic;
}

/** Pilar de Resiliencia: DLQ de errores de scraping, notifier y alarma de respaldo. */
export class Alerting extends Construct {
  readonly dlq: sqs.Queue;
  readonly notifierFn: PriceMonitorFunction;

  constructor(scope: Construct, id: string, props: AlertingProps) {
    super(scope, id);

    const notifierTimeout = Duration.seconds(30);

    this.dlq = new sqs.Queue(this, 'ScrapingErrorsDlq', {
      queueName: 'scraping-errors-dlq',
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
      // AWS recomienda >= 6x el timeout de la Lambda consumidora.
      visibilityTimeout: Duration.seconds(notifierTimeout.toSeconds() * 6),
    });

    this.notifierFn = new PriceMonitorFunction(this, 'ErrorNotifierFn', {
      entry: 'notifier/handler.ts',
      serviceName: 'price-monitor-error-notifier',
      description: 'Lee la DLQ de scraping y publica un correo legible en SNS (eventType=ERROR)',
      timeout: notifierTimeout,
      memorySize: 256,
      environment: { TOPIC_ARN: props.topic.topicArn },
    });
    this.notifierFn.addEventSource(
      new SqsEventSource(this.dlq, { batchSize: 10, reportBatchItemFailures: true }),
    );
    props.topic.grantPublish(this.notifierFn);

    // Respaldo: si el notifier no consume los mensajes (p. ej. falla), la DLQ acumula y salta la alarma.
    const alarm = new cloudwatch.Alarm(this, 'DlqMessagesAlarm', {
      alarmName: 'price-monitor-dlq-messages-visible',
      alarmDescription: 'Hay mensajes visibles en scraping-errors-dlq (errores de extracción sin procesar)',
      metric: this.dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1), statistic: 'Maximum' }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(new cwActions.SnsAction(props.topic));
  }
}
