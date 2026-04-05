/**
 * AI Access Agent — evaluates access requests and processes approver decisions.
 * @module access-agent
 */

import { generateApprovalToken, validateToken } from './token.js';

/**
 * Creates an access agent that evaluates requests and processes approver decisions.
 * @param {Object} rulesEngine
 * @param {Object} store
 * @param {Object} provisioner
 * @param {Object} emailService
 * @returns {{ evaluateRequest: Function, processApproverDecision: Function }}
 */
export function createAccessAgent(rulesEngine, store, provisioner, emailService) {
  /**
   * Evaluate an access request: auto-grant or escalate to approver.
   * @param {import('./types.js').AccessRequest} request
   * @param {import('./types.js').EmployeeProfile} employeeProfile
   * @returns {Promise<import('./types.js').AccessRequest>}
   */
  async function evaluateRequest(request, employeeProfile) {
    const catalogEntry = await store.getCatalogEntry(request.toolName, request.accessLevel);
    const result = rulesEngine.checkRules(request.toolName, employeeProfile, catalogEntry);

    if (result.decision === 'auto_grant') {
      await store.updateRequestStatus(request.id, 'approved', {
        autoGranted: true,
        agentReason: result.reason,
      });

      const provResult = await provisioner.provision(request, catalogEntry);

      if (provResult.success) {
        await store.updateRequestStatus(request.id, 'provisioned', {
          provisionResult: provResult.message,
        });
        await store.addGrantedAccess(employeeProfile.employeeId, {
          toolName: request.toolName,
          accessLevel: request.accessLevel,
          monthlyCost: catalogEntry.monthlyCostPerUser,
          grantedAt: new Date().toISOString(),
          requestId: request.id,
        });
      } else {
        await store.updateRequestStatus(request.id, 'failed', {
          failureReason: provResult.error,
        });
      }
    } else {
      // needs_approval
      const { token, expiresAt } = generateApprovalToken();

      await store.updateRequestStatus(request.id, 'pending_approval', {
        approverId: result.approverId,
        approverName: result.approverName,
        approvalToken: token,
        tokenExpiresAt: expiresAt,
        agentReason: result.reason,
      });

      const updatedRequest = await store.getRequest(request.id);
      await emailService.sendApprovalEmail(result.approverId, updatedRequest, employeeProfile);
    }

    return store.getRequest(request.id);
  }

  /**
   * Process an approver's decision (approve or reject).
   * @param {string} requestId
   * @param {string} token - Approval token from email link
   * @param {'approve' | 'reject'} decision
   * @param {string|null} reason
   * @returns {Promise<import('./types.js').AccessRequest>}
   */
  async function processApproverDecision(requestId, token, decision, reason) {
    const request = await store.getRequest(requestId);
    if (!request) {
      throw new Error(`Request not found: ${requestId}`);
    }

    const validation = validateToken(request, token);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    if (decision === 'approve') {
      await store.updateRequestStatus(requestId, 'approved');

      const catalogEntry = await store.getCatalogEntry(request.toolName, request.accessLevel);
      const provResult = await provisioner.provision(request, catalogEntry);

      if (provResult.success) {
        await store.updateRequestStatus(requestId, 'provisioned', {
          provisionResult: provResult.message,
        });
        await store.addGrantedAccess(request.employeeId, {
          toolName: request.toolName,
          accessLevel: request.accessLevel,
          monthlyCost: request.monthlyCost,
          grantedAt: new Date().toISOString(),
          requestId: request.id,
        });

        const updatedRequest = await store.getRequest(requestId);
        await emailService.sendGrantedNotification(request.employeeEmail, updatedRequest);
      } else {
        await store.updateRequestStatus(requestId, 'failed', {
          failureReason: provResult.error,
        });
      }
    } else if (decision === 'reject') {
      const rejectionReason = reason || 'Rejected by approver';
      await store.updateRequestStatus(requestId, 'rejected', {
        rejectionReason,
      });

      const updatedRequest = await store.getRequest(requestId);
      await emailService.sendRejectedNotification(request.employeeEmail, updatedRequest, rejectionReason);
    }

    return store.getRequest(requestId);
  }

  return { evaluateRequest, processApproverDecision };
}
