import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAccessAgent } from '../../src/access-agent.js';

function createMockStore() {
  const requests = new Map();
  const profiles = new Map();
  const catalog = new Map();

  return {
    requests,
    profiles,
    catalog,
    async getCatalogEntry(toolName, accessLevel) {
      return catalog.get(`${toolName}#${accessLevel}`) || null;
    },
    async getRequest(id) {
      return requests.get(id) || null;
    },
    async updateRequestStatus(id, newStatus, extraFields = {}) {
      const req = requests.get(id);
      if (!req) throw new Error(`Request not found: ${id}`);
      req.status = newStatus;
      Object.assign(req, extraFields);
      req.updatedAt = new Date().toISOString();
    },
    async addGrantedAccess(employeeId, entry) {
      const profile = profiles.get(employeeId);
      if (!profile) throw new Error(`Employee profile not found: ${employeeId}`);
      const existing = profile.grantedAccess.findIndex(
        (g) => g.toolName === entry.toolName && g.accessLevel === entry.accessLevel
      );
      if (existing >= 0) {
        profile.grantedAccess[existing] = entry;
      } else {
        profile.grantedAccess.push(entry);
      }
      profile.totalMonthlyCost = profile.grantedAccess.reduce((s, g) => s + g.monthlyCost, 0);
    },
    async getEmployeeProfile(employeeId) {
      return profiles.get(employeeId) || null;
    },
  };
}

function createMockRulesEngine(decision) {
  return {
    checkRules: vi.fn(() => decision),
  };
}

function createMockProvisioner(result) {
  return {
    provision: vi.fn(async () => result),
  };
}

function createMockEmailService() {
  return {
    sendApprovalEmail: vi.fn(async () => ({ success: true })),
    sendGrantedNotification: vi.fn(async () => ({ success: true })),
    sendRejectedNotification: vi.fn(async () => ({ success: true })),
  };
}

const CATALOG_ENTRY = {
  toolName: 'Figma',
  accessLevel: 'standard',
  description: 'Design tool',
  monthlyCostPerUser: 15,
  autoGrantJobLevels: ['engineer', 'senior_engineer'],
  requiresApprovalAlways: false,
  defaultApproverEmail: 'lead@co.com',
  defaultApproverName: 'Lead',
};

const EMPLOYEE = {
  employeeId: 'emp-001',
  name: 'Jane',
  email: 'jane@co.com',
  jobLevel: 'senior_engineer',
  department: 'Eng',
  grantedAccess: [],
  totalMonthlyCost: 0,
};

function seedRequest(store, overrides = {}) {
  const req = {
    id: 'req-1',
    toolName: 'Figma',
    accessLevel: 'standard',
    reason: 'Need it',
    status: 'pending_evaluation',
    employeeId: 'emp-001',
    employeeName: 'Jane',
    employeeEmail: 'jane@co.com',
    monthlyCost: 15,
    approvalToken: null,
    tokenExpiresAt: null,
    ...overrides,
  };
  store.requests.set(req.id, req);
  return req;
}

