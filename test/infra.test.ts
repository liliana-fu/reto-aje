import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PriceMonitorStack } from '../lib/price-monitor-stack';

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new PriceMonitorStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    configPath: 'config/stores.json',
    notificationEmails: ['test@example.com'],
  });
  template = Template.fromStack(stack);
});

describe('Infraestructura', () => {
  test('bucket cifrado, privado, con lifecycle de 90 días', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 90, Status: 'Enabled' })] },
    });
  });

  test('config de tiendas publicada en SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/price-monitor/stores-config',
      Value: Match.stringLikeRegexp('"id":"inkafarma"'),
    });
  });

  test('scraper: Node.js 22, ARM64, 60 s, 512 MB y X-Ray', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      Timeout: 60,
      MemorySize: 512,
      TracingConfig: { Mode: 'Active' },
    });
  });
});
