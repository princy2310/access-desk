/**
 * Local development server — uses in-memory mocks for DynamoDB, SES, SSM.
 * Run with: node src/dev-server.js
 */

import { createRulesEngine } from './rules-engine.js';
import { createEmailService } from './email-service.js';
import { createAccessAgent } from './access-agent.js';
import { createServer } from './server.js';
import { createLLM } from './llm.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, '..', '.dev-data.json');
const PORT = 3000;

// --- Persistence helpers ---
function loadData() {
  if (existsSync(DATA_FILE)) {
    try { return JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch { /* ignore corrupt file */ }
  }
  return null;
}
function saveData() {
  const data = { requests: Object.fromEntries(requests), employees: EMPLOYEES, reqCounter };
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- In-memory catalog ---
const CATALOG = [
  { toolName: 'Microsoft Office 365', accessLevel: 'standard', description: 'Word, Excel, PowerPoint, Outlook, Teams and OneDrive', icon: 'office365', category: 'Productivity', oktaGroupId: 'grp-office365', monthlyCostPerUser: 12.50, autoGrantJobLevels: ['intern', 'engineer', 'senior_engineer', 'manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'it-admin@company.com', defaultApproverName: 'IT Admin' },
  { toolName: 'Figma', accessLevel: 'standard', description: 'Collaborative interface design and prototyping', icon: 'figma', category: 'Design', oktaGroupId: 'grp-figma', monthlyCostPerUser: 15, autoGrantJobLevels: ['engineer', 'senior_engineer', 'manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'design-lead@company.com', defaultApproverName: 'Design Lead' },
  { toolName: 'GitHub Desktop', accessLevel: 'standard', description: 'Git client for managing repositories from your desktop', icon: 'github', category: 'Developer Tools', oktaGroupId: 'grp-github', monthlyCostPerUser: 21, autoGrantJobLevels: ['engineer', 'senior_engineer'], requiresApprovalAlways: false, defaultApproverEmail: 'manager@company.com', defaultApproverName: 'Manager' },
  { toolName: 'Jira', accessLevel: 'standard', description: 'Issue tracking, agile boards and project management', icon: 'jira', category: 'Productivity', oktaGroupId: 'grp-jira', monthlyCostPerUser: 10, autoGrantJobLevels: ['intern', 'engineer', 'senior_engineer', 'manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'pm-lead@company.com', defaultApproverName: 'PM Lead' },
  { toolName: 'Slack', accessLevel: 'standard', description: 'Channels, direct messages and workflow automation', icon: 'slack', category: 'Communication', oktaGroupId: 'grp-slack', monthlyCostPerUser: 8.75, autoGrantJobLevels: ['intern', 'engineer', 'senior_engineer', 'manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'it-admin@company.com', defaultApproverName: 'IT Admin' },
  { toolName: 'Camtasia', accessLevel: 'standard', description: 'Screen recording, video editing and tutorials', icon: 'camtasia', category: 'Media', oktaGroupId: 'grp-camtasia', monthlyCostPerUser: 25, autoGrantJobLevels: ['manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'it-admin@company.com', defaultApproverName: 'IT Admin' },
  { toolName: 'Salesforce', accessLevel: 'standard', description: 'CRM, sales pipeline and customer analytics', icon: 'salesforce', category: 'Sales', oktaGroupId: 'grp-sfdc', monthlyCostPerUser: 150, autoGrantJobLevels: ['manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'sales-ops@company.com', defaultApproverName: 'Sales Ops' },
  { toolName: 'Zoom', accessLevel: 'standard', description: 'Video meetings, webinars and virtual rooms', icon: 'zoom', category: 'Communication', oktaGroupId: 'grp-zoom', monthlyCostPerUser: 13.33, autoGrantJobLevels: ['intern', 'engineer', 'senior_engineer', 'manager', 'director', 'vp'], requiresApprovalAlways: false, defaultApproverEmail: 'it-admin@company.com', defaultApproverName: 'IT Admin' },
  { toolName: 'Adobe Creative Cloud', accessLevel: 'standard', description: 'Photoshop, Illustrator, Premiere Pro and 20+ creative apps', icon: 'adobe', category: 'Design', oktaGroupId: 'grp-adobe', monthlyCostPerUser: 55, autoGrantJobLevels: [], requiresApprovalAlways: true, defaultApproverEmail: 'design-lead@company.com', defaultApproverName: 'Design Lead' },
];

const EMPLOYEES = {
  'emp-001': { employeeId: 'emp-001', name: 'Princy Gandhi', email: 'princy@company.com', jobLevel: 'senior_engineer', department: 'Engineering', grantedAccess: [], totalMonthlyCost: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  'emp-002': { employeeId: 'emp-002', name: 'Alex Kim', email: 'alex@company.com', jobLevel: 'intern', department: 'Engineering', grantedAccess: [], totalMonthlyCost: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  'emp-003': { employeeId: 'emp-003', name: 'Sam Chen', email: 'sam@company.com', jobLevel: 'manager', department: 'Sales', grantedAccess: [], totalMonthlyCost: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
};

// --- In-memory store (with file persistence) ---
const saved = loadData();
const requests = saved ? new Map(Object.entries(saved.requests)) : new Map();
let reqCounter = saved?.reqCounter || 1;

// Restore employee data from saved state
if (saved?.employees) {
  for (const [id, emp] of Object.entries(saved.employees)) {
    if (EMPLOYEES[id]) Object.assign(EMPLOYEES[id], emp);
  }
}

const store = {
  async getCatalogEntry(toolName, accessLevel) {
    return CATALOG.find(c => c.toolName === toolName && c.accessLevel === accessLevel) || null;
  },
  async getAllCatalogEntries() { return CATALOG; },
  async getEmployeeProfile(id) { return EMPLOYEES[id] || null; },
  async createRequest(req) {
    const id = `REQ-${String(reqCounter++).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const saved2 = { id, ...req, status: 'pending_evaluation', reminders: 0, provisionResult: null, rejectionReason: null, createdAt: now, updatedAt: now };
    requests.set(id, saved2);
    saveData();
    return saved2;
  },
  async getRequest(id) { return requests.get(id) || null; },
  async updateRequestStatus(id, newStatus, extra = {}) {
    const req = requests.get(id);
    if (!req) throw new Error(`Request not found: ${id}`);
    req.status = newStatus;
    Object.assign(req, extra);
    req.updatedAt = new Date().toISOString();
    saveData();
  },
  async addGrantedAccess(employeeId, entry) {
    const profile = EMPLOYEES[employeeId];
    if (!profile) throw new Error(`Employee profile not found: ${employeeId}`);
    const idx = profile.grantedAccess.findIndex(g => g.toolName === entry.toolName && g.accessLevel === entry.accessLevel);
    if (idx >= 0) profile.grantedAccess[idx] = entry;
    else profile.grantedAccess.push(entry);
    profile.totalMonthlyCost = profile.grantedAccess.reduce((s, g) => s + g.monthlyCost, 0);
    profile.updatedAt = new Date().toISOString();
    saveData();
  },
  async getRequestsByEmployee(eid) { return [...requests.values()].filter(r => r.employeeId === eid); },
  async getRequestsByStatus(status) { return [...requests.values()].filter(r => r.status === status); },
  async getPendingRequests() { return [...requests.values()].filter(r => r.status === 'pending_approval'); },
  async searchEmployeeByName(name) {
    const lower = name.toLowerCase();
    return Object.values(EMPLOYEES).filter(e => e.name.toLowerCase().includes(lower));
  },
};

// --- Mock provisioner (always succeeds) ---
const provisioner = {
  async provision(request, catalogEntry) {
    console.log(`[Mock] Provisioned ${request.toolName} (${request.accessLevel}) for ${request.employeeId}`);
    return { success: true, message: `Mock provisioned ${request.toolName}` };
  },
};

// --- Mock email service (logs to console) ---
const emailService = {
  async sendApprovalEmail(approverEmail, request, profile) {
    console.log(`[Email] Approval request sent to ${approverEmail} for ${request.toolName} (${request.id})`);
    return { success: true };
  },
  async sendGrantedNotification(email, request) {
    console.log(`[Email] Granted notification sent to ${email} for ${request.toolName}`);
    return { success: true };
  },
  async sendRejectedNotification(email, request, reason) {
    console.log(`[Email] Rejection notification sent to ${email}: ${reason}`);
    return { success: true };
  },
};

// --- Wire up ---
const config = { accessCatalog: CATALOG, providerType: 'mock' };
const rulesEngine = createRulesEngine(config);
const accessAgent = createAccessAgent(rulesEngine, store, provisioner, emailService);
const configManager = { getConfig: async () => config, loadConfig: async () => config };
const llm = createLLM();

const app = createServer({ store, accessAgent, configManager, llm });

app.listen(PORT, () => {
  console.log(`\n🔑 AccessDesk dev server running at http://localhost:${PORT}\n`);
  console.log('Demo employees:');
  console.log('  emp-001 — Princy Gandhi (senior_engineer) — auto-grants most tools');
  console.log('  emp-002 — Alex Kim (intern) — most requests need approval');
  console.log('  emp-003 — Sam Chen (manager, Sales) — auto-grants Salesforce\n');
});
