/**
 * LLM provider — calls Amazon Bedrock (Claude) for natural language understanding.
 * @module llm
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';

/**
 * @param {Object} opts
 * @param {string} [opts.modelId] - Bedrock model ID
 * @param {string} [opts.region] - AWS region
 * @returns {{ complete: (systemPrompt: string, userMessage: string) => Promise<string> }}
 */
export function createLLM(opts = {}) {
  const modelId = opts.modelId || process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL;
  const client = new BedrockRuntimeClient({ region: opts.region || process.env.AWS_REGION || 'us-east-1' });

  async function complete(systemPrompt, userMessage) {
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const resp = await client.send(new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }));

    const result = JSON.parse(new TextDecoder().decode(resp.body));
    return result.content?.[0]?.text || '';
  }

  return { complete };
}
