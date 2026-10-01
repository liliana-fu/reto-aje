import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { join } from 'node:path';

export interface PriceMonitorFunctionProps {
  /** Ruta relativa a src/, p. ej. "scrapers/handler.ts". */
  entry: string;
  serviceName: string;
  description: string;
  timeout: Duration;
  memorySize: number;
  environment?: Record<string, string>;
}

/** NodejsFunction con los valores comunes: Node.js 22, ARM64, esbuild, X-Ray y logs JSON. */
export class PriceMonitorFunction extends NodejsFunction {
  constructor(scope: Construct, id: string, props: PriceMonitorFunctionProps) {
    super(scope, id, {
      entry: join(__dirname, '..', '..', 'src', props.entry),
      handler: 'handler',
      description: props.description,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: props.timeout,
      memorySize: props.memorySize,
      tracing: lambda.Tracing.ACTIVE,
      loggingFormat: lambda.LoggingFormat.JSON,
      logGroup: new logs.LogGroup(scope, `${id}Logs`, {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        POWERTOOLS_SERVICE_NAME: props.serviceName,
        POWERTOOLS_LOG_LEVEL: 'INFO',
        NODE_OPTIONS: '--enable-source-maps',
        ...props.environment,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        // El feature flag LAMBDA_NODEJS_SDK_V3_EXCLUDE_SMITHY_PACKAGES también excluye @smithy/*,
        // pero aws-xray-sdk-core (tracer de Powertools) lo requiere desde /var/task, donde no existe.
        externalModules: ['@aws-sdk/*'],
      },
    });
  }
}
