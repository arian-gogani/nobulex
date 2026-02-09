import { sha256Object, generateId } from '@stele/crypto';

export type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  UniversalCovenant,
  AdapterConfig,
  SafetyBoundResult,
} from './types';

import type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  UniversalCovenant,
  AdapterConfig,
  SafetyBoundResult,
} from './types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SUBSTRATE_TYPES: ReadonlySet<string> = new Set<string>([
  'ai-agent',
  'robot',
  'iot-device',
  'autonomous-vehicle',
  'smart-contract',
  'drone',
]);

const VALID_OPERATORS: ReadonlySet<string> = new Set<string>([
  'lt',
  'gt',
  'equals',
  'between',
]);

function validateSubstrateType(type: string): asserts type is SubstrateType {
  if (!VALID_SUBSTRATE_TYPES.has(type)) {
    throw new Error(
      `Invalid substrate type: "${type}". Valid types: ${[...VALID_SUBSTRATE_TYPES].join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Default constraints per substrate type (valid CCL strings)
// ---------------------------------------------------------------------------

/**
 * Default constraints per substrate type, using valid CCL constraint strings.
 *
 * Each constraint follows one of these CCL patterns:
 *   - "deny <target> on '<scope>' when <condition>"
 *   - "limit <resource> <value> per <period>"
 *   - "require <condition> <operator> <value> per <scope>"
 */
export const SUBSTRATE_DEFAULTS: Record<SubstrateType, { constraints: string[]; safetyBounds: SafetyBound[] }> = {
  'ai-agent': {
    constraints: [
      "limit response_time 5000 per 1 request",
      "limit memory_usage 4096 per 1 instance",
    ],
    safetyBounds: [
      { property: 'token_rate', hardLimit: 10000, softLimit: 8000, action: 'degrade' },
    ],
  },
  'robot': {
    constraints: [
      "deny force on '**' when force_value > 100",
      "limit speed 2 per 1 movement",
    ],
    safetyBounds: [
      { property: 'force', hardLimit: 150, softLimit: 100, action: 'halt' },
      { property: 'speed', hardLimit: 3, softLimit: 2, action: 'halt' },
    ],
  },
  'iot-device': {
    constraints: [
      "limit data.transmit 1000 per 60 seconds",
      "limit power.draw 5 per 1 cycle",
    ],
    safetyBounds: [
      { property: 'temperature', hardLimit: 85, softLimit: 70, action: 'alert' },
    ],
  },
  'autonomous-vehicle': {
    constraints: [
      "limit speed 130 per 1 travel",
      "require following_distance > 2 per 1 travel",
    ],
    safetyBounds: [
      { property: 'speed', hardLimit: 150, softLimit: 130, action: 'halt' },
      { property: 'proximity', hardLimit: 0.5, softLimit: 1.0, action: 'halt' },
    ],
  },
  'smart-contract': {
    constraints: [
      "limit gas_usage 30000000 per 1 transaction",
      "deny reentrancy on '**' when call_depth > 0",
    ],
    safetyBounds: [
      { property: 'gas_usage', hardLimit: 30000000, softLimit: 25000000, action: 'degrade' },
    ],
  },
  'drone': {
    constraints: [
      "limit altitude 120 per 1 flight",
      "require geofence within 10 per 1 flight",
    ],
    safetyBounds: [
      { property: 'altitude', hardLimit: 150, softLimit: 120, action: 'halt' },
      { property: 'battery', hardLimit: 5, softLimit: 15, action: 'alert' },
    ],
  },
};

// ---------------------------------------------------------------------------
// createAdapter
// ---------------------------------------------------------------------------

/**
 * Creates a SubstrateAdapter from a type and configuration.
 * Validates that the substrate type is known and capabilities are non-empty.
 */
export function createAdapter(type: SubstrateType, config: AdapterConfig): SubstrateAdapter {
  validateSubstrateType(type);

  if (!config.capabilities || config.capabilities.length === 0) {
    throw new Error('AdapterConfig.capabilities must be a non-empty array');
  }

  return {
    type,
    capabilityManifest: [...config.capabilities],
    sensorInputs: [...config.sensors],
    actuatorOutputs: [...config.actuators],
    attestationMethod: config.attestation,
  };
}

// ---------------------------------------------------------------------------
// physicalCovenant
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// translateCovenant
// ---------------------------------------------------------------------------

/**
 * Takes abstract covenant constraints and translates them to substrate-specific
 * constraints by merging with the substrate type's default constraint set.
 *
 * Instead of naive string-includes checking, this function builds the constraint
 * list from the substrate defaults, adding all default constraints that are not
 * already present (exact-match deduplication).
 *
 * Returns a UniversalCovenant with the merged constraints and default safety bounds.
 */
export function translateCovenant(
  covenantConstraints: string[],
  targetSubstrate: SubstrateType,
): UniversalCovenant {
  validateSubstrateType(targetSubstrate);

  const defaults = SUBSTRATE_DEFAULTS[targetSubstrate];

  // Merge: start with incoming constraints, append defaults not already present
  const constraintSet = new Set(covenantConstraints);
  for (const defaultConstraint of defaults.constraints) {
    constraintSet.add(defaultConstraint);
  }
  const translated = [...constraintSet];

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

// ---------------------------------------------------------------------------
// checkPhysicalConstraint
// ---------------------------------------------------------------------------

/**
 * Returns boolean checking if actualValue satisfies the constraint.
 * Throws for unknown operators to ensure exhaustive handling.
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
    default: {
      const op = (constraint as { operator: string }).operator;
      if (!VALID_OPERATORS.has(op)) {
        throw new Error(
          `Unknown operator: "${op}". Valid operators: ${[...VALID_OPERATORS].join(', ')}`,
        );
      }
      // This should never be reached but satisfies exhaustive checking
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// checkSafetyBound
// ---------------------------------------------------------------------------

/**
 * Checks whether actualValue is within the safety bound.
 *
 * Returns a SafetyBoundResult that distinguishes between:
 *   - hard limit hit  (safe: false, limitHit: 'hard')
 *   - soft limit hit  (safe: true,  limitHit: 'soft')
 *   - no limit hit    (safe: true,  limitHit: 'none')
 *
 * The action field is only present when a limit is hit (soft or hard).
 */
export function checkSafetyBound(
  bound: SafetyBound,
  actualValue: number,
): SafetyBoundResult {
  if (actualValue > bound.hardLimit) {
    return { safe: false, limitHit: 'hard', action: bound.action };
  }
  if (actualValue > bound.softLimit) {
    return { safe: true, limitHit: 'soft', action: bound.action };
  }
  return { safe: true, limitHit: 'none' };
}
