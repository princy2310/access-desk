import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequestStore } from '../../src/store.js';

function mockDocClient() { return { send: vi.fn().mockResolvedValue({}) }; }

describe('createRequestStore', () => {
  let doc, store;
  beforeEach(() => { doc = mockDocClient(); store = createRequestStore(doc, 'T'); });

  it('createRequest generates id and sets defaults', async () => {
    const result = await store.createRequest({ toolName: 'Figma', requesterId: 'U1' });
    expect(result.id).toBeDefined();
    expect(result.status).toBe('pending_evaluation');
    expect(result.reminders).toBe(0);
    expect(result.toolName).toBe('Figma');
  });

  it('createRequest sets new lifecycle fields with defaults', async () => {
    const result = await store.createRequest({ toolName: 'Figma', reason: 'Need it' });
    expect(result.autoGranted).toBe(false);
    expect(result.agentReason).toBeNull();
    expect(result.approverId).toBeNull();
    expect(result.approverName).toBeNull();
    expect(result.approvalToken).toBeNull();
    expect(result.tokenExpiresAt).toBeNull();
    expect(result.monthlyCost).toBe(0);
    expect(result.provisionResult).toBeNull();
    expect(result.rejectionReason).toBeNull();
  });

  it('createRequest preserves provided lifecycle fields', async () => {
    const result = await store.createRequest({
      toolName: 'Figma', accessLevel: 'standard', employeeId: 'emp-001',
      employeeName: 'Jane', employeeEmail: 'jane@co.com', jobLevel: 'engineer',
      monthlyCost: 15, autoGranted: true, agentReason: 'Eligible',
    });
    expect(result.accessLevel).toBe('standard');
    expect(result.employeeId).toBe('emp-001');
    expect(result.employeeName).toBe('Jane');
    expect(result.employeeEmail).toBe('jane@co.com');
    expect(result.jobLevel).toBe('engineer');
    expect(result.monthlyCost).toBe(15);
    expect(result.autoGranted).toBe(true);
    expect(result.agentReason).toBe('Eligible');
  });

  it('getRequest returns null when not found', async () => {
    doc.send.mockResolvedValueOnce({});
    expect(await store.getRequest('missing')).toBeNull();
  });

  it('getRequest returns request without PK/SK', async () => {
    doc.send.mockResolvedValueOnce({ Item: { PK: 'REQUEST#1', SK: 'META', id: '1', toolName: 'Figma' } });
    const req = await store.getRequest('1');
    expect(req).toEqual({ id: '1', toolName: 'Figma' });
  });

  it('getPendingRequests sends scan command', async () => {
    doc.send.mockResolvedValueOnce({ Items: [{ PK: 'REQUEST#1', SK: 'META', id: '1', status: 'pending_approval' }] });
    const results = await store.getPendingRequests();
    expect(results).toHaveLength(1);
    expect(results[0].PK).toBeUndefined();
  });

  describe('updateRequestStatus', () => {
    it('allows valid transition pending_evaluation → approved', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'pending_evaluation' },
      });
      await store.updateRequestStatus('1', 'approved', { autoGranted: true });
      expect(doc.send).toHaveBeenCalledTimes(2);
      const cmd = doc.send.mock.calls[1][0].input;
      expect(cmd.ExpressionAttributeValues[':newStatus']).toBe('approved');
      expect(cmd.ExpressionAttributeValues[':autoGranted']).toBe(true);
      expect(cmd.ConditionExpression).toBeUndefined();
    });

    it('allows valid transition pending_evaluation → pending_approval', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'pending_evaluation' },
      });
      await store.updateRequestStatus('1', 'pending_approval');
      const cmd = doc.send.mock.calls[1][0].input;
      expect(cmd.ExpressionAttributeValues[':newStatus']).toBe('pending_approval');
    });

    it('uses conditional update for transitions from pending_approval', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'pending_approval' },
      });
      await store.updateRequestStatus('1', 'approved');
      const cmd = doc.send.mock.calls[1][0].input;
      expect(cmd.ConditionExpression).toBe('#s = :currentStatus');
      expect(cmd.ExpressionAttributeValues[':currentStatus']).toBe('pending_approval');
    });

    it('rejects invalid transition pending_evaluation → provisioned', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'pending_evaluation' },
      });
      await expect(store.updateRequestStatus('1', 'provisioned'))
        .rejects.toThrow('Invalid status transition: pending_evaluation → provisioned');
    });

    it('rejects invalid transition approved → rejected', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'approved' },
      });
      await expect(store.updateRequestStatus('1', 'rejected'))
        .rejects.toThrow('Invalid status transition: approved → rejected');
    });

    it('throws when request not found', async () => {
      doc.send.mockResolvedValueOnce({});
      await expect(store.updateRequestStatus('missing', 'approved'))
        .rejects.toThrow('Request not found: missing');
    });

    it('passes extra fields in the update expression', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'approved' },
      });
      await store.updateRequestStatus('1', 'provisioned', { provisionResult: 'ok' });
      const cmd = doc.send.mock.calls[1][0].input;
      expect(cmd.ExpressionAttributeValues[':provisionResult']).toBe('ok');
    });
  });

  describe('createEmployeeProfile', () => {
    it('creates profile with defaults and strips PK/SK', async () => {
      const profile = await store.createEmployeeProfile({
        employeeId: 'emp-001', name: 'Jane', email: 'jane@co.com',
        jobLevel: 'engineer', department: 'Eng',
      });
      expect(profile.employeeId).toBe('emp-001');
      expect(profile.grantedAccess).toEqual([]);
      expect(profile.totalMonthlyCost).toBe(0);
      expect(profile.createdAt).toBeDefined();
      expect(profile.PK).toBeUndefined();
      expect(doc.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEmployeeProfile', () => {
    it('returns null when not found', async () => {
      doc.send.mockResolvedValueOnce({});
      expect(await store.getEmployeeProfile('missing')).toBeNull();
    });

    it('returns profile without PK/SK', async () => {
      doc.send.mockResolvedValueOnce({
        Item: { PK: 'EMPLOYEE#emp-001', SK: 'PROFILE', employeeId: 'emp-001', name: 'Jane' },
      });
      const profile = await store.getEmployeeProfile('emp-001');
      expect(profile).toEqual({ employeeId: 'emp-001', name: 'Jane' });
    });
  });

  describe('updateEmployeeProfile', () => {
    it('sends UpdateCommand with provided fields', async () => {
      await store.updateEmployeeProfile('emp-001', { name: 'Jane Updated', department: 'Design' });
      expect(doc.send).toHaveBeenCalledTimes(1);
      const cmd = doc.send.mock.calls[0][0].input;
      expect(cmd.Key).toEqual({ PK: 'EMPLOYEE#emp-001', SK: 'PROFILE' });
      expect(cmd.ExpressionAttributeValues[':name']).toBe('Jane Updated');
      expect(cmd.ExpressionAttributeValues[':department']).toBe('Design');
    });
  });

  describe('addGrantedAccess', () => {
    it('appends new entry and computes totalMonthlyCost', async () => {
      doc.send.mockResolvedValueOnce({
        Item: {
          PK: 'EMPLOYEE#emp-001', SK: 'PROFILE', employeeId: 'emp-001',
          name: 'Jane', grantedAccess: [], totalMonthlyCost: 0,
        },
      });
      const result = await store.addGrantedAccess('emp-001', {
        toolName: 'Figma', accessLevel: 'standard', monthlyCost: 15,
        grantedAt: '2025-01-01', requestId: 'req-1',
      });
      expect(result.grantedAccess).toHaveLength(1);
      expect(result.totalMonthlyCost).toBe(15);
      expect(doc.send).toHaveBeenCalledTimes(2);
    });

    it('upserts existing entry with same toolName + accessLevel', async () => {
      doc.send.mockResolvedValueOnce({
        Item: {
          PK: 'EMPLOYEE#emp-001', SK: 'PROFILE', employeeId: 'emp-001',
          name: 'Jane', totalMonthlyCost: 15,
          grantedAccess: [
            { toolName: 'Figma', accessLevel: 'standard', monthlyCost: 15, grantedAt: '2025-01-01', requestId: 'req-1' },
          ],
        },
      });
      const result = await store.addGrantedAccess('emp-001', {
        toolName: 'Figma', accessLevel: 'standard', monthlyCost: 20,
        grantedAt: '2025-02-01', requestId: 'req-2',
      });
      expect(result.grantedAccess).toHaveLength(1);
      expect(result.grantedAccess[0].monthlyCost).toBe(20);
      expect(result.totalMonthlyCost).toBe(20);
    });

    it('throws when profile not found', async () => {
      doc.send.mockResolvedValueOnce({});
      await expect(store.addGrantedAccess('missing', {
        toolName: 'Figma', accessLevel: 'standard', monthlyCost: 15,
        grantedAt: '2025-01-01', requestId: 'req-1',
      })).rejects.toThrow('Employee profile not found: missing');
    });

    it('recomputes cost correctly with multiple entries', async () => {
      doc.send.mockResolvedValueOnce({
        Item: {
          PK: 'EMPLOYEE#emp-001', SK: 'PROFILE', employeeId: 'emp-001',
          name: 'Jane', totalMonthlyCost: 15,
          grantedAccess: [
            { toolName: 'Figma', accessLevel: 'standard', monthlyCost: 15, grantedAt: '2025-01-01', requestId: 'req-1' },
          ],
        },
      });
      const result = await store.addGrantedAccess('emp-001', {
        toolName: 'GitHub', accessLevel: 'write', monthlyCost: 21,
        grantedAt: '2025-02-01', requestId: 'req-2',
      });
      expect(result.grantedAccess).toHaveLength(2);
      expect(result.totalMonthlyCost).toBe(36);
    });
  });

  describe('getCatalogEntry', () => {
    it('returns null when not found', async () => {
      doc.send.mockResolvedValueOnce({});
      expect(await store.getCatalogEntry('Unknown', 'standard')).toBeNull();
    });

    it('returns entry without PK/SK', async () => {
      doc.send.mockResolvedValueOnce({
        Item: {
          PK: 'CATALOG#Figma', SK: 'LEVEL#standard',
          toolName: 'Figma', accessLevel: 'standard', monthlyCostPerUser: 15,
        },
      });
      const entry = await store.getCatalogEntry('Figma', 'standard');
      expect(entry).toEqual({ toolName: 'Figma', accessLevel: 'standard', monthlyCostPerUser: 15 });
    });

    it('uses correct DynamoDB key', async () => {
      doc.send.mockResolvedValueOnce({ Item: { PK: 'CATALOG#GitHub', SK: 'LEVEL#write', toolName: 'GitHub', accessLevel: 'write' } });
      await store.getCatalogEntry('GitHub', 'write');
      const cmd = doc.send.mock.calls[0][0].input;
      expect(cmd.Key).toEqual({ PK: 'CATALOG#GitHub', SK: 'LEVEL#write' });
    });
  });

  describe('getAllCatalogEntries', () => {
    it('returns empty array when no entries', async () => {
      doc.send.mockResolvedValueOnce({ Items: [] });
      expect(await store.getAllCatalogEntries()).toEqual([]);
    });

    it('returns entries without PK/SK', async () => {
      doc.send.mockResolvedValueOnce({
        Items: [
          { PK: 'CATALOG#Figma', SK: 'LEVEL#standard', toolName: 'Figma', accessLevel: 'standard' },
          { PK: 'CATALOG#GitHub', SK: 'LEVEL#write', toolName: 'GitHub', accessLevel: 'write' },
        ],
      });
      const entries = await store.getAllCatalogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].PK).toBeUndefined();
      expect(entries[0].SK).toBeUndefined();
      expect(entries[0].toolName).toBe('Figma');
      expect(entries[1].toolName).toBe('GitHub');
    });

    it('uses begins_with filter on SK', async () => {
      doc.send.mockResolvedValueOnce({ Items: [] });
      await store.getAllCatalogEntries();
      const cmd = doc.send.mock.calls[0][0].input;
      expect(cmd.FilterExpression).toContain('begins_with');
      expect(cmd.ExpressionAttributeValues[':sk']).toBe('LEVEL#');
    });
  });

  describe('getRequestsByEmployee', () => {
    it('returns empty array when no requests match', async () => {
      doc.send.mockResolvedValueOnce({ Items: [] });
      const results = await store.getRequestsByEmployee('emp-999');
      expect(results).toEqual([]);
    });

    it('returns requests without PK/SK', async () => {
      doc.send.mockResolvedValueOnce({
        Items: [
          { PK: 'REQUEST#1', SK: 'META', id: '1', employeeId: 'emp-001', toolName: 'Figma', status: 'approved' },
          { PK: 'REQUEST#2', SK: 'META', id: '2', employeeId: 'emp-001', toolName: 'GitHub', status: 'pending_approval' },
        ],
      });
      const results = await store.getRequestsByEmployee('emp-001');
      expect(results).toHaveLength(2);
      expect(results[0].PK).toBeUndefined();
      expect(results[0].SK).toBeUndefined();
      expect(results[0].employeeId).toBe('emp-001');
      expect(results[1].toolName).toBe('GitHub');
    });

    it('sends ScanCommand with correct filter expression', async () => {
      doc.send.mockResolvedValueOnce({ Items: [] });
      await store.getRequestsByEmployee('emp-001');
      const cmd = doc.send.mock.calls[0][0].input;
      expect(cmd.TableName).toBe('T');
      expect(cmd.FilterExpression).toBe('SK = :sk AND employeeId = :eid');
      expect(cmd.ExpressionAttributeValues[':sk']).toBe('META');
      expect(cmd.ExpressionAttributeValues[':eid']).toBe('emp-001');
    });
  });

  describe('getRequestsByStatus', () => {
    it('returns empty array when no requests match', async () => {
      doc.send.mockResolvedValueOnce({ Items: [] });
      const results = await store.getRequestsByStatus('pending_approval');
      expect(results).toEqual([]);
    });

    it('returns requests without PK/SK', async () => {
      doc.send.mockResolvedValueOnce({
        Items: [
          { PK: 'REQUEST#1', SK: 'META', id: '1', status: 'pending_approval', toolName: 'Figma' },
          { PK: 'REQUEST#2', SK: 'META', id: '2', status: 'pending_approval', toolName: 'GitHub' },
        ],
      });
      const results = await store.getRequestsByStatus('pending_approval');
      expect(results).toHaveLength(2);
      expect(results[0].PK).toBeUndefined();
      expect(results[0].SK).toBeUndefined();
      expect(results[0].status).toBe('pending_approval');
      expect(results[1].toolName).toBe('GitHub');
    });

    it('sends QueryCommand with StatusIndex GSI', async () => {
      doc.send.mockResolvedValueOnce({ Items: [] });
      await store.getRequestsByStatus('approved');
      const cmd = doc.send.mock.calls[0][0].input;
      expect(cmd.TableName).toBe('T');
      expect(cmd.IndexName).toBe('StatusIndex');
      expect(cmd.KeyConditionExpression).toBe('#s = :status');
      expect(cmd.ExpressionAttributeNames['#s']).toBe('status');
      expect(cmd.ExpressionAttributeValues[':status']).toBe('approved');
    });
  });

  describe('putCatalogEntry', () => {
    it('throws when toolName is missing', async () => {
      await expect(store.putCatalogEntry({ accessLevel: 'standard' }))
        .rejects.toThrow('Catalog entry requires toolName and accessLevel');
    });

    it('throws when accessLevel is missing', async () => {
      await expect(store.putCatalogEntry({ toolName: 'Figma' }))
        .rejects.toThrow('Catalog entry requires toolName and accessLevel');
    });

    it('saves entry with correct PK/SK and returns without them', async () => {
      const entry = {
        toolName: 'Figma', accessLevel: 'standard', description: 'Design tool',
        monthlyCostPerUser: 15, oktaGroupId: 'grp-figma',
      };
      const result = await store.putCatalogEntry(entry);
      expect(result.toolName).toBe('Figma');
      expect(result.accessLevel).toBe('standard');
      expect(result.PK).toBeUndefined();
      expect(result.SK).toBeUndefined();

      const cmd = doc.send.mock.calls[0][0].input;
      expect(cmd.Item.PK).toBe('CATALOG#Figma');
      expect(cmd.Item.SK).toBe('LEVEL#standard');
    });
  });
});
