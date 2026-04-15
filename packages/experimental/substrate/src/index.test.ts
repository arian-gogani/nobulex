import { describe, it, expect } from 'vitest';
import {
  createAdapter,
  physicalCovenant,
  translateCovenant,
  checkPhysicalConstraint,
  checkSafetyBound,
  SUBSTRATE_DEFAULTS,
  substrateCompatibility,
  constraintTranslation,
  substrateCapabilityMatrix,
} from './index';
import type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  AdapterConfig,
} from './types';

const SUBSTRATE_TYPES: SubstrateType[] = [
  'ai-agent',
  'robot',
  'iot-device',
  'autonomous-vehicle',
  'smart-contract',
  'drone',
];

describe('createAdapter', () => {
  it('creates a valid SubstrateAdapter from config', () => {
    const config: AdapterConfig = {
      capabilities: ['navigate', 'grasp'],
      sensors: ['lidar', 'camera'],
      actuators: ['arm', 'wheels'],
      attestation: 'signed',
    };
    const adapter = createAdapter('robot', config);
    expect(adapter.type).toBe('robot');
    expect(adapter.capabilityManifest).toEqual(['navigate', 'grasp']);
    expect(adapter.sensorInputs).toEqual(['lidar', 'camera']);
    expect(adapter.actuatorOutputs).toEqual(['arm', 'wheels']);
    expect(adapter.attestationMethod).toBe('signed');
  });

  it('copies arrays so mutations do not affect the original config', () => {
    const config: AdapterConfig = {
      capabilities: ['a'],
      sensors: ['b'],
      actuators: ['c'],
      attestation: 'blockchain',
    };
    const adapter = createAdapter('smart-contract', config);
    config.capabilities.push('d');
    config.sensors.push('e');
    config.actuators.push('f');
    expect(adapter.capabilityManifest).toEqual(['a']);
    expect(adapter.sensorInputs).toEqual(['b']);
    expect(adapter.actuatorOutputs).toEqual(['c']);
  });

  it('throws for invalid substrate type', () => {
    const config: AdapterConfig = {
      capabilities: ['x'],
      sensors: [],
      actuators: [],
      attestation: 'signed',
    };
    expect(() => createAdapter('invalid-type' as SubstrateType, config)).toThrow(
      'Invalid substrate type',
    );
  });

  it('throws for empty capabilities', () => {
    const config: AdapterConfig = {
      capabilities: [],
      sensors: ['s'],
      actuators: ['a'],
      attestation: 'signed',
    };
    expect(() => createAdapter('robot', config)).toThrow(
      'capabilities must be a non-empty array',
    );
  });
});

describe('physicalCovenant', () => {
  const robotAdapter: SubstrateAdapter = {
    type: 'robot',
    capabilityManifest: ['navigate'],
    sensorInputs: ['lidar'],
    actuatorOutputs: ['arm'],
    attestationMethod: 'signed',
  };

  it('generates deterministic sha256 id from constraint content', () => {
    const c1 = physicalCovenant(robotAdapter, [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ]);
    const c2 = physicalCovenant(robotAdapter, [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ]);
    const c3 = physicalCovenant(robotAdapter, [
      { parameter: 'force', operator: 'lt', value: 200, unit: 'N' },
    ]);
    expect(c1.id).toHaveLength(64);
    expect(c1.id).toBe(c2.id);
    expect(c1.id).not.toBe(c3.id);
  });

  it('generates CCL-like constraint strings for lt/gt/equals/between', () => {
    const covenant = physicalCovenant(robotAdapter, [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
      { parameter: 'speed', operator: 'gt', value: 0, unit: 'm/s' },
      { parameter: 'temperature', operator: 'between', value: [10, 40], unit: 'C' },
      { parameter: 'reentrancy', operator: 'equals', value: 0, unit: 'bool' },
    ]);
    expect(covenant.constraints).toEqual([
      'force lt 100 N',
      'speed gt 0 m/s',
      'temperature between 10 40 C',
      'reentrancy equals 0 bool',
    ]);
  });

  it('defaults safetyBounds to empty, includes them when provided', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ];
    const bounds: SafetyBound[] = [
      { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' },
    ];
    expect(physicalCovenant(robotAdapter, constraints).safetyBounds).toEqual([]);
    expect(physicalCovenant(robotAdapter, constraints, bounds).safetyBounds).toEqual(bounds);
  });
});

