import { describe, it, expect, vi } from 'vitest';
import { createConfigManager, clampFollowUpWindow } from '../../src/config.js';
import { DEFAULT_CONFIG, SSM_PARAMS } from '../../src/constants.js';

function mockSSM(paramValues = {}) {
  return { send: vi.fn(async (cmd) => {
    const name = cmd.input?.Name;
    if (name && name in paramValues) return { Parameter: { Value: paramValues[name] } };
    throw new Error(`Not found: ${name}`);
  }) };
}

describe('clampFollowUpWindow', () => {
  it('clamps below min to 15', () => { expect(clampFollowUpWindow(1)).toBe(15); });
  it('clamps above max to 4320', () => { expect(clampFollowUpWindow(9999)).toBe(4320); });
  it('passes through valid value', () => { expect(clampFollowUpWindow(120)).toBe(120); });
});

describe('createConfigManager', () => {
  it('reads all params from SSM', async () => {
    const ssm = mockSSM({
      [SSM_PARAMS.accessCatalog]: JSON.stringify([{ toolName: 'Figma' }]),
      [SSM_PARAMS.defaultApproverId]: 'U_ADMIN',
      [SSM_PARAMS.defaultChannelId]: 'C_APPROVALS',
      [SSM_PARAMS.followUpWindow]: '30',
      [SSM_PARAMS.providerType]: 'okta',
    });
    const mgr = createConfigManager(ssm);
    const cfg = await mgr.loadConfig();
    expect(cfg.accessCatalog).toEqual([{ toolName: 'Figma' }]);
    expect(cfg.defaultApproverId).toBe('U_ADMIN');
    expect(cfg.providerType).toBe('okta');
  });

  it('returns defaults when SSM fails', async () => {
    const ssm = mockSSM({});
    const mgr = createConfigManager(ssm);
    const cfg = await mgr.loadConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});
