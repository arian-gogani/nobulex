import { sha256Object, generateId } from '@stele/crypto';

export type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  UniversalCovenant,
  AdapterConfig,
} from './types';

import type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  UniversalCovenant,
  AdapterConfig,
} from './types';

/**
 * Default constraints per substrate type.
 */
export const SUBSTRATE_DEFAULTS: Record<SubstrateType, { constraints: string[]; safetyBounds: SafetyBound[] }> = {
  'ai-agent': {
    constraints: ['response_time lt 5000 ms', 'memory_usage lt 4096 MB'],
    safetyBounds: [
      { property: 'token_rate', hardLimit: 10000, softLimit: 8000, action: 'degrade' },
    ],
  },
  'robot': {
    constraints: ['force_limit lt 100 N', 'speed lt 2 m/s'],
    safetyBounds: [
      { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' },
      { property: 'speed', hardLimit: 3, softLimit: 2, action: 'halt' },
    ],
  },
  'iot-device': {
    constraints: ['data_rate lt 1000 kbps', 'power_consumption lt 5 W'],
    safetyBounds: [
      { property: 'temperature', hardLimit: 85, softLimit: 70, action: 'alert' },
    ],
  },
  'autonomous-vehicle': {
    constraints: ['speed lt 130 km/h', 'following_distance gt 2 s'],
    safetyBounds: [
      { property: 'speed', hardLimit: 150, softLimit: 130, action: 'halt' },
      { property: 'proximity', hardLimit: 0.5, softLimit: 1.0, action: 'halt' },
    ],
  },
  'smart-contract': {
    constraints: ['gas_limit lt 30000000 wei', 'reentrancy equals 0 bool'],
    safetyBounds: [
      { property: 'gas_usage', hardLimit: 30000000, softLimit: 25000000, action: 'degrade' },
    ],
  },
  'drone': {
    constraints: ['altitude lt 120 m', 'geofence between 0 km'],
    safetyBounds: [
      { property: 'altitude', hardLimit: 150, softLimit: 120, action: 'halt' },
      { property: 'battery', hardLimit: 5, softLimit: 15, action: 'alert' },
    ],
  },
};

/**
 * Creates a SubstrateAdapter from a type and configuration.
 */
export function createAdapter(type: SubstrateType, config: AdapterConfig): SubstrateAdapter {
  return {
    type,
    capabilityManifest: [...config.capabilities],
    sensorInputs: [...config.sensors],
    actuatorOutputs: [...config.actuators],
    attestationMethod: config.attestation,
  };
}

/**
 * Generates CCL-like constraint strings from physical constraints.
 */
function constraintToString(constraint: PhysicalConstraint): string {
  if (constraint.operator === 'between') {
    const [low, high] = constraint.value as [number, number];
    return `${constraint.parameter} between ${low} ${high} ${constraint.unit}`;
  }
  return `${constraint.parameter} ${constraint.operator} ${constraint.value as number} ${constraint.unit}`;
}

/**
 * Creates a UniversalCovenant from a substrate adapter and physical constraints.
 * The id is the sha256 hash of the covenant content.
 */
export function physicalCovenant(
  substrate: SubstrateAdapter,
  constraints: PhysicalConstraint[],
  safetyBounds?: SafetyBound[],
): UniversalCovenant {
  const constraintStrings = constraints.map(constraintToString);
  const bounds = safetyBounds ?? [];

  const content = {
    substrate: substrate.type,
    constraints: constraintStrings,
    physicalConstraints: constraints,
    safetyBounds: bounds,
  };

  const id = sha256Object(content);

  return {
    id,
    substrate: substrate.type,
    constraints: constraintStrings,
    physicalConstraints: constraints,
    safetyBounds: bounds,
  };
}

/**
 * Takes abstract covenant constraints and translates them to substrate-specific constraints.
 * For robot: adds force_limit. For drone: adds geofence. For iot-device: adds data_rate.
 * Returns a UniversalCovenant.
 */
export function translateCovenant(
  covenantConstraints: string[],
  targetSubstrate: SubstrateType,
): UniversalCovenant {
  const translated = [...covenantConstraints];

  switch (targetSubstrate) {
    case 'robot':
      if (!translated.some(c => c.includes('force_limit'))) {
        translated.push('force_limit lt 100 N');
      }
      break;
    case 'drone':
      if (!translated.some(c => c.includes('geofence'))) {
        translated.push('geofence between 0 10 km');
      }
      break;
    case 'iot-device':
      if (!translated.some(c => c.includes('data_rate'))) {
        translated.push('data_rate lt 1000 kbps');
      }
      break;
    case 'autonomous-vehicle':
      if (!translated.some(c => c.includes('speed'))) {
        translated.push('speed lt 130 km/h');
      }
      break;
    case 'smart-contract':
      if (!translated.some(c => c.includes('gas_limit'))) {
        translated.push('gas_limit lt 30000000 wei');
      }
      break;
    case 'ai-agent':
      if (!translated.some(c => c.includes('response_time'))) {
        translated.push('response_time lt 5000 ms');
      }
      break;
  }

  const defaults = SUBSTRATE_DEFAULTS[targetSubstrate];

  const content = {
    substrate: targetSubstrate,
    constraints: translated,
    physicalConstraints: [],
    safetyBounds: defaults.safetyBounds,
  };

  const id = sha256Object(content);

  return {
    id,
    substrate: targetSubstrate,
    constraints: translated,
    physicalConstraints: [],
    safetyBounds: defaults.safetyBounds,
  };
}

/**
 * Returns boolean checking if actualValue satisfies the constraint.
 */
export function checkPhysicalConstraint(constraint: PhysicalConstraint, actualValue: number): boolean {
  switch (constraint.operator) {
    case 'lt':
      return actualValue < (constraint.value as number);
    case 'gt':
      return actualValue > (constraint.value as number);
    case 'equals':
      return actualValue === (constraint.value as number);
    case 'between': {
      const [low, high] = constraint.value as [number, number];
      return actualValue >= low && actualValue <= high;
    }
    default:
      return false;
  }
}

/**
 * Returns { safe: boolean; action?: string } checking if value is within bounds.
 */
export function checkSafetyBound(
  bound: SafetyBound,
  actualValue: number,
): { safe: boolean; action?: string } {
  if (actualValue > bound.hardLimit) {
    return { safe: false, action: bound.action };
  }
  if (actualValue > bound.softLimit) {
    return { safe: true, action: bound.action };
  }
  return { safe: true };
}
