import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as path from 'path';
import { Construct } from 'constructs';

export class AccessDeskStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ssmPrefix = '/access-desk';

    // DynamoDB single-table design
    this.table = new dynamodb.Table(this, 'TicketsTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI for querying tickets by status and createdAt
    this.table.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // SSM Parameters with defaults
    new ssm.StringParameter(this, 'AccessCatalogParam', {
      parameterName: `${ssmPrefix}/accessCatalog`,
      stringValue: '[]',
      description: 'Access catalog: tool name, Okta group, approver, cost, auto-grant rules',
    });

    new ssm.StringParameter(this, 'DefaultApproverParam', {
      parameterName: `${ssmPrefix}/defaultApproverId`,
      stringValue: '',
      description: 'Default approver email address',
    });

    new ssm.StringParameter(this, 'FollowUpWindowParam', {
      parameterName: `${ssmPrefix}/followUpWindow`,
      stringValue: '60',
      description: 'Approval reminder interval in minutes',
    });

    new ssm.StringParameter(this, 'ProviderTypeParam', {
      parameterName: `${ssmPrefix}/providerType`,
      stringValue: 'mock',
      description: 'Access provider type: mock or okta',
    });

    // SES sender address parameter
    new ssm.StringParameter(this, 'SesSenderAddressParam', {
      parameterName: `${ssmPrefix}/sesSenderAddress`,
      stringValue: 'noreply@example.com',
      description: 'Verified SES sender email address for notifications',
    });

    // Portal base URL parameter
    new ssm.StringParameter(this, 'PortalBaseUrlParam', {
      parameterName: `${ssmPrefix}/portalBaseUrl`,
      stringValue: 'http://localhost:3000',
      description: 'Base URL of the AccessDesk web portal (used in email links)',
    });

    // --- ECS Fargate Service for Express Server ---

    const vpc = new ec2.Vpc(this, 'BoltVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    const cluster = new ecs.Cluster(this, 'BoltCluster', { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'BoltTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    taskDefinition.addContainer('BoltContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'access-desk' }),
      environment: {
        DYNAMODB_TABLE: this.table.tableName,
        PORT: '3000',
      },
      portMappings: [{ containerPort: 3000 }],
    });

    // IAM permissions for Fargate task
    this.table.grantReadWriteData(taskDefinition.taskRole);
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: [
          cdk.Arn.format({ service: 'ssm', resource: 'parameter', resourceName: 'access-desk/*' }, this),
        ],
      }),
    );
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      }),
    );
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    // ALB for HTTP access to the Express server
    const alb = new elbv2.ApplicationLoadBalancer(this, 'AccessDeskAlb', {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener('HttpListener', {
      port: 80,
    });

    const fargateService = new ecs.FargateService(this, 'BoltService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
    });

    listener.addTargets('FargateTarget', {
      port: 3000,
      targets: [fargateService],
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
      },
    });

    // --- Lambda + EventBridge for Reminders ---

    const reminderFn = new lambda.Function(this, 'ReminderFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/lambda/reminder-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../')),
      environment: {
        DYNAMODB_TABLE: this.table.tableName,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
    });

    // IAM permissions for Lambda
    this.table.grantReadWriteData(reminderFn);
    reminderFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: [
          cdk.Arn.format({ service: 'ssm', resource: 'parameter', resourceName: 'access-desk/*' }, this),
        ],
      }),
    );
    reminderFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    const reminderRule = new events.Rule(this, 'ReminderSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });
    reminderRule.addTarget(new targets.LambdaFunction(reminderFn));

    // Stack outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB tickets table name',
      exportName: 'AccessDesk-TableName',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB tickets table ARN',
      exportName: 'AccessDesk-TableArn',
    });

    new cdk.CfnOutput(this, 'SsmParameterPrefix', {
      value: ssmPrefix,
      description: 'SSM parameter prefix for config',
      exportName: 'AccessDesk-SsmPrefix',
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name for the AccessDesk portal',
      exportName: 'AccessDesk-AlbDnsName',
    });
  }
}
