#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { PriceMonitorStack } from '../lib/price-monitor-stack';

const app = new App();

function contextString(key: string, fallback: string): string {
  const value: unknown = app.node.tryGetContext(key);
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function contextEmails(key: string): string[] {
  const value: unknown = app.node.tryGetContext(key);
  const list = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const emails = list.filter((e): e is string => typeof e === 'string').map((e) => e.trim()).filter(Boolean);
  if (emails.length === 0) throw new Error(`Define al menos un email en el context "${key}" (cdk.json)`);
  return emails;
}

new PriceMonitorStack(app, 'PriceMonitorStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: 'AJE - Pipeline serverless de monitoreo de precios de competidores',
  configPath: contextString('configPath', 'config/stores.json'),
  notificationEmails: contextEmails('notificationEmails'),
});

Tags.of(app).add('Project', 'price-monitor');
Tags.of(app).add('Owner', 'Liliana');
