/**
 * Email service for sending approval and notification emails via Amazon SES.
 * @module email-service
 */

import { SendEmailCommand } from '@aws-sdk/client-ses';

/**
 * Creates an email service that sends approval and notification emails.
 * @param {import('@aws-sdk/client-ses').SESClient} sesClient
 * @param {string} fromAddress - Verified SES sender address
 * @param {string} portalBaseUrl - Base URL of the web portal
 * @returns {{ sendApprovalEmail: Function, sendGrantedNotification: Function, sendRejectedNotification: Function }}
 */
export function createEmailService(sesClient, fromAddress, portalBaseUrl) {
  /**
   * Send an email via SES with retry-once on failure.
   * @param {string} toAddress
   * @param {string} subject
   * @param {string} htmlBody
   * @returns {Promise<{ success: boolean, emailFailed?: boolean }>}
   */
  async function sendWithRetry(toAddress, subject, htmlBody) {
    const params = {
      Source: fromAddress,
      Destination: { ToAddresses: [toAddress] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
      },
    };

    try {
      await sesClient.send(new SendEmailCommand(params));
      return { success: true };
    } catch (firstError) {
      console.error(`SES send failed (attempt 1): ${firstError.message}`);
      try {
        await sesClient.send(new SendEmailCommand(params));
        return { success: true };
      } catch (retryError) {
        console.error(`SES send failed (attempt 2): ${retryError.message}`);
        return { success: false, emailFailed: true };
      }
    }
  }

  /**
   * Send approval request email to approver with approve/reject links.
   * @param {string} approverEmail
   * @param {import('./types.js').AccessRequest} request
   * @param {import('./types.js').EmployeeProfile} employeeProfile
   * @returns {Promise<{ success: boolean, emailFailed?: boolean }>}
   */
  async function sendApprovalEmail(approverEmail, request, employeeProfile) {
    const approveUrl = `${portalBaseUrl}/api/requests/${request.id}/approve?token=${request.approvalToken}`;
    const rejectUrl = `${portalBaseUrl}/api/requests/${request.id}/reject?token=${request.approvalToken}`;

    const subject = `Access Request: ${employeeProfile.name} requests ${request.toolName}`;
    const htmlBody = `
      <h2>Access Request Pending Approval</h2>
      <p><strong>${employeeProfile.name}</strong> has requested access to <strong>${request.toolName}</strong> (${request.accessLevel}).</p>
      <table>
        <tr><td><strong>Requester:</strong></td><td>${employeeProfile.name}</td></tr>
        <tr><td><strong>Job Level:</strong></td><td>${employeeProfile.jobLevel}</td></tr>
        <tr><td><strong>Tool:</strong></td><td>${request.toolName}</td></tr>
        <tr><td><strong>Access Level:</strong></td><td>${request.accessLevel}</td></tr>
        <tr><td><strong>Reason:</strong></td><td>${request.reason}</td></tr>
        <tr><td><strong>Monthly Cost:</strong></td><td>$${request.monthlyCost}</td></tr>
      </table>
      <p>
        <a href="${approveUrl}" style="background:#28a745;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;margin-right:10px;">Approve</a>
        <a href="${rejectUrl}" style="background:#dc3545;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;">Reject</a>
      </p>
    `;

    return sendWithRetry(approverEmail, subject, htmlBody);
  }

  /**
   * Send notification to employee when access is granted.
   * @param {string} employeeEmail
   * @param {import('./types.js').AccessRequest} request
   * @returns {Promise<{ success: boolean, emailFailed?: boolean }>}
   */
  async function sendGrantedNotification(employeeEmail, request) {
    const subject = `Access Granted: ${request.toolName}`;
    const htmlBody = `
      <h2>Access Granted</h2>
      <p>Your request for <strong>${request.toolName}</strong> (${request.accessLevel}) has been approved and provisioned.</p>
      <p>You now have access. Monthly cost: <strong>$${request.monthlyCost}</strong>.</p>
    `;

    return sendWithRetry(employeeEmail, subject, htmlBody);
  }

  /**
   * Send notification to employee when request is rejected.
   * @param {string} employeeEmail
   * @param {import('./types.js').AccessRequest} request
   * @param {string} reason - Rejection reason
   * @returns {Promise<{ success: boolean, emailFailed?: boolean }>}
   */
  async function sendRejectedNotification(employeeEmail, request, reason) {
    const subject = `Access Rejected: ${request.toolName}`;
    const htmlBody = `
      <h2>Access Request Rejected</h2>
      <p>Your request for <strong>${request.toolName}</strong> (${request.accessLevel}) has been rejected.</p>
      <p><strong>Reason:</strong> ${reason}</p>
    `;

    return sendWithRetry(employeeEmail, subject, htmlBody);
  }

  return { sendApprovalEmail, sendGrantedNotification, sendRejectedNotification };
}
