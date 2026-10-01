import { Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DRIVE_ROOT_PARAM_NAME, GOOGLE_OAUTH_PARAM_NAME } from '../../src/shared/config';
import { PriceMonitorFunction } from './node-function';

export interface ReportingProps {
  bucket: s3.IBucket;
}

/**
 * Pilar de Reporte: Lambda que lee los JSON del día y escribe el Google Sheet.
 * Los parámetros SSM los crea `npm run push-secrets` (CloudFormation no crea SecureString):
 * aquí solo se referencian y la Lambda recibe sus NOMBRES, nunca los valores.
 */
export class Reporting extends Construct {
  readonly reportFn: PriceMonitorFunction;

  constructor(scope: Construct, id: string, props: ReportingProps) {
    super(scope, id);

    const oauthParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'GoogleOAuthParam', {
      parameterName: GOOGLE_OAUTH_PARAM_NAME,
    });
    const driveRootParam = ssm.StringParameter.fromStringParameterName(this, 'DriveRootParam', DRIVE_ROOT_PARAM_NAME);

    this.reportFn = new PriceMonitorFunction(this, 'ReportGeneratorFn', {
      entry: 'report/handler.ts',
      serviceName: 'price-monitor-report',
      description: 'Genera Precios_Comparativos_YYYY_MM_DD en Google Drive /YYYY/MM/',
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
        GOOGLE_OAUTH_PARAM: oauthParam.parameterName,
        DRIVE_ROOT_PARAM: driveRootParam.parameterName,
      },
    });

    props.bucket.grantRead(this.reportFn, 'raw/*');
    // aws/ssm es una llave administrada por AWS: su política ya permite descifrar vía SSM
    // a quien tenga ssm:GetParameters sobre el parámetro, no hace falta kms:Decrypt explícito.
    oauthParam.grantRead(this.reportFn);
    driveRootParam.grantRead(this.reportFn);
  }
}