describe('translateCovenant', () => {
  it('merges substrate defaults with user constraints without duplicates', () => {
    const defaultConstraint = "deny force on '**' when force_value > 100";
    const covenant = translateCovenant(['custom lt 42 units', defaultConstraint], 'robot');
    expect(covenant.substrate).toBe('robot');
    expect(covenant.constraints).toContain('custom lt 42 units');
    expect(covenant.constraints).toContain(defaultConstraint);
    expect(covenant.constraints.filter(c => c === defaultConstraint)).toHaveLength(1);
    expect(covenant.safetyBounds).toEqual(SUBSTRATE_DEFAULTS['robot'].safetyBounds);
    expect(covenant.physicalConstraints).toEqual([]);
    expect(covenant.id).toHaveLength(64);
  });

  it('merges defaults correctly for every substrate type', () => {
    for (const t of SUBSTRATE_TYPES) {
      const covenant = translateCovenant(['custom-rule-1'], t);
      expect(covenant.substrate).toBe(t);
      expect(covenant.constraints).toContain('custom-rule-1');
      for (const defaultConstraint of SUBSTRATE_DEFAULTS[t].constraints) {
        expect(covenant.constraints).toContain(defaultConstraint);
      }
      expect(covenant.safetyBounds).toEqual(SUBSTRATE_DEFAULTS[t].safetyBounds);
    }
  });

  it('throws for invalid substrate type', () => {
    expect(() => translateCovenant([], 'invalid-type' as SubstrateType)).toThrow(
      'Invalid substrate type',
    );
  });
});

describe('checkPhysicalConstraint', () => {
  const lt: PhysicalConstraint = { parameter: 'force', operator: 'lt', value: 100, unit: 'N' };
  const gt: PhysicalConstraint = { parameter: 'distance', operator: 'gt', value: 2, unit: 'm' };
  const eq: PhysicalConstraint = { parameter: 'reentrancy', operator: 'equals', value: 0, unit: 'bool' };
  const bet: PhysicalConstraint = { parameter: 'temp', operator: 'between', value: [10, 40], unit: 'C' };

  it('lt: strict less-than — boundary at value is false', () => {
    expect(checkPhysicalConstraint(lt, 50)).toBe(true);
    expect(checkPhysicalConstraint(lt, 100)).toBe(false);
    expect(checkPhysicalConstraint(lt, 150)).toBe(false);
  });

  it('gt: strict greater-than — boundary at value is false', () => {
    expect(checkPhysicalConstraint(gt, 5)).toBe(true);
    expect(checkPhysicalConstraint(gt, 2)).toBe(false);
    expect(checkPhysicalConstraint(gt, 1)).toBe(false);
  });

  it('equals: exact match', () => {
    expect(checkPhysicalConstraint(eq, 0)).toBe(true);
    expect(checkPhysicalConstraint(eq, 1)).toBe(false);
  });

  it('between: inclusive on both ends', () => {
    expect(checkPhysicalConstraint(bet, 25)).toBe(true);
    expect(checkPhysicalConstraint(bet, 10)).toBe(true);
    expect(checkPhysicalConstraint(bet, 40)).toBe(true);
    expect(checkPhysicalConstraint(bet, 5)).toBe(false);
    expect(checkPhysicalConstraint(bet, 45)).toBe(false);
  });

  it('throws for unknown operator with valid-operators list', () => {
    const bad = {
      parameter: 'x',
      operator: 'lte' as PhysicalConstraint['operator'],
      value: 10,
      unit: 'u',
    };
    expect(() => checkPhysicalConstraint(bad, 5)).toThrow('Unknown operator: "lte"');
    expect(() => checkPhysicalConstraint(bad, 5)).toThrow('Valid operators:');
  });
});

