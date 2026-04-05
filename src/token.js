/**
 * Approval token generation and validation utilities.
 * @module token
 */

import crypto from 'node:crypto';
import { APPROVAL_TOKEN_EXPIRY_MS } from './constants.js';

/**
 * Generate a cryptographically secure approval token with expiry.
 * @returns {{ token: string, expiresAt: string }}
 */
export function generateApprovalToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + APPROVAL_TOKEN_EXPIRY_MS).toISOString();
  return { token, expiresAt };
}

/**
 * Validate a provided token against a request's stored token and expiry.
 * @param {{ approvalToken: string|null, tokenExpiresAt: string|null }} request
 * @param {string} providedToken
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateToken(request, providedToken) {
  if (providedToken !== request.approvalToken) {
    return { valid: false, reason: 'Invalid token' };
  }
  if (new Date() >= new Date(request.tokenExpiresAt)) {
    return { valid: false, reason: 'Token expired' };
  }
  return { valid: true };
}
