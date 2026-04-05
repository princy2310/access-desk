import { describe, it, expect } from 'vitest';
import { createProvisioner } from '../../src/provisioner.js';

describe('createProvisioner', () => {
  it('mock provisioner returns success', async () => {
    const prov = createProvisioner({ providerType: 'mock' });
    const result = await prov.provision({ toolName: 'Figma', requesterId: 'U1' }, { oktaGroupId: 'grp-1' });
    expect(result.success).toBe(true);
  });

  it('okta provisioner returns simulated success', async () => {
    const prov = createProvisioner({ providerType: 'okta' });
    const result = await prov.provision({ toolName: 'GitHub', requesterId: 'U2' }, { oktaGroupId: 'grp-gh' });
    expect(result.success).toBe(true);
    expect(result.message).toContain('grp-gh');
  });
});
