/**
 * Access provisioner — provisions access after approval.
 * Currently supports mock mode. Okta integration is a future step.
 * @module provisioner
 */

export function createProvisioner(config) {
  return {
    async provision(request, catalogEntry) {
      if (config.providerType === 'okta') {
        // Placeholder for Okta API integration
        console.log(`[Okta] Would add user ${request.requesterId} to group ${catalogEntry?.oktaGroupId}`);
        return { success: true, message: `Okta group ${catalogEntry?.oktaGroupId} — provisioning simulated` };
      }

      // Mock provisioner
      console.log(`[Mock] Provisioning access to ${request.toolName} for ${request.requesterId}`);
      return { success: true, message: `Mock access to ${request.toolName} provisioned` };
    },
  };
}