describe('checkSafetyBound', () => {
  const bound: SafetyBound = { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' };

  it('below soft limit: safe, no limit hit, no action', () => {
    expect(checkSafetyBound(bound, 50)).toEqual({ safe: true, limitHit: 'none', action: undefined });
    expect(checkSafetyBound(bound, 100)).toEqual({ safe: true, limitHit: 'none', action: undefined });
  });

  it('between soft and hard: safe but soft limit hit, action present', () => {
    const r = checkSafetyBound(bound, 120);
    expect(r.safe).toBe(true);
    expect(r.limitHit).toBe('soft');
    expect(r.action).toBe('halt');
  });

  it('at hard limit: still reported as soft hit (boundary)', () => {
    const r = checkSafetyBound(bound, 150);
    expect(r.safe).toBe(true);
    expect(r.limitHit).toBe('soft');
  });

  it('above hard limit: not safe, hard limit hit', () => {
    const r = checkSafetyBound(bound, 200);
    expect(r.safe).toBe(false);
    expect(r.limitHit).toBe('hard');
    expect(r.action).toBe('halt');
  });

  it('propagates configured action (degrade/alert)', () => {
    const degrade: SafetyBound = { property: 's', hardLimit: 3, softLimit: 2, action: 'degrade' };
    const alert: SafetyBound = { property: 't', hardLimit: 85, softLimit: 70, action: 'alert' };
    expect(checkSafetyBound(degrade, 2.5).action).toBe('degrade');
    expect(checkSafetyBound(alert, 80).action).toBe('alert');
    expect(checkSafetyBound(alert, 90).action).toBe('alert');
  });
});

describe('SUBSTRATE_DEFAULTS', () => {
  it('has well-formed defaults for every substrate type', () => {
    for (const t of SUBSTRATE_TYPES) {
      const d = SUBSTRATE_DEFAULTS[t];
      expect(Array.isArray(d.constraints)).toBe(true);
      expect(Array.isArray(d.safetyBounds)).toBe(true);
    }
  });

  it('all default constraints follow CCL patterns (deny/limit/require)', () => {
    for (const t of SUBSTRATE_TYPES) {
      for (const constraint of SUBSTRATE_DEFAULTS[t].constraints) {
        const isValid =
          constraint.startsWith('deny ') ||
          constraint.startsWith('limit ') ||
          constraint.startsWith('require ');
        expect(isValid).toBe(true);
      }
    }
  });
});

describe('substrate integration', () => {
  it('full pipeline: createAdapter -> physicalCovenant -> checks', () => {
    const adapter = createAdapter('robot', {
      capabilities: ['navigate'],
      sensors: ['lidar'],
      actuators: ['arm'],
      attestation: 'signed',
    });
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ];
    const bounds: SafetyBound[] = [
      { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' },
    ];
    const covenant = physicalCovenant(adapter, constraints, bounds);
    expect(covenant.substrate).toBe('robot');
    expect(covenant.constraints).toEqual(['force lt 100 N']);

    expect(checkPhysicalConstraint(constraints[0], 80)).toBe(true);
    expect(checkPhysicalConstraint(constraints[0], 120)).toBe(false);

    expect(checkSafetyBound(bounds[0], 80).limitHit).toBe('none');
    expect(checkSafetyBound(bounds[0], 120).limitHit).toBe('soft');
    expect(checkSafetyBound(bounds[0], 200).limitHit).toBe('hard');
  });
});

describe('substrateCompatibility', () => {
  const aiAdapter: SubstrateAdapter = {
    type: 'ai-agent',
    capabilityManifest: ['text-generation', 'data-processing', 'api-call'],
    sensorInputs: ['prompt-input'],
    actuatorOutputs: ['text-output'],
    attestationMethod: 'signed',
  };
  const robotAdapter: SubstrateAdapter = {
    type: 'robot',
    capabilityManifest: ['navigate', 'grasp', 'api-call'],
    sensorInputs: ['lidar', 'camera'],
    actuatorOutputs: ['arm', 'wheels'],
    attestationMethod: 'hardware-tpm',
  };
  const smartContractAdapter: SubstrateAdapter = {
    type: 'smart-contract',
    capabilityManifest: ['token-transfer', 'state-management'],
    sensorInputs: [],
    actuatorOutputs: [],
    attestationMethod: 'blockchain',
  };
  const vehicleAdapter: SubstrateAdapter = {
    type: 'autonomous-vehicle',
    capabilityManifest: ['navigate', 'sensor-fusion'],
    sensorInputs: ['lidar', 'radar', 'camera'],
    actuatorOutputs: ['steering', 'throttle', 'brake'],
    attestationMethod: 'hardware-tpm',
  };

  it('cross-domain cyber<->physical returns bridged protocol with human-oversight + bridge_adapter constraints', () => {
    const result = substrateCompatibility(aiAdapter, robotAdapter);
    expect(result.compatible).toBe(true);
    expect(result.interactionProtocol).toBe('bridged');
    expect(result.sharedCapabilities).toContain('api-call');
    expect(result.constraints).toContain('require human_oversight enabled per 1 interaction');
    expect(result.constraints).toContain('require bridge_adapter available per 1 interaction');
    expect(result.warnings.some(w => w.includes('bridge adapter'))).toBe(true);
  });

  it('two physical substrates require safety interlock', () => {
    const result = substrateCompatibility(robotAdapter, vehicleAdapter);
    expect(result.constraints).toContain('require safety_interlock active per 1 interaction');
  });

  it('no shared protocols = incompatible with warnings', () => {
    const result = substrateCompatibility(smartContractAdapter, aiAdapter);
    expect(result.compatible).toBe(false);
    expect(result.interactionProtocol).toBe('incompatible');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('same type returns direct protocol', () => {
    const result = substrateCompatibility(robotAdapter, { ...robotAdapter, capabilityManifest: ['navigate', 'lift'] });
    expect(result.compatible).toBe(true);
    expect(result.interactionProtocol).toBe('direct');
  });

  it('throws for invalid source or target substrate type', () => {
    expect(() =>
      substrateCompatibility({ ...aiAdapter, type: 'invalid' as SubstrateType }, robotAdapter),
    ).toThrow('Invalid substrate type');
    expect(() =>
      substrateCompatibility(aiAdapter, { ...robotAdapter, type: 'invalid' as SubstrateType }),
    ).toThrow('Invalid substrate type');
  });
});

describe('constraintTranslation', () => {
  it('deny for ai-agent: output-filter (software)', () => {
    const result = constraintTranslation("deny data.delete on '**' when unauthorized", 'ai-agent');
    expect(result.constraint).toBe("deny data.delete on '**' when unauthorized");
    expect(result.targetSubstrate).toBe('ai-agent');
    expect(result.overallFeasibility).toBe(true);
    expect(result.rules[0].mechanism).toBe('output-filter');
    expect(result.rules[0].enforcementLevel).toBe('software');
  });

  it('deny for smart-contract: require-revert (contractual)', () => {
    const result = constraintTranslation("deny reentrancy on '**' when call_depth > 0", 'smart-contract');
    expect(result.rules[0].mechanism).toBe('require-revert');
    expect(result.rules[0].enforcementLevel).toBe('contractual');
  });

  it('deny for physical substrate (robot) produces hardware interlock + safety monitor', () => {
    const result = constraintTranslation("deny force on '**' when force_value > 100", 'robot');
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0].mechanism).toBe('hardware-interlock');
    expect(result.rules[0].enforcementLevel).toBe('hardware');
    expect(result.rules[1].mechanism).toBe('safety-monitor');
  });

  it('limit for drone (geofence-limiter) vs ai-agent (rate-limiter + audit)', () => {
    const drone = constraintTranslation("limit altitude 120 per 1 flight", 'drone');
    expect(drone.rules[0].mechanism).toBe('geofence-limiter');
    expect(drone.rules[0].enforcementLevel).toBe('hardware');

    const ai = constraintTranslation("limit response_time 5000 per 1 request", 'ai-agent');
    expect(ai.rules).toHaveLength(2);
    expect(ai.rules[0].mechanism).toBe('rate-limiter');
    expect(ai.rules[1].mechanism).toBe('audit-logger');
  });

  it('require for vehicle (sensor-fusion-gate/hardware) vs iot (state-check/software)', () => {
    const v = constraintTranslation("require following_distance > 2 per 1 travel", 'autonomous-vehicle');
    expect(v.rules[0].mechanism).toBe('sensor-fusion-gate');
    expect(v.rules[0].enforcementLevel).toBe('hardware');
    const iot = constraintTranslation("require temperature_ok before transmit", 'iot-device');
    expect(iot.rules[0].mechanism).toBe('state-check');
    expect(iot.rules[0].enforcementLevel).toBe('software');
  });

  it('unparseable constraint: manual-review advisory, infeasible', () => {
    const result = constraintTranslation("some-weird-format", 'ai-agent');
    expect(result.overallFeasibility).toBe(false);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].mechanism).toBe('manual-review');
    expect(result.rules[0].enforcementLevel).toBe('advisory');
    expect(result.rules[0].feasible).toBe(false);
  });

  it('deny secondary safety-monitor only on physical substrates', () => {
    const physical = constraintTranslation("deny collision on '**' when proximity < 1", 'autonomous-vehicle');
    expect(physical.rules.find(r => r.mechanism === 'safety-monitor')).toBeDefined();
    const cyber = constraintTranslation("deny data.delete on '**' when unauthorized", 'smart-contract');
    expect(cyber.rules.find(r => r.mechanism === 'safety-monitor')).toBeUndefined();
  });

  it('preserves original constraint on every rule', () => {
    const constraint = "limit gas_usage 30000000 per 1 transaction";
    const result = constraintTranslation(constraint, 'smart-contract');
    for (const rule of result.rules) {
      expect(rule.originalConstraint).toBe(constraint);
    }
  });

  it('throws for empty/whitespace constraint and invalid substrate', () => {
    expect(() => constraintTranslation('', 'ai-agent')).toThrow('Constraint must be a non-empty string');
    expect(() => constraintTranslation('   ', 'ai-agent')).toThrow('Constraint must be a non-empty string');
    expect(() => constraintTranslation("deny x", 'invalid' as SubstrateType)).toThrow('Invalid substrate type');
  });
});

