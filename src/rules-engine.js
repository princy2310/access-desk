/**
 * Rules engine — evaluates access requests against catalog rules.
 * @module rules-engine
 */

/**
 * Creates a rules engine that checks access catalog rules.
 * @param {import('./types.js').AppConfig} config
 * @returns {{ checkRules: (toolName: string, employeeProfile: import('./types.js').EmployeeProfile, catalogEntry: import('./types.js').CatalogEntry) => import('./types.js').RuleCheckResult, isKnownTool: (toolName: string) => boolean }}
 */
export function createRulesEngine(config) {
  const catalogByTool = new Map();
  for (const entry of config.accessCatalog) {
    catalogByTool.set(entry.toolName, entry);
  }

  /**
   * Check whether a tool exists in the access catalog.
   * @param {string} toolName
   * @returns {boolean}
   */
  function isKnownTool(toolName) {
    return catalogByTool.has(toolName);
  }

  /**
   * Evaluate rules for a tool + employee combination.
   * @param {string} toolName
   * @param {import('./types.js').EmployeeProfile} employeeProfile
   * @param {import('./types.js').CatalogEntry} catalogEntry
   * @returns {import('./types.js').RuleCheckResult}
   */
  function checkRules(toolName, employeeProfile, catalogEntry) {
    // Rule 1: Always-approval-required tools
    if (catalogEntry.requiresApprovalAlways === true) {
      return {
        decision: 'needs_approval',
        reason: `${toolName} always requires human approval`,
        approverId: catalogEntry.defaultApproverEmail,
        approverName: catalogEntry.defaultApproverName,
      };
    }

    // Rule 2: Job level check
    if (!catalogEntry.autoGrantJobLevels.includes(employeeProfile.jobLevel)) {
      return {
        decision: 'needs_approval',
        reason: `Job level '${employeeProfile.jobLevel}' not eligible for auto-grant of ${toolName}`,
        approverId: catalogEntry.defaultApproverEmail,
        approverName: catalogEntry.defaultApproverName,
      };
    }

    // All rules passed — auto-grant
    return {
      decision: 'auto_grant',
      reason: `Employee job level '${employeeProfile.jobLevel}' is eligible for ${toolName} (${catalogEntry.accessLevel})`,
      approverId: null,
      approverName: null,
    };
  }

  return { checkRules, isKnownTool };
}
