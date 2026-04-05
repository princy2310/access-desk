import { describe, it, expect } from 'vitest';
import { createRulesEngine } from '../../src/rules-engine.js';

const catalog = [
  {
    toolName: 'Figma',
    description: 'Design tool',
    accessLevel: 'standard',
    oktaGroupId: 'grp-figma',
    monthlyCostPerUser: 15,
    autoGrantJobLevels: ['engineer', 'senior_engineer', 'manager'],
    requiresApprovalAlways: false,
    defaultApproverEmail: 'design-lead@company.com',
    defaultApproverName: 'Design Lead',
  },
  {
    toolName: 'AWS Console',
    description: 'Cloud admin',
    accessLevel: 'admin',
    oktaGroupId: 'grp-aws-admin',
    monthlyCostPerUser: 0,
    autoGrantJobLevels: [],
    requiresApprovalAlways: true,
    defaultApproverEmail: 'infra-lead@company.com',
    defaultApproverName: 'Infra Lead',
  },
];

const config = { accessCatalog: catalog };

function makeProfile(jobLevel) {
  return {
    employeeId: 'emp-001',
    name: 'Jane',
    email: 'jane@company.com',
    jobLevel,
    department: 'Engineering',
    grantedAccess: [],
    totalMonthlyCost: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('createRulesEngine', () => {
  describe('isKnownTool', () => {
    const engine = createRulesEngine(config);

    it('returns true for a tool in the catalog', () => {
      expect(engine.isKnownTool('Figma')).toBe(true);
      expect(engine.isKnownTool('AWS Console')).toBe(true);
    });

    it('returns false for an unknown tool', () => {
      expect(engine.isKnownTool('NonExistent')).toBe(false);
    });
  });

  describe('checkRules', () => {
    const engine = createRulesEngine(config);

    it('returns auto_grant when job level is in autoGrantJobLevels and requiresApprovalAlways is false', () => {
      const result = engine.checkRules('Figma', makeProfile('engineer'), catalog[0]);
      expect(result.decision).toBe('auto_grant');
      expect(result.reason).toBeTruthy();
      expect(result.approverId).toBeNull();
      expect(result.approverName).toBeNull();
    });

    it('returns needs_approval when job level is NOT in autoGrantJobLevels', () => {
      const result = engine.checkRules('Figma', makeProfile('intern'), catalog[0]);
      expect(result.decision).toBe('needs_approval');
      expect(result.reason).toContain('intern');
      expect(result.approverId).toBe('design-lead@company.com');
      expect(result.approverName).toBe('Design Lead');
    });

    it('returns needs_approval when requiresApprovalAlways is true regardless of job level', () => {
      const result = engine.checkRules('AWS Console', makeProfile('director'), catalog[1]);
      expect(result.decision).toBe('needs_approval');
      expect(result.reason).toContain('always requires human approval');
      expect(result.approverId).toBe('infra-lead@company.com');
    });

    it('always populates a non-empty reason string', () => {
      const r1 = engine.checkRules('Figma', makeProfile('engineer'), catalog[0]);
      const r2 = engine.checkRules('Figma', makeProfile('intern'), catalog[0]);
      const r3 = engine.checkRules('AWS Console', makeProfile('vp'), catalog[1]);
      expect(r1.reason.length).toBeGreaterThan(0);
      expect(r2.reason.length).toBeGreaterThan(0);
      expect(r3.reason.length).toBeGreaterThan(0);
    });

    it('is deterministic — same inputs produce same outputs', () => {
      const profile = makeProfile('senior_engineer');
      const a = engine.checkRules('Figma', profile, catalog[0]);
      const b = engine.checkRules('Figma', profile, catalog[0]);
      expect(a).toEqual(b);
    });
  });
});
