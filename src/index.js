/**
 * AccessDesk entry point — initializes all components and starts the Express server.
 * @module index
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SESClient } from '@aws-sdk/client-ses';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { createConfigManager } from './config.js';
import { createRulesEngine } from './rules-engine.js';
import { createRequestStore } from './store.js';
import { createProvisioner } from './provisioner.js';
import { createEmailService } from './email-service.js';
import { createAccessAgent } from './access-agent.js';
import { createServer } from './server.js';
import { SSM_PARAMS } from './constants.js';

/**
 * Read a single SSM parameter, returning undefined on failure.
 */
async function readParam(ssmClient, name) {
  try {
    const res = await ssmClient.send(new GetParameterCommand({ Name: name }));
    return res.Parameter?.Value;
  } catch {
    return undefined;
  }
}

async function main() {
  const tableName = process.env.DYNAMODB_TABLE || 'AccessDesk';
  const port = Number(process.env.PORT) || 3000;

  // --- AWS SDK clients ---
  const ssmClient = new SSMClient({});
  const sesClient = new SESClient({});
  const bedrockClient = new BedrockRuntimeClient({});
  const dynamoClient = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(dynamoClient);

  // --- Config manager (loads access catalog, provider type, etc. from SSM) ---
  const configManager = createConfigManager(ssmClient);
  const config = await configManager.loadConfig();

  // --- Read SES config from SSM (with env var overrides) ---
  const sesFromAddress =
    process.env.SES_FROM_ADDRESS ||
    (await readParam(ssmClient, SSM_PARAMS.sesFromAddress)) ||
    'noreply@example.com';

  const portalBaseUrl =
    process.env.PORTAL_BASE_URL ||
    (await readParam(ssmClient, SSM_PARAMS.portalBaseUrl)) ||
    `http://localhost:${port}`;

  // --- Core components ---
  const rulesEngine = createRulesEngine(config);
  const store = createRequestStore(docClient, tableName);
  const provisioner = createProvisioner(config);
  const emailService = createEmailService(sesClient, sesFromAddress, portalBaseUrl);
  const accessAgent = createAccessAgent(rulesEngine, store, provisioner, emailService);

  // --- LLM for chat assistant ---
  const { createLLM } = await import('./llm.js');
  const llm = createLLM();

  // --- Express server ---
  const app = createServer({ store, accessAgent, configManager, llm });

  app.listen(port, () => {
    console.log(`AccessDesk listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start AccessDesk:', err);
  process.exit(1);
});
