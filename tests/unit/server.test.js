/**
 * Unit tests for Express API server (src/server.js).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { createServer } from '../../src/server.js';

/** Minimal mock store with controllable returns. */
function createMockStore(overrides = {}) {
  const catalog = overrides.catalog || [];
  const profiles = overrides.profiles || {};
  const requestsByEmployee = overrides.requestsByEmployee || {};
  const requestsByStatus = overrides.requestsByStatus || {};
  const requests = {};

  return {
    async getCatalogEntry(toolName, accessLevel) {
      return catalog.find((c) => c.toolName === toolName && c.accessLevel === accessLevel) || null;
    },
    async getAllCatalogEntries() { return catalog; },
    async getEmployeeProfile(id) { return profiles[id] || null; },
    async createRequest(req) {
      const id = 'req-' + Math.random().toString(36).slice(2, 8);
      const saved = { id, ...req, status: 'pending_evaluation' };
      requests[id] = saved;
      return saved;
    },
    async getRequest(id) { return requests[id] || null; },
    async getRequestsByEmployee(employeeId) { return requestsByEmployee[employeeId] || []; },
    async getRequestsByStatus(status) { return requestsByStatus[status] || []; },
    async getPendingRequests() { return requestsByStatus['pending_approval'] || []; },
  };
}

function createMockAgent(overrides = {}) {
  return {
    async evaluateRequest(request, profile) {
      if (overrides.evaluateResult) return overrides.evaluateResult;
      return { ...request, status: 'provisioned', autoGranted: true };
    },
    async processApproverDecision(requestId, token, decision, reason) {
      if (overrides.processError) throw overrides.processError;
      return overrides.processResult || { id: requestId, status: decision === 'approve' ? 'approved' : 'rejected' };
    },
  };
}

/** Make an HTTP request to the test server. */
function fetch(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const CATALOG = [
  {
    toolName: 'Figma', accessLevel: 'standard', description: 'Design tool',
    monthlyCostPerUser: 15, autoGrantJobLevels: ['engineer'], requiresApprovalAlways: false,
    defaultApproverEmail: 'lead@co.com', defaultApproverName: 'Lead',
  },
];

const PROFILES = {
  'emp-001': {
    employeeId: 'emp-001', name: 'Jane', email: 'jane@co.com',
    jobLevel: 'engineer', department: 'Eng', grantedAccess: [], totalMonthlyCost: 0,
  },
};

describe('Express API Server', () => {
  let server;

  afterEach(() => {
    if (server?.listening) server.close();
  });

  function startServer(storeOverrides = {}, agentOverrides = {}) {
    const store = createMockStore({ catalog: CATALOG, profiles: PROFILES, ...storeOverrides });
    const accessAgent = createMockAgent(agentOverrides);
    const configManager = { getConfig: async () => ({}) };
    const app = createServer({ store, accessAgent, configManager, llm: null });
    return new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  // --- POST /api/requests ---

  describe('POST /api/requests', () => {
    it('returns 400 when tool not in catalog', async () => {
      const srv = await startServer();
      const res = await fetch(srv, 'POST', '/api/requests', {
        toolName: 'Unknown', accessLevel: 'admin', reason: 'need it', employeeId: 'emp-001',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not found in catalog');
      expect(res.body.availableTools).toBeDefined();
      expect(res.body.availableTools.length).toBe(1);
    });

    it('returns 404 when employee profile not found', async () => {
      const srv = await startServer();
      const res = await fetch(srv, 'POST', '/api/requests', {
        toolName: 'Figma', accessLevel: 'standard', reason: 'need it', employeeId: 'emp-999',
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Employee profile not found');
    });

    it('creates request and returns evaluation result', async () => {
      const srv = await startServer();
      const res = await fetch(srv, 'POST', '/api/requests', {
        toolName: 'Figma', accessLevel: 'standard', reason: 'design sprint', employeeId: 'emp-001',
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('provisioned');
    });
  });

  // --- GET /api/requests ---

  describe('GET /api/requests', () => {
    it('returns requests filtered by employeeId', async () => {
      const reqs = [{ id: 'r1', toolName: 'Figma', employeeId: 'emp-001', status: 'provisioned' }];
      const srv = await startServer({ requestsByEmployee: { 'emp-001': reqs } });
      const res = await fetch(srv, 'GET', '/api/requests?employeeId=emp-001');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(reqs);
    });

    it('returns requests filtered by status', async () => {
      const reqs = [{ id: 'r2', toolName: 'Figma', status: 'pending_approval' }];
      const srv = await startServer({ requestsByStatus: { pending_approval: reqs } });
      const res = await fetch(srv, 'GET', '/api/requests?status=pending_approval');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(reqs);
    });

    it('returns pending requests when no filter', async () => {
      const reqs = [{ id: 'r3', status: 'pending_approval' }];
      const srv = await startServer({ requestsByStatus: { pending_approval: reqs } });
      const res = await fetch(srv, 'GET', '/api/requests');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(reqs);
    });
  });

  // --- POST /api/requests/:id/approve and reject ---

  describe('POST /api/requests/:id/approve', () => {
    it('approves with valid token from query param', async () => {
      const srv = await startServer({}, { processResult: { id: 'r1', status: 'approved' } });
      const res = await fetch(srv, 'POST', '/api/requests/r1/approve?token=abc123');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
    });

    it('returns 400 for expired token', async () => {
      const srv = await startServer({}, { processError: new Error('Token expired') });
      const res = await fetch(srv, 'POST', '/api/requests/r1/approve?token=expired');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('expired');
    });

    it('returns 400 for invalid token', async () => {
      const srv = await startServer({}, { processError: new Error('Invalid token') });
      const res = await fetch(srv, 'POST', '/api/requests/r1/approve?token=wrong');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 409 for already-processed request', async () => {
      const srv = await startServer({}, { processError: new Error('Invalid status transition: approved → approved') });
      const res = await fetch(srv, 'POST', '/api/requests/r1/approve?token=abc');
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already been processed');
    });
  });

  describe('POST /api/requests/:id/reject', () => {
    it('rejects with valid token from body', async () => {
      const srv = await startServer({}, { processResult: { id: 'r1', status: 'rejected' } });
      const res = await fetch(srv, 'POST', '/api/requests/r1/reject', { token: 'abc123', reason: 'Not needed' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });

    it('returns 400 for expired token on reject', async () => {
      const srv = await startServer({}, { processError: new Error('Token expired') });
      const res = await fetch(srv, 'POST', '/api/requests/r1/reject', { token: 'expired' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('expired');
    });
  });

  // --- GET /api/employees/:id/profile ---

  describe('GET /api/employees/:id/profile', () => {
    it('returns employee profile', async () => {
      const srv = await startServer();
      const res = await fetch(srv, 'GET', '/api/employees/emp-001/profile');
      expect(res.status).toBe(200);
      expect(res.body.employeeId).toBe('emp-001');
      expect(res.body.name).toBe('Jane');
      expect(res.body.totalMonthlyCost).toBe(0);
    });

    it('returns 404 for unknown employee', async () => {
      const srv = await startServer();
      const res = await fetch(srv, 'GET', '/api/employees/emp-999/profile');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Employee profile not found');
    });
  });

  // --- GET /api/catalog ---

  describe('GET /api/catalog', () => {
    it('returns all catalog entries', async () => {
      const srv = await startServer();
      const res = await fetch(srv, 'GET', '/api/catalog');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].toolName).toBe('Figma');
    });
  });
});
