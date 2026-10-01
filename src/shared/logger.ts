import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const serviceName = process.env.POWERTOOLS_SERVICE_NAME ?? 'price-monitor';

export const logger = new Logger({ serviceName });
export const tracer = new Tracer({ serviceName, enabled: process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined });
