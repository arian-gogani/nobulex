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

// ---------------------------------------------------------------------------
// createAdapter
// ---------------------------------------------------------------------------
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

  it('creates an ai-agent adapter', () => {
    const config: AdapterConfig = {
      capabilities: ['text-generation', 'code-completion'],
      sensors: ['prompt-input'],
      actuators: ['text-output'],
      attestation: 'signed',
    };
    const adapter = createAdapter('ai-agent', config);
    expect(adapter.type).toBe('ai-agent');
    expect(adapter.capabilityManifest).toEqual(['text-generation', 'code-completion']);
  });

  it('creates a drone adapter with hardware-tpm attestation', () => {
    const config: AdapterConfig = {
      capabilities: ['fly', 'photograph'],
      sensors: ['gps', 'altimeter', 'camera'],
      actuators: ['rotors', 'gimbal'],
      attestation: 'hardware-tpm',
    };
    const adapter = createAdapter('drone', config);
    expect(adapter.type).toBe('drone');
    expect(adapter.attestationMethod).toBe('hardware-tpm');
    expect(adapter.sensorInputs).toHaveLength(3);
  });

  it('creates an iot-device adapter with sensor-log attestation', () => {
    const config: AdapterConfig = {
      capabilities: ['temperature-reading', 'humidity-reading'],
      sensors: ['thermometer', 'hygrometer'],
      actuators: ['relay'],
      attestation: 'sensor-log',
    };
    const adapter = createAdapter('iot-device', config);
    expect(adapter.type).toBe('iot-device');
    expect(adapter.attestationMethod).toBe('sensor-log');
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
    expect(adapter.capabilityManifest).toEqual(['a']);
  });

  // ---- Input validation ----

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

// ---------------------------------------------------------------------------
// physicalCovenant
// ---------------------------------------------------------------------------
describe('physicalCovenant', () => {
  const robotAdapter: SubstrateAdapter = {
    type: 'robot',
    capabilityManifest: ['navigate'],
    sensorInputs: ['lidar'],
    actuatorOutputs: ['arm'],
    attestationMethod: 'signed',
  };

  it('creates a UniversalCovenant with generated id', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ];
    const covenant = physicalCovenant(robotAdapter, constraints);
    expect(covenant.id).toBeTruthy();
    expect(typeof covenant.id).toBe('string');
    expect(covenant.id.length).toBe(64); // sha256 hex
  });

  it('generates CCL-like constraint strings from physical constraints', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
      { parameter: 'speed', operator: 'gt', value: 0, unit: 'm/s' },
    ];
    const covenant = physicalCovenant(robotAdapter, constraints);
    expect(covenant.constraints).toEqual([
      'force lt 100 N',
      'speed gt 0 m/s',
    ]);
  });

  it('handles between operator correctly', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'temperature', operator: 'between', value: [10, 40], unit: 'C' },
    ];
    const covenant = physicalCovenant(robotAdapter, constraints);
    expect(covenant.constraints).toEqual(['temperature between 10 40 C']);
  });

  it('handles equals operator correctly', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'reentrancy', operator: 'equals', value: 0, unit: 'bool' },
    ];
    const covenant = physicalCovenant(robotAdapter, constraints);
    expect(covenant.constraints).toEqual(['reentrancy equals 0 bool']);
  });

  it('includes safety bounds when provided', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ];
    const bounds: SafetyBound[] = [
      { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' },
    ];
    const covenant = physicalCovenant(robotAdapter, constraints, bounds);
    expect(covenant.safetyBounds).toEqual(bounds);
  });

  it('defaults to empty safety bounds when not provided', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ];
    const covenant = physicalCovenant(robotAdapter, constraints);
    expect(covenant.safetyBounds).toEqual([]);
  });

  it('produces deterministic id for same inputs', () => {
    const constraints: PhysicalConstraint[] = [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ];
    const c1 = physicalCovenant(robotAdapter, constraints);
    const c2 = physicalCovenant(robotAdapter, constraints);
    expect(c1.id).toBe(c2.id);
  });

  it('produces different ids for different constraints', () => {
    const c1 = physicalCovenant(robotAdapter, [
      { parameter: 'force', operator: 'lt', value: 100, unit: 'N' },
    ]);
    const c2 = physicalCovenant(robotAdapter, [
      { parameter: 'force', operator: 'lt', value: 200, unit: 'N' },
    ]);
    expect(c1.id).not.toBe(c2.id);
  });
});

