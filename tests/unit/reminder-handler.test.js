import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isReminderDue } from '../../src/lambda/reminder-handler.js';
import { MAX_APPROVAL_REMINDERS } from '../../src/constants.js';

const MINUTE_MS = 60 * 1000;
const WINDOW = 60; // minutes

/** Build a pending_approval request created `ageMinutes` before `nowMs`. */
function pendingRequest(overrides = {}, ageMinutes = 0, nowMs = Date.now()) {
  return {
    id: 'req-1',
    toolName: 'Camtasia',
    approverId: 'manager@example.com',
    employeeName: 'Test Employee',
    jobLevel: 'intern',
    reminders: 0,
    createdAt: new Date(nowMs - ageMinutes * MINUTE_MS).toISOString(),
    tokenExpiresAt: new Date(nowMs + 72 * 60 * MINUTE_MS).toISOString(),
    ...overrides,
  };
}

describe('isReminderDue', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z');

  it('is not due before the follow-up window elapses', () => {
    const req = pendingRequest({}, 59, now);
    expect(isReminderDue(req, WINDOW, now)).toEqual({ due: false, skipReason: 'not yet due' });
  });

  it('is due once the follow-up window has elapsed', () => {
    const req = pendingRequest({}, 60, now);
    expect(isReminderDue(req, WINDOW, now).due).toBe(true);
  });

  it('spaces subsequent reminders one window apart', () => {
    // One reminder already sent: next is due at createdAt + 2 windows.
    const notYet = pendingRequest({ reminders: 1 }, 119, now);
    expect(isReminderDue(notYet, WINDOW, now).due).toBe(false);

    const due = pendingRequest({ reminders: 1 }, 120, now);
    expect(isReminderDue(due, WINDOW, now).due).toBe(true);
  });

  it('stops after MAX_APPROVAL_REMINDERS', () => {
    const req = pendingRequest({ reminders: MAX_APPROVAL_REMINDERS }, 10_000, now);
    expect(isReminderDue(req, WINDOW, now)).toEqual({
      due: false,
      skipReason: 'reminder limit reached',
    });
  });

  it('skips requests whose approval token has expired', () => {
    const req = pendingRequest(
      { tokenExpiresAt: new Date(now - MINUTE_MS).toISOString() },
      500,
      now
    );
    expect(isReminderDue(req, WINDOW, now)).toEqual({
      due: false,
      skipReason: 'approval token expired',
    });
  });

  it('skips requests with no approver', () => {
    const req = pendingRequest({ approverId: null }, 500, now);
    expect(isReminderDue(req, WINDOW, now)).toEqual({
      due: false,
      skipReason: 'no approver on request',
    });
  });

  it('skips requests with an unparseable createdAt', () => {
    const req = pendingRequest({ createdAt: 'not-a-date' }, 0, now);
    expect(isReminderDue(req, WINDOW, now)).toEqual({
      due: false,
      skipReason: 'unparseable createdAt',
    });
  });

  it('never sends more than MAX_APPROVAL_REMINDERS regardless of age or window', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 15, max: 4320 }),
        fc.integer({ min: 0, max: 100_000 }),
        (reminders, window, ageMinutes) => {
          const req = pendingRequest({ reminders }, ageMinutes, now);
          const { due } = isReminderDue(req, window, now);
          if (reminders >= MAX_APPROVAL_REMINDERS) {
            expect(due).toBe(false);
          }
        }
      )
    );
  });

  it('is monotonic in age: once due, staying pending keeps it due', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 4320 }),
        fc.integer({ min: 0, max: MAX_APPROVAL_REMINDERS - 1 }),
        fc.integer({ min: 0, max: 50_000 }),
        (window, reminders, ageMinutes) => {
          const earlier = isReminderDue(pendingRequest({ reminders }, ageMinutes, now), window, now);
          if (earlier.due) {
            const later = isReminderDue(
              pendingRequest({ reminders }, ageMinutes + 1, now),
              window,
              now
            );
            expect(later.due).toBe(true);
          }
        }
      )
    );
  });
});
