import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const CONFIG_PARAMETER_NAME = '/price-monitor/stores-config';

export interface StorageProps {
  /** Ruta al JSON de tiendas (relativa a la raíz del repo). */
  configPath: string;
}

/** Bucket de datos crudos/normalizados y configuración de tiendas en SSM. */
export class Storage extends Construct {
  readonly bucket: s3.Bucket;
  readonly configParameter: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'DataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ id: 'expire-90-days', expiration: Duration.days(90) }],
      // Entorno de reto: se elimina con el stack.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const path = isAbsolute(props.configPath) ? props.configPath : join(__dirname, '..', '..', props.configPath);
    const config: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    this.configParameter = new ssm.StringParameter(this, 'StoresConfig', {
      parameterName: CONFIG_PARAMETER_NAME,
      description: 'Tiendas, URLs y parámetros de extracción del monitor de precios',
      stringValue: JSON.stringify(config),
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