// ---------------------------------------------------------------------------
// translateCovenant
// ---------------------------------------------------------------------------
describe('translateCovenant', () => {
  it('merges robot default constraints with incoming constraints', () => {
    const covenant = translateCovenant(['custom lt 42 units'], 'robot');
    expect(covenant.constraints).toContain('custom lt 42 units');
    expect(covenant.constraints).toContain("deny force on '**' when force_value > 100");
    expect(covenant.constraints).toContain("limit speed 2 per 1 movement");
    expect(covenant.substrate).toBe('robot');
  });

  it('merges drone default constraints', () => {
    const covenant = translateCovenant(['custom-drone-rule'], 'drone');
    expect(covenant.constraints).toContain('custom-drone-rule');
    expect(covenant.constraints).toContain("limit altitude 120 per 1 flight");
    expect(covenant.constraints).toContain("require geofence within 10 per 1 flight");
    expect(covenant.substrate).toBe('drone');
  });

  it('merges iot-device default constraints', () => {
    const covenant = translateCovenant(['power lt 5 W'], 'iot-device');
    expect(covenant.constraints).toContain('power lt 5 W');
    expect(covenant.constraints).toContain("limit data.transmit 1000 per 60 seconds");
    expect(covenant.constraints).toContain("limit power.draw 5 per 1 cycle");
    expect(covenant.substrate).toBe('iot-device');
  });

  it('does not duplicate constraints that exactly match a default', () => {
    const defaultConstraint = "deny force on '**' when force_value > 100";
    const covenant = translateCovenant([defaultConstraint], 'robot');
    const matching = covenant.constraints.filter(c => c === defaultConstraint);
    expect(matching).toHaveLength(1);
  });

  it('preserves original constraints', () => {
    const original = ['custom-a', 'custom-b'];
    const covenant = translateCovenant(original, 'robot');
    expect(covenant.constraints).toContain('custom-a');
    expect(covenant.constraints).toContain('custom-b');
  });

  it('includes default safety bounds for target substrate', () => {
    const covenant = translateCovenant([], 'robot');
    expect(covenant.safetyBounds).toEqual(SUBSTRATE_DEFAULTS['robot'].safetyBounds);
  });

  it('merges ai-agent default constraints', () => {
    const covenant = translateCovenant([], 'ai-agent');
    expect(covenant.constraints).toContain("limit response_time 5000 per 1 request");
    expect(covenant.constraints).toContain("limit memory_usage 4096 per 1 instance");
  });

  it('merges autonomous-vehicle default constraints', () => {
    const covenant = translateCovenant([], 'autonomous-vehicle');
    expect(covenant.constraints).toContain("limit speed 130 per 1 travel");
    expect(covenant.constraints).toContain("require following_distance > 2 per 1 travel");
  });

  it('merges smart-contract default constraints', () => {
    const covenant = translateCovenant([], 'smart-contract');
    expect(covenant.constraints).toContain("limit gas_usage 30000000 per 1 transaction");
    expect(covenant.constraints).toContain("deny reentrancy on '**' when call_depth > 0");
  });

  it('produces a valid id', () => {
    const covenant = translateCovenant([], 'drone');
    expect(covenant.id).toBeTruthy();
    expect(covenant.id.length).toBe(64);
  });

  it('returns empty physicalConstraints', () => {
    const covenant = translateCovenant([], 'robot');
    expect(covenant.physicalConstraints).toEqual([]);
  });

  // ---- Input validation ----

  it('throws for invalid substrate type', () => {
    expect(() => translateCovenant([], 'invalid-type' as SubstrateType)).toThrow(
      'Invalid substrate type',
    );
  });
});

