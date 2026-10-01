import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Alerting } from './constructs/alerting';
import { Notification } from './constructs/notification';
import { Orchestration } from './constructs/orchestration';
import { Reporting } from './constructs/reporting';
import { Scraping } from './constructs/scraping';
import { Storage } from './constructs/storage';

export interface PriceMonitorStackProps extends StackProps {
  /** JSON de tiendas y productos que se publica en SSM. */
  configPath: string;
  /** Emails suscritos al topic de notificaciones. */
  notificationEmails: string[];
}

export class PriceMonitorStack extends Stack {
  constructor(scope: Construct, id: string, props: PriceMonitorStackProps) {
    super(scope, id, props);

    const storage = new Storage(this, 'Storage', { configPath: props.configPath });
    const notification = new Notification(this, 'Notification', { emails: props.notificationEmails });
    const scraping = new Scraping(this, 'Scraping', { bucket: storage.bucket });
    const alerting = new Alerting(this, 'Alerting', { topic: notification.topic });
    const reporting = new Reporting(this, 'Reporting', { bucket: storage.bucket });
    const orchestration = new Orchestration(this, 'Orchestration', {
      configParameter: storage.configParameter,
      scraperFn: scraping.scraperFn,
      reportFn: reporting.reportFn,
      dlq: alerting.dlq,
      topic: notification.topic,
    });

    new CfnOutput(this, 'StateMachineArn', { value: orchestration.stateMachine.stateMachineArn });
    new CfnOutput(this, 'DlqUrl', { value: alerting.dlq.queueUrl });
    new CfnOutput(this, 'BucketName', { value: storage.bucket.bucketName });
    new CfnOutput(this, 'TopicArn', { value: notification.topic.topicArn });
  }
}
