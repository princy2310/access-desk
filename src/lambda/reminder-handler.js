/**
 * Scheduled reminder handler.
 *
 * Invoked by the ReminderSchedule EventBridge rule (every 15 minutes). Finds
 * access requests still sitting in `pending_approval` and re-sends the approval
 * email to the approver, up to MAX_APPROVAL_REMINDERS times.
 *
 * Reminder timing is derived from `createdAt` and the `reminders` counter rather
 * than from `updatedAt`, so the schedule is deterministic and unaffected by other
 * writes to the item:
 *
 *   nth reminder is due at createdAt + (n * followUpWindow)
 *
 * With the default 60-minute window, an unanswered request is nudged at +60, +120,
 * and +180 minutes, then left alone.
 *
 * @module lambda/reminder-handler
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SESClient } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { createConfigManager } from '../config.js';
import { createRequestStore } from '../store.js';
import { createEmailService } from '../email-service.js';
import { SSM_PARAMS, MAX_APPROVAL_REMINDERS } from '../constants.js';

/** Read a single SSM parameter, returning undefined on failure. */
async function readParam(ssmClient, name) {
  try {
    const res = await ssmClient.send(new GetParameterCommand({ Name: name }));
    return res.Parameter?.Value;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a pending request is due for its next reminder.
 * Exported for unit testing.
 *
 * @param {object} request - Access request record
 * @param {number} followUpWindowMinutes
 * @param {number} nowMs
 * @returns {{ due: boolean, skipReason?: string }}
 */
export function isReminderDue(request, followUpWindowMinutes, nowMs) {
  const sent = Number(request.reminders) || 0;

  if (sent >= MAX_APPROVAL_REMINDERS) {
    return { due: false, skipReason: 'reminder limit reached' };
  }

  if (!request.approverId) {
    return { due: false, skipReason: 'no approver on request' };
  }

  // An expired token makes the approve/reject links useless, so nudging is pointless.
  if (request.tokenExpiresAt && Date.parse(request.tokenExpiresAt) <= nowMs) {
    return { due: false, skipReason: 'approval token expired' };
  }

  const createdMs = Date.parse(request.createdAt);
  if (!Number.isFinite(createdMs)) {
    return { due: false, skipReason: 'unparseable createdAt' };
  }

  const dueAt = createdMs + (sent + 1) * followUpWindowMinutes * 60 * 1000;
  return dueAt <= nowMs ? { due: true } : { due: false, skipReason: 'not yet due' };
}

/**
 * Lambda entry point.
 * @returns {Promise<{ scanned: number, remindersSent: number, skipped: number, failed: number }>}
 */
export async function handler() {
  const tableName = process.env.DYNAMODB_TABLE || 'AccessDesk';

  const ssmClient = new SSMClient({});
  const sesClient = new SESClient({});
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const configManager = createConfigManager(ssmClient);
  const config = await configManager.loadConfig();

  const sesFromAddress =
    process.env.SES_FROM_ADDRESS ||
    (await readParam(ssmClient, SSM_PARAMS.sesFromAddress)) ||
    'noreply@example.com';

  const portalBaseUrl =
    process.env.PORTAL_BASE_URL ||
    (await readParam(ssmClient, SSM_PARAMS.portalBaseUrl)) ||
    'http://localhost:3000';

  const store = createRequestStore(docClient, tableName);
  const emailService = createEmailService(sesClient, sesFromAddress, portalBaseUrl);

  const pending = await store.getRequestsByStatus('pending_approval');
  const now = Date.now();

  let remindersSent = 0;
  let skipped = 0;
  let failed = 0;

  for (const request of pending) {
    const { due, skipReason } = isReminderDue(request, config.followUpWindow, now);

    if (!due) {
      skipped += 1;
      continue;
    }

    try {
      // The request record carries the employee fields the approval email needs;
      // fall back to the stored profile if they are missing.
      let employeeProfile = {
        name: request.employeeName,
        jobLevel: request.jobLevel,
      };

      if (!employeeProfile.name && request.employeeId) {
        employeeProfile = (await store.getEmployeeProfile(request.employeeId)) || employeeProfile;
      }

      // approverId doubles as the approver's email address, matching access-agent.js.
      const result = await emailService.sendApprovalEmail(
        request.approverId,
        request,
        employeeProfile
      );

      if (result?.success) {
        await store.incrementReminders(request.id);
        remindersSent += 1;
        console.log(`Reminder sent for request ${request.id} (${request.toolName}) to ${request.approverId}`);
      } else {
        failed += 1;
        console.error(`Reminder email failed for request ${request.id}; counter not incremented`);
      }
    } catch (error) {
      // Never let one bad request stop the sweep.
      failed += 1;
      console.error(`Reminder failed for request ${request.id}: ${error.message}`);
    }
  }

  const summary = { scanned: pending.length, remindersSent, skipped, failed };
  console.log(`Reminder sweep complete: ${JSON.stringify(summary)}`);
  return summary;
}