// ---------------------------------------------------------------------------
// checkPhysicalConstraint
// ---------------------------------------------------------------------------
describe('checkPhysicalConstraint', () => {
  it('lt operator: value below limit returns true', () => {
    const constraint: PhysicalConstraint = { parameter: 'force', operator: 'lt', value: 100, unit: 'N' };
    expect(checkPhysicalConstraint(constraint, 50)).toBe(true);
  });

  it('lt operator: value equal to limit returns false', () => {
    const constraint: PhysicalConstraint = { parameter: 'force', operator: 'lt', value: 100, unit: 'N' };
    expect(checkPhysicalConstraint(constraint, 100)).toBe(false);
  });

  it('lt operator: value above limit returns false', () => {
    const constraint: PhysicalConstraint = { parameter: 'force', operator: 'lt', value: 100, unit: 'N' };
    expect(checkPhysicalConstraint(constraint, 150)).toBe(false);
  });

  it('gt operator: value above limit returns true', () => {
    const constraint: PhysicalConstraint = { parameter: 'distance', operator: 'gt', value: 2, unit: 'm' };
    expect(checkPhysicalConstraint(constraint, 5)).toBe(true);
  });

  it('gt operator: value equal to limit returns false', () => {
    const constraint: PhysicalConstraint = { parameter: 'distance', operator: 'gt', value: 2, unit: 'm' };
    expect(checkPhysicalConstraint(constraint, 2)).toBe(false);
  });

  it('equals operator: matching value returns true', () => {
    const constraint: PhysicalConstraint = { parameter: 'reentrancy', operator: 'equals', value: 0, unit: 'bool' };
    expect(checkPhysicalConstraint(constraint, 0)).toBe(true);
  });

  it('equals operator: non-matching value returns false', () => {
    const constraint: PhysicalConstraint = { parameter: 'reentrancy', operator: 'equals', value: 0, unit: 'bool' };
    expect(checkPhysicalConstraint(constraint, 1)).toBe(false);
  });

  it('between operator: value within range returns true', () => {
    const constraint: PhysicalConstraint = { parameter: 'temp', operator: 'between', value: [10, 40], unit: 'C' };
    expect(checkPhysicalConstraint(constraint, 25)).toBe(true);
  });

  it('between operator: value at lower bound returns true', () => {
    const constraint: PhysicalConstraint = { parameter: 'temp', operator: 'between', value: [10, 40], unit: 'C' };
    expect(checkPhysicalConstraint(constraint, 10)).toBe(true);
  });

  it('between operator: value at upper bound returns true', () => {
    const constraint: PhysicalConstraint = { parameter: 'temp', operator: 'between', value: [10, 40], unit: 'C' };
    expect(checkPhysicalConstraint(constraint, 40)).toBe(true);
  });

  it('between operator: value below range returns false', () => {
    const constraint: PhysicalConstraint = { parameter: 'temp', operator: 'between', value: [10, 40], unit: 'C' };
    expect(checkPhysicalConstraint(constraint, 5)).toBe(false);
  });

  it('between operator: value above range returns false', () => {
    const constraint: PhysicalConstraint = { parameter: 'temp', operator: 'between', value: [10, 40], unit: 'C' };
    expect(checkPhysicalConstraint(constraint, 45)).toBe(false);
  });

  // ---- Unknown operator handling ----

  it('throws for unknown operator', () => {
    const constraint = {
      parameter: 'x',
      operator: 'lte' as PhysicalConstraint['operator'],
      value: 10,
      unit: 'u',
    };
    expect(() => checkPhysicalConstraint(constraint, 5)).toThrow('Unknown operator: "lte"');
  });

  it('throws with list of valid operators for unknown operator', () => {
    const constraint = {
      parameter: 'x',
      operator: 'gte' as PhysicalConstraint['operator'],
      value: 10,
      unit: 'u',
    };
    expect(() => checkPhysicalConstraint(constraint, 5)).toThrow('Valid operators:');
  });
});