describe('substrateCapabilityMatrix', () => {
  it('returns all 6 substrates x 10 capabilities unfiltered, filters on request', () => {
    const full = substrateCapabilityMatrix();
    expect(full.substrates).toHaveLength(6);
    expect(full.capabilities).toHaveLength(10);
    for (const row of full.substrates) {
      expect(row.capabilities).toHaveLength(10);
      for (const cap of row.capabilities) {
        expect(cap.notes.length).toBeGreaterThan(0);
      }
    }

    const filtered = substrateCapabilityMatrix(['ai-agent', 'drone']);
    expect(filtered.substrates.map(s => s.substrateType)).toEqual(['ai-agent', 'drone']);
  });

  it('encodes substrate-specific capability limits (ai-agent: no physical bound; robot: hardware physical; smart-contract: no encryption)', () => {
    const m = substrateCapabilityMatrix();
    const get = (type: SubstrateType, cap: string) =>
      m.substrates.find(s => s.substrateType === type)!.capabilities.find(c => c.capability === cap)!;

    expect(get('ai-agent', 'enforce-physical-bound').supported).toBe(false);
    expect(get('ai-agent', 'enforce-physical-bound').enforcementLevel).toBe('none');
    expect(get('robot', 'enforce-physical-bound').supported).toBe(true);
    expect(get('robot', 'enforce-physical-bound').enforcementLevel).toBe('hardware');
    expect(get('smart-contract', 'data-encryption').supported).toBe(false);
    expect(get('drone', 'enforce-geofence').enforcementLevel).toBe('hardware');
  });

  it('universal capabilities (audit-logging, autonomous-halt) supported by all substrates', () => {
    const m = substrateCapabilityMatrix();
    for (const row of m.substrates) {
      expect(row.capabilities.find(c => c.capability === 'audit-logging')!.supported).toBe(true);
      expect(row.capabilities.find(c => c.capability === 'autonomous-halt')!.supported).toBe(true);
    }
  });

  it('throws for invalid substrate type in filter', () => {
    expect(() => substrateCapabilityMatrix(['invalid' as SubstrateType])).toThrow('Invalid substrate type');
  });
});
