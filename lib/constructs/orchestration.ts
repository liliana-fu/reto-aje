import { Duration, RemovalPolicy, TimeZone } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface OrchestrationProps {
  configParameter: ssm.IStringParameter;
  scraperFn: lambda.IFunction;
  reportFn: lambda.IFunction;
  dlq: sqs.IQueue;
  topic: sns.ITopic;
}

/** Errores transitorios que justifican reintentar el scraping de una tienda. */
const RETRYABLE_SCRAPE_ERRORS = [
  'ScrapingError',
  'Sandbox.Timedout',
  'States.Timeout',
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
  'Lambda.TooManyRequestsException',
];

// Lima es UTC-5 todo el año (sin horario de verano).
const LIMA_DATE = "$fromMillis($toMillis($states.context.Execution.StartTime) - 18000000, '[Y0001]-[M01]-[D01]')";

/** Pilar de Orquestación: Step Functions (Standard) + EventBridge Scheduler diario. */
export class Orchestration extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: OrchestrationProps) {
    super(scope, id);

    // 1. Fecha de corrida (input.date permite re-ejecutar un día concreto) y ARN de la ejecución.
    const init = sfn.Pass.jsonata(this, 'Init', {
      comment: 'Fija date (YYYY-MM-DD en hora de Lima) y executionArn',
      outputs: `{% $merge([$states.input, {"date": $exists($states.input.date) ? $states.input.date : ${LIMA_DATE}, "executionArn": $states.context.Execution.Id}]) %}`,
    });

    // 2. Config de tiendas y productos desde SSM.
    const loadConfig = new tasks.CallAwsService(this, 'LoadConfig', {
      comment: 'Lee tiendas y productos objetivo desde SSM Parameter Store',
      service: 'ssm',
      action: 'getParameter',
      parameters: { Name: props.configParameter.parameterName },
      iamResources: [props.configParameter.parameterArn],
      resultSelector: { 'config.$': 'States.StringToJson($.Parameter.Value)' },
      resultPath: '$.loaded',
    });

    // 3. Iteración del Map: Retry + Catch POR TIENDA (una tienda caída no detiene a las demás).
    const scrapeStore = new tasks.LambdaInvoke(this, 'ScrapeStore', {
      lambdaFunction: props.scraperFn,
      payloadResponseOnly: true,
      retryOnServiceExceptions: false, // la política de Retry se define explícitamente abajo
    });
    scrapeStore.addRetry({
      errors: RETRYABLE_SCRAPE_ERRORS,
      maxAttempts: 3,
      interval: Duration.seconds(2),
      backoffRate: 2,
    });

    const markFailed = new sfn.Pass(this, 'MarkFailed', {
      parameters: {
        'store.$': '$.store.id',
        status: 'ERROR',
        'error.$': '$.error.Error',
        'cause.$': '$.error.Cause',
      },
    });