// ---------------------------------------------------------------------------
// checkSafetyBound (with limitHit distinction)
// ---------------------------------------------------------------------------
describe('checkSafetyBound', () => {
  const bound: SafetyBound = { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' };

  it('value below soft limit: safe, no limit hit, no action', () => {
    const result = checkSafetyBound(bound, 50);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('none');
    expect(result.action).toBeUndefined();
  });

  it('value at soft limit: safe, no limit hit, no action', () => {
    const result = checkSafetyBound(bound, 100);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('none');
    expect(result.action).toBeUndefined();
  });

  it('value between soft and hard limit: safe, soft limit hit, action present', () => {
    const result = checkSafetyBound(bound, 120);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('soft');
    expect(result.action).toBe('halt');
  });

  it('value at hard limit: safe, soft limit hit, action present', () => {
    const result = checkSafetyBound(bound, 150);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('soft');
    expect(result.action).toBe('halt');
  });

  it('value above hard limit: not safe, hard limit hit, action present', () => {
    const result = checkSafetyBound(bound, 200);
    expect(result.safe).toBe(false);
    expect(result.limitHit).toBe('hard');
    expect(result.action).toBe('halt');
  });

  it('degrade action returned correctly with limitHit', () => {
    const degradeBound: SafetyBound = { property: 'speed', hardLimit: 3, softLimit: 2, action: 'degrade' };
    const result = checkSafetyBound(degradeBound, 2.5);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('soft');
    expect(result.action).toBe('degrade');
  });

  it('alert action returned correctly with limitHit', () => {
    const alertBound: SafetyBound = { property: 'temp', hardLimit: 85, softLimit: 70, action: 'alert' };
    const result = checkSafetyBound(alertBound, 80);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('soft');
    expect(result.action).toBe('alert');
  });

  it('hard limit hit returns correct action for alert', () => {
    const alertBound: SafetyBound = { property: 'temp', hardLimit: 85, softLimit: 70, action: 'alert' };
    const result = checkSafetyBound(alertBound, 90);
    expect(result.safe).toBe(false);
    expect(result.limitHit).toBe('hard');
    expect(result.action).toBe('alert');
  });

  it('well below all limits returns no action and none limitHit', () => {
    const result = checkSafetyBound(bound, 0);
    expect(result.safe).toBe(true);
    expect(result.limitHit).toBe('none');
    expect(result.action).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SUBSTRATE_DEFAULTS (valid CCL strings)
// ---------------------------------------------------------------------------
describe('SUBSTRATE_DEFAULTS', () => {
  it('has defaults for all substrate types', () => {
    const types: SubstrateType[] = ['ai-agent', 'robot', 'iot-device', 'autonomous-vehicle', 'smart-contract', 'drone'];
    for (const t of types) {
      expect(SUBSTRATE_DEFAULTS[t]).toBeDefined();
      expect(SUBSTRATE_DEFAULTS[t].constraints).toBeDefined();
      expect(Array.isArray(SUBSTRATE_DEFAULTS[t].constraints)).toBe(true);
      expect(SUBSTRATE_DEFAULTS[t].safetyBounds).toBeDefined();
      expect(Array.isArray(SUBSTRATE_DEFAULTS[t].safetyBounds)).toBe(true);
    }
  });

  it('robot defaults use valid CCL deny/limit patterns', () => {
    const robot = SUBSTRATE_DEFAULTS['robot'];
    expect(robot.constraints).toContain("deny force on '**' when force_value > 100");
    expect(robot.constraints).toContain("limit speed 2 per 1 movement");
  });

  it('drone defaults use valid CCL limit/require patterns', () => {
    const drone = SUBSTRATE_DEFAULTS['drone'];
    expect(drone.constraints).toContain("limit altitude 120 per 1 flight");
    expect(drone.constraints).toContain("require geofence within 10 per 1 flight");
  });

  it('ai-agent defaults use valid CCL limit patterns', () => {
    const agent = SUBSTRATE_DEFAULTS['ai-agent'];
    expect(agent.constraints).toContain("limit response_time 5000 per 1 request");
    expect(agent.constraints).toContain("limit memory_usage 4096 per 1 instance");
  });

  it('iot-device defaults use valid CCL limit patterns', () => {
    const iot = SUBSTRATE_DEFAULTS['iot-device'];
    expect(iot.constraints).toContain("limit data.transmit 1000 per 60 seconds");
    expect(iot.constraints).toContain("limit power.draw 5 per 1 cycle");
  });

  it('autonomous-vehicle defaults use valid CCL limit/require patterns', () => {
    const av = SUBSTRATE_DEFAULTS['autonomous-vehicle'];
    expect(av.constraints).toContain("limit speed 130 per 1 travel");
    expect(av.constraints).toContain("require following_distance > 2 per 1 travel");
  });

  it('smart-contract defaults use valid CCL limit/deny patterns', () => {
    const sc = SUBSTRATE_DEFAULTS['smart-contract'];
    expect(sc.constraints).toContain("limit gas_usage 30000000 per 1 transaction");
    expect(sc.constraints).toContain("deny reentrancy on '**' when call_depth > 0");
  });

  it('all default constraints follow CCL patterns (deny/limit/require)', () => {
    const types: SubstrateType[] = ['ai-agent', 'robot', 'iot-device', 'autonomous-vehicle', 'smart-contract', 'drone'];
    for (const t of types) {
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

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------
describe('substrate integration', () => {
  it('creates adapter, builds covenant, checks constraints and bounds', () => {
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

    // Constraint check
    expect(checkPhysicalConstraint(constraints[0], 80)).toBe(true);
    expect(checkPhysicalConstraint(constraints[0], 120)).toBe(false);

    // Safety bound check
    const safe = checkSafetyBound(bounds[0], 80);
    expect(safe.safe).toBe(true);
    expect(safe.limitHit).toBe('none');

    const softHit = checkSafetyBound(bounds[0], 120);
    expect(softHit.safe).toBe(true);
    expect(softHit.limitHit).toBe('soft');
    expect(softHit.action).toBe('halt');

    const hardHit = checkSafetyBound(bounds[0], 200);
    expect(hardHit.safe).toBe(false);
    expect(hardHit.limitHit).toBe('hard');
    expect(hardHit.action).toBe('halt');
  });

  it('translateCovenant merges defaults and incoming for any substrate type', () => {
    const types: SubstrateType[] = ['ai-agent', 'robot', 'iot-device', 'autonomous-vehicle', 'smart-contract', 'drone'];
    for (const t of types) {
      const covenant = translateCovenant(['custom-rule-1'], t);
      expect(covenant.constraints).toContain('custom-rule-1');
      // Should have at least the default constraints
      for (const defaultConstraint of SUBSTRATE_DEFAULTS[t].constraints) {
        expect(covenant.constraints).toContain(defaultConstraint);
      }
      expect(covenant.safetyBounds).toEqual(SUBSTRATE_DEFAULTS[t].safetyBounds);
    }
  });
});

// ---------------------------------------------------------------------------
// substrateCompatibility
// ---------------------------------------------------------------------------
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

  const iotAdapter: SubstrateAdapter = {
    type: 'iot-device',
    capabilityManifest: ['temperature-reading', 'api-call'],
    sensorInputs: ['thermometer'],
    actuatorOutputs: ['relay'],
    attestationMethod: 'sensor-log',
  };

  const smartContractAdapter: SubstrateAdapter = {
    type: 'smart-contract',
    capabilityManifest: ['token-transfer', 'state-management'],
    sensorInputs: [],
    actuatorOutputs: [],
    attestationMethod: 'blockchain',
  };

  const droneAdapter: SubstrateAdapter = {
    type: 'drone',
    capabilityManifest: ['fly', 'photograph', 'api-call'],
    sensorInputs: ['gps', 'altimeter'],
    actuatorOutputs: ['rotors', 'gimbal'],
    attestationMethod: 'hardware-tpm',
  };

  const vehicleAdapter: SubstrateAdapter = {
    type: 'autonomous-vehicle',
    capabilityManifest: ['navigate', 'sensor-fusion'],
    sensorInputs: ['lidar', 'radar', 'camera'],
    actuatorOutputs: ['steering', 'throttle', 'brake'],
    attestationMethod: 'hardware-tpm',
  };

  it('ai-agent and iot-device are compatible via shared api protocol', () => {
    const result = substrateCompatibility(aiAdapter, iotAdapter);
    expect(result.compatible).toBe(true);
    expect(result.sourceType).toBe('ai-agent');
    expect(result.targetType).toBe('iot-device');
  });

  it('ai-agent and robot share api protocol and are compatible', () => {
    const result = substrateCompatibility(aiAdapter, robotAdapter);
    expect(result.compatible).toBe(true);
    expect(result.interactionProtocol).toBe('bridged');
  });

  it('identifies shared capabilities between adapters', () => {
    const result = substrateCompatibility(aiAdapter, robotAdapter);
    expect(result.sharedCapabilities).toContain('api-call');
  });

  it('robot and drone share sensor-bus protocol', () => {
    const result = substrateCompatibility(robotAdapter, droneAdapter);
    expect(result.compatible).toBe(true);
    expect(result.sharedCapabilities).toContain('api-call');
  });

  it('two physical substrates require safety interlock constraint', () => {
    const result = substrateCompatibility(robotAdapter, vehicleAdapter);
    expect(result.constraints).toContain('require safety_interlock active per 1 interaction');
  });

  it('cyber to physical interaction requires human oversight', () => {
    const result = substrateCompatibility(aiAdapter, robotAdapter);
    expect(result.constraints).toContain('require human_oversight enabled per 1 interaction');
  });

  it('smart-contract and ai-agent are incompatible (no shared protocols)', () => {
    const result = substrateCompatibility(smartContractAdapter, aiAdapter);
    expect(result.compatible).toBe(false);
    expect(result.interactionProtocol).toBe('incompatible');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('same-type compatibility returns direct protocol', () => {
    const robot2: SubstrateAdapter = {
      ...robotAdapter,
      capabilityManifest: ['navigate', 'lift'],
    };
    const result = substrateCompatibility(robotAdapter, robot2);
    expect(result.compatible).toBe(true);
    expect(result.interactionProtocol).toBe('direct');
  });

  it('iot-device (hybrid) with any domain is direct', () => {
    const result = substrateCompatibility(iotAdapter, aiAdapter);
    expect(result.interactionProtocol).toBe('direct');
  });

  it('cross-domain bridged interaction includes bridge warning', () => {
    const result = substrateCompatibility(aiAdapter, robotAdapter);
    expect(result.warnings.some(w => w.includes('bridge adapter'))).toBe(true);
    expect(result.constraints).toContain('require bridge_adapter available per 1 interaction');
  });

  it('throws for invalid source substrate type', () => {
    const bad = { ...aiAdapter, type: 'invalid' as SubstrateType };
    expect(() => substrateCompatibility(bad, robotAdapter)).toThrow('Invalid substrate type');
  });

  it('throws for invalid target substrate type', () => {
    const bad = { ...robotAdapter, type: 'invalid' as SubstrateType };
    expect(() => substrateCompatibility(aiAdapter, bad)).toThrow('Invalid substrate type');
  });
});

// ---------------------------------------------------------------------------
// constraintTranslation
// ---------------------------------------------------------------------------
describe('constraintTranslation', () => {
  it('translates a deny constraint for ai-agent as software output-filter', () => {
    const result = constraintTranslation("deny data.delete on '**' when unauthorized", 'ai-agent');
    expect(result.constraint).toBe("deny data.delete on '**' when unauthorized");
    expect(result.targetSubstrate).toBe('ai-agent');
    expect(result.overallFeasibility).toBe(true);
    expect(result.rules.length).toBeGreaterThanOrEqual(1);
    expect(result.rules[0].mechanism).toBe('output-filter');
    expect(result.rules[0].enforcementLevel).toBe('software');
  });

  it('translates a deny constraint for smart-contract as require-revert', () => {
    const result = constraintTranslation("deny reentrancy on '**' when call_depth > 0", 'smart-contract');
    expect(result.rules[0].mechanism).toBe('require-revert');
    expect(result.rules[0].enforcementLevel).toBe('contractual');
  });

  it('translates a deny constraint for robot with hardware interlock and safety monitor', () => {
    const result = constraintTranslation("deny force on '**' when force_value > 100", 'robot');
    expect(result.rules.length).toBe(2);
    expect(result.rules[0].mechanism).toBe('hardware-interlock');
    expect(result.rules[0].enforcementLevel).toBe('hardware');
    expect(result.rules[1].mechanism).toBe('safety-monitor');
  });

  it('translates a limit constraint for ai-agent as rate-limiter with audit-logger', () => {
    const result = constraintTranslation("limit response_time 5000 per 1 request", 'ai-agent');
    expect(result.rules.length).toBe(2);
    expect(result.rules[0].mechanism).toBe('rate-limiter');
    expect(result.rules[1].mechanism).toBe('audit-logger');
  });

  it('translates a limit constraint for drone as geofence-limiter', () => {
    const result = constraintTranslation("limit altitude 120 per 1 flight", 'drone');
    expect(result.rules[0].mechanism).toBe('geofence-limiter');
    expect(result.rules[0].enforcementLevel).toBe('hardware');
  });

  it('translates a require constraint for autonomous-vehicle as sensor-fusion-gate', () => {
    const result = constraintTranslation("require following_distance > 2 per 1 travel", 'autonomous-vehicle');
    expect(result.rules[0].mechanism).toBe('sensor-fusion-gate');
    expect(result.rules[0].enforcementLevel).toBe('hardware');
  });

  it('translates a require constraint for iot-device as state-check', () => {
    const result = constraintTranslation("require temperature_ok before transmit", 'iot-device');
    expect(result.rules[0].mechanism).toBe('state-check');
    expect(result.rules[0].enforcementLevel).toBe('software');
  });

  it('returns advisory rule for unparseable constraint', () => {
    const result = constraintTranslation("some-weird-format", 'ai-agent');
    expect(result.overallFeasibility).toBe(false);
    expect(result.rules.length).toBe(1);
    expect(result.rules[0].mechanism).toBe('manual-review');
    expect(result.rules[0].enforcementLevel).toBe('advisory');
    expect(result.rules[0].feasible).toBe(false);
  });

  it('throws for empty constraint string', () => {
    expect(() => constraintTranslation('', 'ai-agent')).toThrow('Constraint must be a non-empty string');
  });

  it('throws for whitespace-only constraint string', () => {
    expect(() => constraintTranslation('   ', 'ai-agent')).toThrow('Constraint must be a non-empty string');
  });

  it('throws for invalid substrate type', () => {
    expect(() => constraintTranslation("deny x", 'invalid' as SubstrateType)).toThrow('Invalid substrate type');
  });

  it('deny on physical substrate produces safety-monitor secondary rule', () => {
    const result = constraintTranslation("deny collision on '**' when proximity < 1", 'autonomous-vehicle');
    const safetyRule = result.rules.find(r => r.mechanism === 'safety-monitor');
    expect(safetyRule).toBeDefined();
    expect(safetyRule!.enforcementLevel).toBe('software');
  });

  it('deny on cyber substrate does NOT produce safety-monitor secondary rule', () => {
    const result = constraintTranslation("deny data.delete on '**' when unauthorized", 'smart-contract');
    const safetyRule = result.rules.find(r => r.mechanism === 'safety-monitor');
    expect(safetyRule).toBeUndefined();
  });

  it('preserves original constraint in every rule', () => {
    const constraint = "limit gas_usage 30000000 per 1 transaction";
    const result = constraintTranslation(constraint, 'smart-contract');
    for (const rule of result.rules) {
      expect(rule.originalConstraint).toBe(constraint);
    }
  });
});

// ---------------------------------------------------------------------------
// substrateCapabilityMatrix
// ---------------------------------------------------------------------------
describe('substrateCapabilityMatrix', () => {
  it('returns a matrix with all 6 substrate types when no filter is given', () => {
    const matrix = substrateCapabilityMatrix();
    expect(matrix.substrates).toHaveLength(6);
    const types = matrix.substrates.map(s => s.substrateType);
    expect(types).toContain('ai-agent');
    expect(types).toContain('robot');
    expect(types).toContain('iot-device');
    expect(types).toContain('autonomous-vehicle');
    expect(types).toContain('smart-contract');
    expect(types).toContain('drone');
  });

  it('returns the standard set of 10 capabilities', () => {
    const matrix = substrateCapabilityMatrix();
    expect(matrix.capabilities).toHaveLength(10);
    expect(matrix.capabilities).toContain('enforce-rate-limit');
    expect(matrix.capabilities).toContain('enforce-access-deny');
    expect(matrix.capabilities).toContain('enforce-physical-bound');
    expect(matrix.capabilities).toContain('enforce-geofence');
    expect(matrix.capabilities).toContain('audit-logging');
  });

  it('each substrate row has entries for all 10 capabilities', () => {
    const matrix = substrateCapabilityMatrix();
    for (const row of matrix.substrates) {
      expect(row.capabilities).toHaveLength(10);
    }
  });

  it('ai-agent cannot enforce physical bounds', () => {
    const matrix = substrateCapabilityMatrix(['ai-agent']);
    const aiRow = matrix.substrates[0];
    const physBound = aiRow.capabilities.find(c => c.capability === 'enforce-physical-bound');
    expect(physBound).toBeDefined();
    expect(physBound!.supported).toBe(false);
    expect(physBound!.enforcementLevel).toBe('none');
  });

  it('robot can enforce physical bounds at hardware level', () => {
    const matrix = substrateCapabilityMatrix(['robot']);
    const robotRow = matrix.substrates[0];
    const physBound = robotRow.capabilities.find(c => c.capability === 'enforce-physical-bound');
    expect(physBound).toBeDefined();
    expect(physBound!.supported).toBe(true);
    expect(physBound!.enforcementLevel).toBe('hardware');
  });

  it('smart-contract cannot do data-encryption (on-chain data is public)', () => {
    const matrix = substrateCapabilityMatrix(['smart-contract']);
    const scRow = matrix.substrates[0];
    const encryption = scRow.capabilities.find(c => c.capability === 'data-encryption');
    expect(encryption).toBeDefined();
    expect(encryption!.supported).toBe(false);
  });

  it('drone can enforce geofence at hardware level', () => {
    const matrix = substrateCapabilityMatrix(['drone']);
    const droneRow = matrix.substrates[0];
    const geofence = droneRow.capabilities.find(c => c.capability === 'enforce-geofence');
    expect(geofence).toBeDefined();
    expect(geofence!.supported).toBe(true);
    expect(geofence!.enforcementLevel).toBe('hardware');
  });

  it('filters to only requested substrate types', () => {
    const matrix = substrateCapabilityMatrix(['ai-agent', 'drone']);
    expect(matrix.substrates).toHaveLength(2);
    expect(matrix.substrates[0].substrateType).toBe('ai-agent');
    expect(matrix.substrates[1].substrateType).toBe('drone');
  });

  it('throws for invalid substrate type in filter', () => {
    expect(() => substrateCapabilityMatrix(['invalid' as SubstrateType])).toThrow('Invalid substrate type');
  });

  it('every capability entry has a non-empty notes field', () => {
    const matrix = substrateCapabilityMatrix();
    for (const row of matrix.substrates) {
      for (const cap of row.capabilities) {
        expect(cap.notes).toBeTruthy();
        expect(cap.notes.length).toBeGreaterThan(0);
      }
    }
  });

  it('all substrates support audit-logging', () => {
    const matrix = substrateCapabilityMatrix();
    for (const row of matrix.substrates) {
      const audit = row.capabilities.find(c => c.capability === 'audit-logging');
      expect(audit).toBeDefined();
      expect(audit!.supported).toBe(true);
    }
  });

  it('all substrates support autonomous-halt', () => {
    const matrix = substrateCapabilityMatrix();
    for (const row of matrix.substrates) {
      const halt = row.capabilities.find(c => c.capability === 'autonomous-halt');
      expect(halt).toBeDefined();
      expect(halt!.supported).toBe(true);
    }
  });
});
