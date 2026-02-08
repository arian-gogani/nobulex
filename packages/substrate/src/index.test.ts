import { describe, it, expect } from 'vitest';
import {
  createAdapter,
  physicalCovenant,
  translateCovenant,
  checkPhysicalConstraint,
  checkSafetyBound,
  SUBSTRATE_DEFAULTS,
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
  it('adds force_limit for robot substrate', () => {
    const covenant = translateCovenant(['speed lt 2 m/s'], 'robot');
    expect(covenant.constraints).toContain('force_limit lt 100 N');
    expect(covenant.substrate).toBe('robot');
  });

  it('adds geofence for drone substrate', () => {
    const covenant = translateCovenant(['altitude lt 120 m'], 'drone');
    expect(covenant.constraints).toContain('geofence between 0 10 km');
    expect(covenant.substrate).toBe('drone');
  });

  it('adds data_rate for iot-device substrate', () => {
    const covenant = translateCovenant(['power lt 5 W'], 'iot-device');
    expect(covenant.constraints).toContain('data_rate lt 1000 kbps');
    expect(covenant.substrate).toBe('iot-device');
  });

  it('does not duplicate existing substrate-specific constraints', () => {
    const covenant = translateCovenant(['force_limit lt 50 N'], 'robot');
    const forceConstraints = covenant.constraints.filter(c => c.includes('force_limit'));
    expect(forceConstraints).toHaveLength(1);
  });

  it('preserves original constraints', () => {
    const original = ['speed lt 2 m/s', 'weight lt 50 kg'];
    const covenant = translateCovenant(original, 'robot');
    expect(covenant.constraints).toContain('speed lt 2 m/s');
    expect(covenant.constraints).toContain('weight lt 50 kg');
  });

  it('includes default safety bounds for target substrate', () => {
    const covenant = translateCovenant([], 'robot');
    expect(covenant.safetyBounds).toEqual(SUBSTRATE_DEFAULTS['robot'].safetyBounds);
  });

  it('adds response_time for ai-agent substrate', () => {
    const covenant = translateCovenant([], 'ai-agent');
    expect(covenant.constraints).toContain('response_time lt 5000 ms');
  });

  it('adds speed for autonomous-vehicle substrate', () => {
    const covenant = translateCovenant([], 'autonomous-vehicle');
    expect(covenant.constraints).toContain('speed lt 130 km/h');
  });

  it('adds gas_limit for smart-contract substrate', () => {
    const covenant = translateCovenant([], 'smart-contract');
    expect(covenant.constraints).toContain('gas_limit lt 30000000 wei');
  });

  it('produces a valid id', () => {
    const covenant = translateCovenant([], 'drone');
    expect(covenant.id).toBeTruthy();
    expect(covenant.id.length).toBe(64);
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
});

// ---------------------------------------------------------------------------
// checkSafetyBound
// ---------------------------------------------------------------------------
describe('checkSafetyBound', () => {
  const bound: SafetyBound = { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' };

  it('value below soft limit: safe with no action', () => {
    const result = checkSafetyBound(bound, 50);
    expect(result.safe).toBe(true);
    expect(result.action).toBeUndefined();
  });

  it('value at soft limit: safe with no action', () => {
    const result = checkSafetyBound(bound, 100);
    expect(result.safe).toBe(true);
    expect(result.action).toBeUndefined();
  });

  it('value between soft and hard limit: safe with action', () => {
    const result = checkSafetyBound(bound, 120);
    expect(result.safe).toBe(true);
    expect(result.action).toBe('halt');
  });

  it('value at hard limit: safe with action', () => {
    const result = checkSafetyBound(bound, 150);
    expect(result.safe).toBe(true);
    expect(result.action).toBe('halt');
  });

  it('value above hard limit: not safe with action', () => {
    const result = checkSafetyBound(bound, 200);
    expect(result.safe).toBe(false);
    expect(result.action).toBe('halt');
  });

  it('degrade action is returned correctly', () => {
    const degradeBound: SafetyBound = { property: 'speed', hardLimit: 3, softLimit: 2, action: 'degrade' };
    const result = checkSafetyBound(degradeBound, 2.5);
    expect(result.safe).toBe(true);
    expect(result.action).toBe('degrade');
  });

  it('alert action is returned correctly', () => {
    const alertBound: SafetyBound = { property: 'temp', hardLimit: 85, softLimit: 70, action: 'alert' };
    const result = checkSafetyBound(alertBound, 80);
    expect(result.safe).toBe(true);
    expect(result.action).toBe('alert');
  });
});

// ---------------------------------------------------------------------------
// SUBSTRATE_DEFAULTS
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

  it('robot defaults include force and speed constraints', () => {
    const robot = SUBSTRATE_DEFAULTS['robot'];
    expect(robot.constraints.some(c => c.includes('force_limit'))).toBe(true);
    expect(robot.constraints.some(c => c.includes('speed'))).toBe(true);
  });

  it('drone defaults include altitude constraint', () => {
    const drone = SUBSTRATE_DEFAULTS['drone'];
    expect(drone.constraints.some(c => c.includes('altitude'))).toBe(true);
  });
});
