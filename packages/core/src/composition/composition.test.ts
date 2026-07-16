import { describe, it, expect } from 'vitest';
import { parseSource } from '../covenant-lang/index';
import {
  composeCovenants,
  compileComposed,
  validateInheritance,
  InheritanceError,
} from './index';

describe('covenant composition', () => {
  it('composes parent rules before child rules', () => {
    const parent = parseSource('covenant OrgPolicy { forbid delete; }');
    const child = parseSource('covenant Agent { permit read; permit write; }');
    const composed = composeCovenants(parent, child);
    expect(composed.parentName).toBe('OrgPolicy');
    expect(composed.childName).toBe('Agent');
    expect(composed.composedStatements[0]!.source).toBe('parent');
    expect(composed.composedStatements[0]!.action).toBe('delete');
    expect(composed.composedStatements[1]!.source).toBe('child');
    expect(composed.composedStatements[1]!.action).toBe('read');
  });

  it('parent forbid cascades over a child permit (forbid-wins)', () => {
    const parent = parseSource('covenant OrgPolicy { forbid export; }');
    const child = parseSource('covenant Agent { permit export; }');
    // Composition itself should refuse, child broadens parent.
    expect(() => composeCovenants(parent, child)).toThrow(InheritanceError);
  });

  it('allows a child to add rules the parent does not mention', () => {
    const parent = parseSource('covenant OrgPolicy { forbid export; }');
    const child = parseSource('covenant Agent { permit read; permit write; }');
    const composed = composeCovenants(parent, child);
    const enforce = compileComposed(composed);
    expect(enforce({ action: 'read', params: {} }).action).toBe('allow');
    expect(enforce({ action: 'export', params: {} }).action).toBe('block');
  });

  it('decision.source identifies which layer matched', () => {
    const parent = parseSource('covenant OrgPolicy { forbid export; }');
    const child = parseSource('covenant Agent { permit read; }');
    const enforce = compileComposed(composeCovenants(parent, child));

    const exportDecision = enforce({ action: 'export', params: {} });
    expect(exportDecision.action).toBe('block');
    expect(exportDecision.source).toBe('parent');
    expect(exportDecision.originCovenant).toBe('OrgPolicy');

    const readDecision = enforce({ action: 'read', params: {} });
    expect(readDecision.action).toBe('allow');
    expect(readDecision.source).toBe('child');
    expect(readDecision.originCovenant).toBe('Agent');
  });

  it('conditional parent forbid blocks an unconditional child permit', () => {
    const parent = parseSource('covenant OrgPolicy { forbid transfer (amount > 100); }');
    const child = parseSource('covenant Agent { permit transfer; }');
    // Child removes the condition → broadens → rejected.
    const { valid, violations } = validateInheritance(parent, child);
    expect(valid).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.action).toBe('transfer');
  });

  it('two conditional statements are statically compatible (runtime resolves)', () => {
    const parent = parseSource('covenant OrgPolicy { forbid transfer (amount > 1000); }');
    const child = parseSource('covenant Agent { permit transfer (amount < 100); }');
    const { valid } = validateInheritance(parent, child);
    expect(valid).toBe(true);
    const enforce = compileComposed(composeCovenants(parent, child));
    expect(enforce({ action: 'transfer', params: { amount: 50 } }).action).toBe('allow');
    expect(enforce({ action: 'transfer', params: { amount: 2000 } }).action).toBe('block');
  });

  it('InheritanceError surfaces the first violating action', () => {
    const parent = parseSource('covenant OrgPolicy { forbid delete; }');
    const child = parseSource('covenant Agent { permit delete; }');
    try {
      composeCovenants(parent, child);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InheritanceError);
      const err = e as InheritanceError;
      expect(err.violations[0]!.action).toBe('delete');
    }
  });

  it('requirements from both are preserved', () => {
    const parent = parseSource('covenant OrgPolicy { permit read; require agent.verified == true; }');
    const child = parseSource('covenant Agent { permit write; require user.age >= 18; }');
    const composed = composeCovenants(parent, child);
    expect(composed.requirements).toHaveLength(2);
  });
});
