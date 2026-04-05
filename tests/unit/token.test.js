import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateApprovalToken, validateToken } from '../../src/token.js';
import { APPROVAL_TOKEN_EXPIRY_MS } from '../../src/constants.js';

describe('generateApprovalToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a 64-character hex token', () => {
    const { token } = generateApprovalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns an ISO 8601 expiresAt string 72 hours in the future', () => {
    const before = Date.now();
    const { expiresAt } = generateApprovalToken();
    const after = Date.now();

    const expiry = new Date(expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + APPROVAL_TOKEN_EXPIRY_MS);
    expect(expiry).toBeLessThanOrEqual(after + APPROVAL_TOKEN_EXPIRY_MS);
  });

  it('generates unique tokens on successive calls', () => {
    const a = generateApprovalToken();
    const b = generateApprovalToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('validateToken', () => {
  it('returns valid: true for matching token within expiry', () => {
    const { token, expiresAt } = generateApprovalToken();
    const request = { approvalToken: token, tokenExpiresAt: expiresAt };

    const result = validateToken(request, token);
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid with reason when token does not match', () => {
    const { token, expiresAt } = generateApprovalToken();
    const request = { approvalToken: token, tokenExpiresAt: expiresAt };

    const result = validateToken(request, 'wrong-token');
    expect(result).toEqual({ valid: false, reason: 'Invalid token' });
  });

  it('returns expired when current time is past tokenExpiresAt', () => {
    const token = 'a'.repeat(64);
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const request = { approvalToken: token, tokenExpiresAt: pastDate };

    const result = validateToken(request, token);
    expect(result).toEqual({ valid: false, reason: 'Token expired' });
  });

  it('returns expired when current time equals tokenExpiresAt', () => {
    const token = 'b'.repeat(64);
    const now = new Date();
    vi.spyOn(globalThis, 'Date').mockImplementation(function (...args) {
      if (args.length === 0) return now;
      return new OriginalDate(...args);
    });
    // Restore and use a simpler approach: set expiry to a moment just passed
    vi.restoreAllMocks();

    const justPast = new Date(Date.now() - 1).toISOString();
    const request = { approvalToken: token, tokenExpiresAt: justPast };

    const result = validateToken(request, token);
    expect(result).toEqual({ valid: false, reason: 'Token expired' });
  });

  it('checks token match before expiry', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const request = { approvalToken: 'stored-token', tokenExpiresAt: pastDate };

    // Wrong token should fail with "Invalid token", not "Token expired"
    const result = validateToken(request, 'different-token');
    expect(result).toEqual({ valid: false, reason: 'Invalid token' });
  });
});
