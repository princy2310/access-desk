/**
 * Config manager — reads SSM Parameter Store, caches with TTL.
 * @module config
 */

import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { SSM_PARAMS, DEFAULT_CONFIG, MIN_FOLLOW_UP_WINDOW, MAX_FOLLOW_UP_WINDOW } from './constants.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function clampFollowUpWindow(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CONFIG.followUpWindow;
  return Math.min(MAX_FOLLOW_UP_WINDOW, Math.max(MIN_FOLLOW_UP_WINDOW, num));
}

async function readParam(ssmClient, name) {
  try {
    const res = await ssmClient.send(new GetParameterCommand({ Name: name }));
    return res.Parameter?.Value;
  } catch { return undefined; }
}

async function fetchConfig(ssmClient) {
  const [catalogRaw, defaultApproverRaw, defaultChannelRaw, followUpRaw, providerRaw] = await Promise.all([
    readParam(ssmClient, SSM_PARAMS.accessCatalog),
    readParam(ssmClient, SSM_PARAMS.defaultApproverId),
    readParam(ssmClient, SSM_PARAMS.defaultChannelId),
    readParam(ssmClient, SSM_PARAMS.followUpWindow),
    readParam(ssmClient, SSM_PARAMS.providerType),
  ]);

  return {
    accessCatalog: catalogRaw !== undefined ? safeParse(catalogRaw, DEFAULT_CONFIG.accessCatalog) : DEFAULT_CONFIG.accessCatalog,
    defaultApproverId: defaultApproverRaw ?? DEFAULT_CONFIG.defaultApproverId,
    defaultChannelId: defaultChannelRaw ?? DEFAULT_CONFIG.defaultChannelId,
    followUpWindow: clampFollowUpWindow(followUpRaw ?? DEFAULT_CONFIG.followUpWindow),
    providerType: providerRaw ?? DEFAULT_CONFIG.providerType,
  };
}

export function createConfigManager(ssmClient, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  let cached = null;
  let cachedAt = 0;

  async function loadConfig() {
    try {
      const config = await fetchConfig(ssmClient);
      cached = config;
      cachedAt = Date.now();
      return config;
    } catch { return cached ?? { ...DEFAULT_CONFIG }; }
  }

  async function getConfig() {
    if (cached && Date.now() - cachedAt < ttlMs) return cached;
    return loadConfig();
  }

  return { loadConfig, getConfig };
}