describe('access-agent', () => {
  let store, emailService;

  beforeEach(() => {
    store = createMockStore();
    store.catalog.set('Figma#standard', CATALOG_ENTRY);
    store.profiles.set('emp-001', { ...EMPLOYEE, grantedAccess: [], totalMonthlyCost: 0 });
    emailService = createMockEmailService();
  });

  describe('evaluateRequest — auto_grant path', () => {
    it('provisions and updates profile on successful auto-grant', async () => {
      const rulesEngine = createMockRulesEngine({
        decision: 'auto_grant',
        reason: 'Eligible',
        approverId: null,
        approverName: null,
      });
      const provisioner = createMockProvisioner({ success: true, message: 'Done' });
      const agent = createAccessAgent(rulesEngine, store, provisioner, emailService);

      const request = seedRequest(store);
      const result = await agent.evaluateRequest(request, EMPLOYEE);

      expect(result.status).toBe('provisioned');
      expect(result.autoGranted).toBe(true);
      expect(provisioner.provision).toHaveBeenCalledOnce();

      const profile = await store.getEmployeeProfile('emp-001');
      expect(profile.grantedAccess).toHaveLength(1);
      expect(profile.totalMonthlyCost).toBe(15);
    });

    it('marks failed and does NOT update profile on provisioning failure', async () => {
      const rulesEngine = createMockRulesEngine({
        decision: 'auto_grant',
        reason: 'Eligible',
        approverId: null,
        approverName: null,
      });
      const provisioner = createMockProvisioner({ success: false, error: 'Okta down' });
      const agent = createAccessAgent(rulesEngine, store, provisioner, emailService);

      const request = seedRequest(store);
      const result = await agent.evaluateRequest(request, EMPLOYEE);

      expect(result.status).toBe('failed');
      expect(result.failureReason).toBe('Okta down');

      const profile = await store.getEmployeeProfile('emp-001');
      expect(profile.grantedAccess).toHaveLength(0);
      expect(profile.totalMonthlyCost).toBe(0);
    });
  });

  describe('evaluateRequest — needs_approval path', () => {
    it('sets pending_approval, generates token, and sends approval email', async () => {
      const rulesEngine = createMockRulesEngine({
        decision: 'needs_approval',
        reason: 'Not eligible',
        approverId: 'lead@co.com',
        approverName: 'Lead',
      });
      const provisioner = createMockProvisioner({ success: true, message: 'Done' });
      const agent = createAccessAgent(rulesEngine, store, provisioner, emailService);

      const request = seedRequest(store);
      const result = await agent.evaluateRequest(request, EMPLOYEE);

      expect(result.status).toBe('pending_approval');
      expect(result.approverId).toBe('lead@co.com');
      expect(result.approvalToken).toBeTruthy();
      expect(result.tokenExpiresAt).toBeTruthy();
      expect(emailService.sendApprovalEmail).toHaveBeenCalledOnce();
      expect(provisioner.provision).not.toHaveBeenCalled();
    });
  });

  describe('processApproverDecision — approve', () => {
    it('provisions, updates profile, and sends granted email', async () => {
      const rulesEngine = createMockRulesEngine({});
      const provisioner = createMockProvisioner({ success: true, message: 'Provisioned' });
      const agent = createAccessAgent(rulesEngine, store, provisioner, emailService);

      const token = 'valid-token-abc';
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      seedRequest(store, {
        status: 'pending_approval',
        approvalToken: token,
        tokenExpiresAt: expiresAt,
      });

      const result = await agent.processApproverDecision('req-1', token, 'approve', null);

      expect(result.status).toBe('provisioned');
      expect(provisioner.provision).toHaveBeenCalledOnce();
      expect(emailService.sendGrantedNotification).toHaveBeenCalledOnce();

      const profile = await store.getEmployeeProfile('emp-001');
      expect(profile.grantedAccess).toHaveLength(1);
      expect(profile.totalMonthlyCost).toBe(15);
    });

    it('marks failed and does NOT update profile on provisioning failure', async () => {
      const rulesEngine = createMockRulesEngine({});
      const provisioner = createMockProvisioner({ success: false, error: 'Timeout' });
      const agent = createAccessAgent(rulesEngine, store, provisioner, emailService);

      const token = 'valid-token-abc';
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      seedRequest(store, {
        status: 'pending_approval',
        approvalToken: token,
        tokenExpiresAt: expiresAt,
      });

      const result = await agent.processApproverDecision('req-1', token, 'approve', null);

      expect(result.status).toBe('failed');
      expect(emailService.sendGrantedNotification).not.toHaveBeenCalled();

      const profile = await store.getEmployeeProfile('emp-001');
      expect(profile.grantedAccess).toHaveLength(0);
      expect(profile.totalMonthlyCost).toBe(0);
    });
  });

  describe('processApproverDecision — reject', () => {
    it('marks rejected and sends rejection email', async () => {
      const rulesEngine = createMockRulesEngine({});
      const provisioner = createMockProvisioner({ success: true, message: 'Done' });
      const agent = createAccessAgent(rulesEngine, store, provisioner, emailService);

      const token = 'valid-token-abc';
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      seedRequest(store, {
        status: 'pending_approval',
        approvalToken: token,
        tokenExpiresAt: expiresAt,
      });

      const result = await agent.processApproverDecision('req-1', token, 'reject', 'Not needed');

      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toBe('Not needed');
      expect(emailService.sendRejectedNotification).toHaveBeenCalledOnce();
      expect(provisioner.provision).not.toHaveBeenCalled();
    });
  });

  describe('processApproverDecision — token validation', () => {
    it('throws on invalid token', async () => {
      const agent = createAccessAgent(
        createMockRulesEngine({}),
        store,
        createMockProvisioner({ success: true, message: '' }),
        emailService
      );

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      seedRequest(store, {
        status: 'pending_approval',
        approvalToken: 'real-token',
        tokenExpiresAt: expiresAt,
      });

      await expect(
        agent.processApproverDecision('req-1', 'wrong-token', 'approve', null)
      ).rejects.toThrow('Invalid token');
    });

    it('throws on expired token', async () => {
      const agent = createAccessAgent(
        createMockRulesEngine({}),
        store,
        createMockProvisioner({ success: true, message: '' }),
        emailService
      );

      const expiredAt = new Date(Date.now() - 1000).toISOString();
      seedRequest(store, {
        status: 'pending_approval',
        approvalToken: 'real-token',
        tokenExpiresAt: expiredAt,
      });

      await expect(
        agent.processApproverDecision('req-1', 'real-token', 'approve', null)
      ).rejects.toThrow('Token expired');
    });

    it('throws on non-existent request', async () => {
      const agent = createAccessAgent(
        createMockRulesEngine({}),
        store,
        createMockProvisioner({ success: true, message: '' }),
        emailService
      );

      await expect(
        agent.processApproverDecision('nonexistent', 'token', 'approve', null)
      ).rejects.toThrow('Request not found');
    });
  });
});
