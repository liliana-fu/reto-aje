import { Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { PriceMonitorFunction } from './node-function';

export interface ScrapingProps {
  bucket: s3.IBucket;
}

/** Pilar de Extracción: Lambda scraper (un adapter por tienda). */
export class Scraping extends Construct {
  readonly scraperFn: PriceMonitorFunction;

  constructor(scope: Construct, id: string, props: ScrapingProps) {
    super(scope, id);

    this.scraperFn = new PriceMonitorFunction(this, 'ScraperFn', {
      entry: 'scrapers/handler.ts',
      serviceName: 'price-monitor-scraper',
      description: 'Extrae precio y stock de una tienda y guarda raw/normalizado en S3',
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: { BUCKET_NAME: props.bucket.bucketName },
    });

    // Solo escribe bajo raw/.
    props.bucket.grantPut(this.scraperFn, 'raw/*');
  }
}
