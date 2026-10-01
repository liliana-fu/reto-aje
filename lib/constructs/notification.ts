import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export const TOPIC_NAME = 'price-monitor-notifications';

export interface NotificationProps {
  /** Emails suscritos (context `notificationEmails` de cdk.json). Cada uno debe confirmar la suscripción. */
  emails: string[];
}

/** Pilar de Notificación: un único topic para errores, éxito y alarmas (atributo `eventType`). */
export class Notification extends Construct {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, 'Topic', {
      topicName: TOPIC_NAME,
      displayName: 'AJE Price Monitor',
    });

    for (const email of props.emails) {
      this.topic.addSubscription(new subs.EmailSubscription(email));
    }
  }
}
