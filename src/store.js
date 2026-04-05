/**
 * Access request store — DynamoDB single-table CRUD.
 * @module store
 */
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, UpdateCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { VALID_STATUS_TRANSITIONS } from './constants.js';

export function createRequestStore(docClient, tableName) {
  return {
    async createRequest(req) {
      const now = new Date().toISOString();
      const id = uuidv4();
      const item = {
        PK: `REQUEST#${id}`, SK: 'META', id, ...req,
        status: 'pending_evaluation', reminders: 0,
        accessLevel: req.accessLevel || null,
        employeeId: req.employeeId || null,
        employeeName: req.employeeName || null,
        employeeEmail: req.employeeEmail || null,
        jobLevel: req.jobLevel || null,
        autoGranted: req.autoGranted || false,
        agentReason: req.agentReason || null,
        approverId: req.approverId || null,
        approverName: req.approverName || null,
        approvalToken: req.approvalToken || null,
        tokenExpiresAt: req.tokenExpiresAt || null,
        monthlyCost: req.monthlyCost || 0,
        provisionResult: null, rejectionReason: null,
        createdAt: now, updatedAt: now,
      };
      await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
      const { PK, SK, ...saved } = item;
      return saved;
    },

    async updateRequestStatus(id, newStatus, extraFields = {}) {
      const request = await this.getRequest(id);
      if (!request) throw new Error(`Request not found: ${id}`);

      const currentStatus = request.status;
      const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
      if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
        throw new Error(`Invalid status transition: ${currentStatus} → ${newStatus}`);
      }

      const now = new Date().toISOString();
      const expressions = ['#s = :newStatus', 'updatedAt = :u'];
      const names = { '#s': 'status' };
      const values = { ':newStatus': newStatus, ':u': now };

      for (const [key, val] of Object.entries(extraFields)) {
        const attr = `#${key}`;
        const placeholder = `:${key}`;
        names[attr] = key;
        values[placeholder] = val;
        expressions.push(`${attr} = ${placeholder}`);
      }

      const params = {
        TableName: tableName,
        Key: { PK: `REQUEST#${id}`, SK: 'META' },
        UpdateExpression: `SET ${expressions.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      };

      // Use conditional update for transitions FROM pending_approval to prevent concurrency issues
      if (currentStatus === 'pending_approval') {
        params.ConditionExpression = '#s = :currentStatus';
        params.ExpressionAttributeValues[':currentStatus'] = currentStatus;
      }

      await docClient.send(new UpdateCommand(params));
    },

    async getRequest(id) {
      const { Item } = await docClient.send(new GetCommand({ TableName: tableName, Key: { PK: `REQUEST#${id}`, SK: 'META' } }));
      if (!Item) return null;
      const { PK, SK, ...req } = Item;
      return req;
    },

    async markApproved(id, approverId) {
      const now = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: tableName, Key: { PK: `REQUEST#${id}`, SK: 'META' },
        UpdateExpression: 'SET #s = :s, approvedBy = :ab, approvedAt = :at, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'approved', ':ab': approverId, ':at': now, ':u': now },
      }));
    },

    async markRejected(id, approverId, reason) {
      const now = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: tableName, Key: { PK: `REQUEST#${id}`, SK: 'META' },
        UpdateExpression: 'SET #s = :s, rejectedBy = :rb, rejectionReason = :rr, rejectedAt = :at, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'rejected', ':rb': approverId, ':rr': reason || 'No reason provided', ':at': now, ':u': now },
      }));
    },

    async markProvisioned(id, result) {
      const now = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: tableName, Key: { PK: `REQUEST#${id}`, SK: 'META' },
        UpdateExpression: 'SET #s = :s, provisionResult = :pr, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'provisioned', ':pr': result, ':u': now },
      }));
    },

    async markFailed(id, error) {
      const now = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: tableName, Key: { PK: `REQUEST#${id}`, SK: 'META' },
        UpdateExpression: 'SET #s = :s, failureReason = :fr, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'failed', ':fr': error, ':u': now },
      }));
    },

    async getPendingRequests() {
      const { Items = [] } = await docClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'SK = :sk AND #s = :pending',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':sk': 'META', ':pending': 'pending_approval' },
      }));
      return Items.map(({ PK, SK, ...req }) => req);
    },

    async incrementReminders(id) {
      await docClient.send(new UpdateCommand({
        TableName: tableName, Key: { PK: `REQUEST#${id}`, SK: 'META' },
        UpdateExpression: 'ADD reminders :inc SET updatedAt = :u',
        ExpressionAttributeValues: { ':inc': 1, ':u': new Date().toISOString() },
      }));
    },

    async createEmployeeProfile(profile) {
      const now = new Date().toISOString();
      const item = {
        PK: `EMPLOYEE#${profile.employeeId}`, SK: 'PROFILE',
        ...profile,
        grantedAccess: profile.grantedAccess || [],
        totalMonthlyCost: profile.totalMonthlyCost || 0,
        createdAt: now, updatedAt: now,
      };
      await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
      const { PK, SK, ...saved } = item;
      return saved;
    },

    async getEmployeeProfile(employeeId) {
      const { Item } = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `EMPLOYEE#${employeeId}`, SK: 'PROFILE' },
      }));
      if (!Item) return null;
      const { PK, SK, ...profile } = Item;
      return profile;
    },

    async updateEmployeeProfile(employeeId, updates) {
      const now = new Date().toISOString();
      const expressions = [];
      const names = {};
      const values = { ':u': now };

      for (const [key, val] of Object.entries(updates)) {
        const attr = `#${key}`;
        const placeholder = `:${key}`;
        names[attr] = key;
        values[placeholder] = val;
        expressions.push(`${attr} = ${placeholder}`);
      }
      expressions.push('updatedAt = :u');

      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `EMPLOYEE#${employeeId}`, SK: 'PROFILE' },
        UpdateExpression: `SET ${expressions.join(', ')}`,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
      }));
    },

    async addGrantedAccess(employeeId, grantedAccessEntry) {
      const profile = await this.getEmployeeProfile(employeeId);
      if (!profile) throw new Error(`Employee profile not found: ${employeeId}`);

      const access = profile.grantedAccess || [];
      const existingIdx = access.findIndex(
        (g) => g.toolName === grantedAccessEntry.toolName && g.accessLevel === grantedAccessEntry.accessLevel
      );

      if (existingIdx >= 0) {
        access[existingIdx] = grantedAccessEntry;
      } else {
        access.push(grantedAccessEntry);
      }

      const totalMonthlyCost = access.reduce((sum, g) => sum + g.monthlyCost, 0);
      const now = new Date().toISOString();

      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `EMPLOYEE#${employeeId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET grantedAccess = :ga, totalMonthlyCost = :tc, updatedAt = :u',
        ExpressionAttributeValues: { ':ga': access, ':tc': totalMonthlyCost, ':u': now },
      }));

      return { ...profile, grantedAccess: access, totalMonthlyCost, updatedAt: now };
    },

    async getCatalogEntry(toolName, accessLevel) {
      const { Item } = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `CATALOG#${toolName}`, SK: `LEVEL#${accessLevel}` },
      }));
      if (!Item) return null;
      const { PK, SK, ...entry } = Item;
      return entry;
    },

    async getAllCatalogEntries() {
      const { Items = [] } = await docClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':sk': 'LEVEL#' },
      }));
      return Items.map(({ PK, SK, ...entry }) => entry);
    },

    async getRequestsByEmployee(employeeId) {
      const { Items = [] } = await docClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: 'SK = :sk AND employeeId = :eid',
        ExpressionAttributeValues: { ':sk': 'META', ':eid': employeeId },
      }));
      return Items.map(({ PK, SK, ...req }) => req);
    },

    async getRequestsByStatus(status) {
      const { Items = [] } = await docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': status },
      }));
      return Items.map(({ PK, SK, ...req }) => req);
    },

    async putCatalogEntry(entry) {
      if (!entry.toolName || !entry.accessLevel) {
        throw new Error('Catalog entry requires toolName and accessLevel');
      }
      const item = {
        PK: `CATALOG#${entry.toolName}`,
        SK: `LEVEL#${entry.accessLevel}`,
        ...entry,
      };
      await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
      const { PK, SK, ...saved } = item;
      return saved;
    },
  };
}
