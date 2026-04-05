/**
 * Shared constants for AccessDesk.
 * @module constants
 */

export const SSM_PREFIX = '/access-desk/';

export const SSM_PARAMS = {
  accessCatalog: `${SSM_PREFIX}accessCatalog`,
  defaultApproverId: `${SSM_PREFIX}defaultApproverId`,
  defaultChannelId: `${SSM_PREFIX}defaultChannelId`,
  followUpWindow: `${SSM_PREFIX}followUpWindow`,
  providerType: `${SSM_PREFIX}providerType`,
  sesFromAddress: `${SSM_PREFIX}sesFromAddress`,
  portalBaseUrl: `${SSM_PREFIX}portalBaseUrl`,
};

export const DEFAULT_CONFIG = {
  accessCatalog: [],
  defaultApproverId: '',
  defaultChannelId: '',
  followUpWindow: 60,
  providerType: 'mock',
};

export const REQUEST_STATUSES = [
  'pending_evaluation',
  'approved',
  'pending_approval',
  'rejected',
  'provisioned',
  'failed',
];

/**
 * Valid status transitions for access requests.
 * Auto-grant path: pending_evaluation → approved → provisioned
 * Escalation path: pending_evaluation → pending_approval → approved → provisioned
 * Rejected only from pending_approval; failed only from approved.
 * @type {Record<string, string[]>}
 */
export const VALID_STATUS_TRANSITIONS = {
  pending_evaluation: ['approved', 'pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['provisioned', 'failed'],
};

/** Approval token expiry: 72 hours in milliseconds */
export const APPROVAL_TOKEN_EXPIRY_MS = 72 * 60 * 60 * 1000;

export const MAX_APPROVAL_REMINDERS = 3;

export const MIN_FOLLOW_UP_WINDOW = 15;
export const MAX_FOLLOW_UP_WINDOW = 4320;