    const sendToDlq = new tasks.SqsSendMessage(this, 'SendToDLQ', {
      queue: props.dlq,
      messageBody: sfn.TaskInput.fromObject({
        store: sfn.JsonPath.stringAt('$.store.id'),
        tienda: sfn.JsonPath.stringAt('$.store.name'),
        url: sfn.JsonPath.stringAt('$.store.baseUrl'),
        error: sfn.JsonPath.stringAt('$.error.Error'),
        cause: sfn.JsonPath.stringAt('$.error.Cause'),
        executionArn: sfn.JsonPath.stringAt('$.executionArn'),
        timestamp: sfn.JsonPath.stringAt('$$.State.EnteredTime'),
        date: sfn.JsonPath.stringAt('$.date'),
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });
    // Aunque la DLQ falle, la tienda se marca como fallida y el pipeline sigue.
    sendToDlq.addCatch(markFailed, { errors: [sfn.Errors.ALL], resultPath: '$.dlqError' });
    sendToDlq.next(markFailed);
    scrapeStore.addCatch(sendToDlq, { errors: [sfn.Errors.ALL], resultPath: '$.error' });

    const scrapeStores = new sfn.Map(this, 'ScrapeStores', {
      comment: 'Una iteración por tienda (MaxConcurrency 3)',
      maxConcurrency: 3,
      itemsPath: '$.loaded.config.stores',
      itemSelector: {
        'store.$': '$$.Map.Item.Value',
        'products.$': '$.loaded.config.products',
        'date.$': '$.date',
        'executionArn.$': '$.executionArn',
      },
      resultPath: '$.results',
    });
    scrapeStores.itemProcessor(scrapeStore);

    // 4. Reporte en Google Sheets.
    const generateReport = new tasks.LambdaInvoke(this, 'GenerateReport', {
      lambdaFunction: props.reportFn,
      payload: sfn.TaskInput.fromObject({
        date: sfn.JsonPath.stringAt('$.date'),
        executionArn: sfn.JsonPath.stringAt('$.executionArn'),
        stores: sfn.JsonPath.listAt('$.loaded.config.stores'),
        products: sfn.JsonPath.listAt('$.loaded.config.products'),
        results: sfn.JsonPath.listAt('$.results'),
      }),
      payloadResponseOnly: true,
      resultPath: '$.report',
    });

    const notifyReportFailure = tasks.SnsPublish.jsonata(this, 'NotifyReportFailure', {
      topic: props.topic,
      subject: "{% '[AJE Price Monitor] Reporte ' & $states.input.date & ' - ERROR' %}",
      message: sfn.TaskInput.fromText(
        `{% $join([
          'No se pudo generar el reporte de precios en Google Sheets.',
          '',
          'Fecha:      ' & $states.input.date,
          'Estado:     ERROR',
          'Error:      ' & $states.input.reportError.Error,
          'Detalle:    ' & $states.input.reportError.Cause,
          'Ejecución:  ' & $states.input.executionArn,
          '',
          $contains($states.input.reportError.Cause, 'invalid_grant')
            ? 'El refresh token de Google venció o fue revocado: regenéralo con npm run google-token y ejecuta npm run push-secrets.'
            : 'Revisa los logs de la Lambda report-generator en CloudWatch.'
        ], '\\n') %}`,
      ),
      messageAttributes: { eventType: { value: 'ERROR' } },
    });
    const reportFailed = new sfn.Fail(this, 'ReportFailed', {
      error: 'ReportGenerationFailed',
      cause: 'GenerateReport falló; se notificó por SNS',
    });
    generateReport.addCatch(notifyReportFailure.next(reportFailed), {
      errors: [sfn.Errors.ALL],
      resultPath: '$.reportError',
    });

    // 5. Éxito: directo de Step Functions a SNS (nunca por la DLQ).
    const partial = '$count($states.input.report.failedStores) > 0';
    const notifySuccess = tasks.SnsPublish.jsonata(this, 'NotifySuccess', {
      topic: props.topic,
      subject: `{% '[AJE Price Monitor] Reporte ' & $states.input.report.date & ' - ' & (${partial} ? 'COMPLETADO CON ERRORES' : 'COMPLETADO') %}`,
      message: sfn.TaskInput.fromText(
        `{% $join([
          'El reporte comparativo de precios se cargó en Google Sheets.',
          '',
          'Fecha:              ' & $states.input.report.date,
          'Estado:             ' & (${partial} ? 'COMPLETADO CON ERRORES' : 'COMPLETADO'),
          'Tiendas OK:         ' & ($count($states.input.report.okStores) > 0 ? $join($states.input.report.okStores, ', ') : 'ninguna'),
          'Tiendas fallidas:   ' & (${partial} ? $join($map($states.input.report.failedStores, function($f) { $f.store & ' (' & $f.error & ')' }), '; ') : 'ninguna'),
          'Total de productos: ' & $string($states.input.report.totalProducts),
          '',
          'Google Sheet: ' & $states.input.report.spreadsheetUrl,
          '',
          'Ejecución: ' & $states.input.executionArn
        ], '\\n') %}`,
      ),
      messageAttributes: { eventType: { value: `{% ${partial} ? 'PARTIAL' : 'SUCCESS' %}` } },
    });

    const definition = init
      .next(loadConfig)
      .next(scrapeStores)
      .next(generateReport)
      .next(notifySuccess)
      .next(new sfn.Succeed(this, 'Done'));

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: 'price-monitor',
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(15),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'StateMachineLogs', {
          logGroupName: '/aws/vendedlogs/states/price-monitor',
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    new scheduler.Schedule(this, 'DailySchedule', {
      scheduleName: 'price-monitor-daily',
      description: 'Ejecuta el monitoreo de precios todos los días a las 08:00 (Lima)',
      schedule: scheduler.ScheduleExpression.cron({ minute: '0', hour: '8', timeZone: TimeZone.AMERICA_LIMA }),
      target: new schedulerTargets.StepFunctionsStartExecution(this.stateMachine, {
        input: scheduler.ScheduleTargetInput.fromObject({}),
      }),
    });
  }
}
