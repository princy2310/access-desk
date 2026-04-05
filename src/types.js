/**
 * Shared JSDoc type definitions for AccessDesk — self-service access portal.
 * @module types
 */

/**
 * @typedef {'pending_evaluation' | 'approved' | 'pending_approval' | 'rejected' | 'provisioned' | 'failed'} RequestStatus
 */

/**
 * @typedef {'normal' | 'urgent'} Urgency
 */

/**
 * @typedef {'auto_grant' | 'needs_approval'} AgentDecision
 */

/**
 * @typedef {Object} AccessRequest
 * @property {string} id
 * @property {string} toolName - Tool/service being requested
 * @property {string} accessLevel - e.g. "standard", "admin"
 * @property {string} reason - Why access is needed
 * @property {Urgency} urgency
 * @property {RequestStatus} status
 * @property {string} employeeId - Employee who submitted the request
 * @property {string} employeeName
 * @property {string} employeeEmail
 * @property {string} jobLevel - Employee's job level at time of request
 * @property {boolean} autoGranted - Whether AI agent auto-granted this
 * @property {string|null} agentReason - AI agent's decision explanation
 * @property {string|null} approverId - Approver email (if escalated)
 * @property {string|null} approverName
 * @property {string|null} approvalToken - Secure token for email approve/reject links
 * @property {string|null} tokenExpiresAt - Expiry for approval token
 * @property {number} monthlyCost - Subscription cost for this tool
 * @property {string|null} oktaGroupId
 * @property {string|null} provisionResult
 * @property {string|null} rejectionReason
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} ParsedAccessRequest
 * @property {string|null} toolName
 * @property {string} reason
 * @property {Urgency} urgency
 */

/**
 * @typedef {Object} EmployeeProfile
 * @property {string} employeeId
 * @property {string} name
 * @property {string} email
 * @property {string} jobLevel - "intern" | "engineer" | "senior_engineer" | "manager" | "director" | "vp"
 * @property {string} department
 * @property {GrantedAccess[]} grantedAccess - Software currently provisioned
 * @property {number} totalMonthlyCost - Computed sum of all grantedAccess[].monthlyCost
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} GrantedAccess
 * @property {string} toolName
 * @property {string} accessLevel
 * @property {number} monthlyCost - Subscription cost per month ($)
 * @property {string} grantedAt
 * @property {string} requestId - Reference to the original request
 */

/**
 * @typedef {Object} CatalogEntry
 * @property {string} toolName
 * @property {string} description
 * @property {string} accessLevel
 * @property {string} oktaGroupId
 * @property {number} monthlyCostPerUser - Subscription cost per user per month ($)
 * @property {string[]} autoGrantJobLevels - Job levels eligible for auto-grant
 * @property {boolean} requiresApprovalAlways - Override: always escalate
 * @property {string} defaultApproverEmail - Approver email for escalation
 * @property {string} defaultApproverName
 */

/**
 * @typedef {Object} RuleCheckResult
 * @property {AgentDecision} decision
 * @property {string} reason
 * @property {string|null} approverId
 * @property {string|null} approverName
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {AgentDecision} decision
 * @property {string} reason - Human-readable explanation
 * @property {string|null} approverId - Email of approver (if needs_approval)
 * @property {string|null} approverName - Name of approver (if needs_approval)
 */

/**
 * @typedef {Object} AppConfig
 * @property {CatalogEntry[]} accessCatalog
 * @property {string} defaultApproverEmail
 * @property {string} portalBaseUrl
 * @property {string} sesFromAddress
 * @property {number} followUpWindow - minutes
 * @property {string} providerType - 'okta' | 'mock'
 */
