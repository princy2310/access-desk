/**
 * Express API server — serves the web portal UI and REST API endpoints.
 * @module server
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer({ store, accessAgent, configManager, llm }) {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json());

  // POST /api/requests
  app.post('/api/requests', async (req, res, next) => {
    try {
      const { toolName, accessLevel, reason, employeeId, urgency } = req.body;
      const catalogEntry = await store.getCatalogEntry(toolName, accessLevel);
      if (!catalogEntry) {
        const all = await store.getAllCatalogEntries();
        return res.status(400).json({ error: `Tool '${toolName}' with access level '${accessLevel}' not found in catalog`, availableTools: all.map(e => ({ toolName: e.toolName, accessLevel: e.accessLevel, description: e.description })) });
      }
      const employeeProfile = await store.getEmployeeProfile(employeeId);
      if (!employeeProfile) return res.status(404).json({ error: `Employee profile not found: ${employeeId}` });
      const request = await store.createRequest({ toolName, accessLevel, reason: reason || '', urgency: urgency || 'normal', employeeId: employeeProfile.employeeId, employeeName: employeeProfile.name, employeeEmail: employeeProfile.email, jobLevel: employeeProfile.jobLevel, monthlyCost: catalogEntry.monthlyCostPerUser });
      const result = await accessAgent.evaluateRequest(request, employeeProfile);
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // GET /api/requests
  app.get('/api/requests', async (req, res, next) => {
    try {
      const { employeeId, status } = req.query;
      let results;
      if (employeeId) results = await store.getRequestsByEmployee(employeeId);
      else if (status) results = await store.getRequestsByStatus(status);
      else results = await store.getPendingRequests();
      res.json(results);
    } catch (err) { next(err); }
  });

  // POST /api/requests/:id/approve
  app.post('/api/requests/:id/approve', async (req, res, next) => {
    try {
      const token = req.query.token || req.body.token;
      const result = await accessAgent.processApproverDecision(req.params.id, token, 'approve', null);
      res.json(result);
    } catch (err) {
      if (err.message === 'Token expired') return res.status(400).json({ error: 'Approval token has expired.' });
      if (err.message === 'Invalid token') return res.status(400).json({ error: 'Invalid approval token.' });
      if (err.message?.includes('Invalid status transition')) return res.status(409).json({ error: 'This request has already been processed.' });
      next(err);
    }
  });

  // POST /api/requests/:id/reject
  app.post('/api/requests/:id/reject', async (req, res, next) => {
    try {
      const token = req.query.token || req.body.token;
      const reason = req.body.reason || null;
      const result = await accessAgent.processApproverDecision(req.params.id, token, 'reject', reason);
      res.json(result);
    } catch (err) {
      if (err.message === 'Token expired') return res.status(400).json({ error: 'Approval token has expired.' });
      if (err.message === 'Invalid token') return res.status(400).json({ error: 'Invalid approval token.' });
      if (err.message?.includes('Invalid status transition')) return res.status(409).json({ error: 'This request has already been processed.' });
      next(err);
    }
  });

  // GET /api/employees/:id/profile
  app.get('/api/employees/:id/profile', async (req, res, next) => {
    try {
      const profile = await store.getEmployeeProfile(req.params.id);
      if (!profile) return res.status(404).json({ error: `Employee profile not found: ${req.params.id}` });
      res.json(profile);
    } catch (err) { next(err); }
  });

  // GET /api/catalog
  app.get('/api/catalog', async (req, res, next) => {
    try { res.json(await store.getAllCatalogEntries()); }
    catch (err) { next(err); }
  });

  // POST /api/chat — LLM-powered AI assistant (Amazon Bedrock / Claude)
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, employeeId } = req.body;
      if (!message) return res.status(400).json({ error: 'Message is required' });
      if (!llm) return res.status(500).json({ error: 'LLM not configured. Set AWS credentials for Bedrock.' });

      const catalog = await store.getAllCatalogEntries();
      const profile = employeeId ? await store.getEmployeeProfile(employeeId) : null;

      // Employee lookup context (for manager queries like "who is Princy?")
      let empCtx = '';
      if (store.searchEmployeeByName) {
        const pats = [/who is (.+?)[\?\.]?$/i, /about (.+?)[\?\.]?$/i, /(.+?)['s] (?:role|level|department)/i, /employee (.+?)[\?\.]?$/i];
        let name = null;
        for (const p of pats) { const m = message.match(p); if (m) { name = m[1].trim(); break; } }
        if (name) {
          const results = await store.searchEmployeeByName(name);
          if (results.length > 0) empCtx = '\n\nEmployee lookup results:\n' + results.map(e => `- ${e.name} (${e.employeeId}): ${e.jobLevel}, ${e.department}, ${e.email}, cost=$${e.totalMonthlyCost.toFixed(2)}/mo, tools=${e.grantedAccess.map(g => g.toolName).join(', ') || 'none'}`).join('\n');
        }
      }

      // Pending requests context
      let pendCtx = '';
      if (profile) {
        try {
          const reqs = await store.getRequestsByEmployee(employeeId);
          const pending = reqs.filter(r => r.status === 'pending_approval');
          if (pending.length > 0) pendCtx = '\n\nPending requests:\n' + pending.map(r => `- ${r.toolName} sent to ${r.approverName || r.approverId}`).join('\n');
        } catch {}
      }

      const systemPrompt = `You are an AI assistant for AccessDesk, a self-service software access portal.

SOFTWARE CATALOG:
${catalog.map(c => `- ${c.toolName} (${c.accessLevel}): ${c.description}. Auto-grant: ${c.autoGrantJobLevels.join(', ') || 'NONE (always requires approval)'}. Approver: ${c.defaultApproverName}`).join('\n')}

${profile ? `CURRENT USER: ${profile.name} (${profile.employeeId}), jobLevel=${profile.jobLevel}, dept=${profile.department}, email=${profile.email}, cost=$${profile.totalMonthlyCost.toFixed(2)}/mo, tools=${profile.grantedAccess.map(g => g.toolName).join(', ') || 'none'}` : 'NO USER PROFILE (manager/admin view).'}${empCtx}${pendCtx}

RULES: If jobLevel is in auto-grant list, user can install directly. Otherwise needs approval. Empty auto-grant list = always requires approval.

Be concise and helpful. Use **bold** for tool names.`;

      const reply = await llm.complete(systemPrompt, message);
      const recommendations = catalog.filter(c => reply.includes(c.toolName)).map(r => ({ toolName: r.toolName, accessLevel: r.accessLevel, icon: r.icon, description: r.description }));
      res.json({ reply, recommendations });
    } catch (err) {
      console.error('[Chat LLM Error]', err.message);
      res.status(500).json({ error: 'LLM error: ' + err.message });
    }
  });

  // Static files + error handler
  app.use(express.static(join(__dirname, '..', 'ui')));
  app.use((err, req, res, _next) => {
    console.error(`[API Error] ${req.method} ${req.url}:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
