#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AccessDeskStack } from '../lib/access-desk-stack';

const app = new cdk.App();

new AccessDeskStack(app, 'AccessDeskStack', {
  description: 'AccessDesk - shared resources, ECS Fargate, Lambda reminders',
});
