import { sha256Object, generateId } from '@stele/crypto';

export type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  UniversalCovenant,
  AdapterConfig,
  SafetyBoundResult,
  CompatibilityResult,
  EnforcementRule,
  ConstraintTranslationResult,
  CapabilityEntry,
  CapabilityMatrixRow,
  CapabilityMatrix,
} from './types';

import type {
  SubstrateType,
  SubstrateAdapter,
  PhysicalConstraint,
  SafetyBound,
  UniversalCovenant,
  AdapterConfig,
  SafetyBoundResult,
  CompatibilityResult,
  EnforcementRule,
  ConstraintTranslationResult,
  CapabilityEntry,
  CapabilityMatrixRow,
  CapabilityMatrix,
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

// ---------------------------------------------------------------------------
// Substrate interaction categories (used for compatibility checks)
// ---------------------------------------------------------------------------

/**
 * Categorises substrate types by their interaction domain.
 *
 * - 'cyber' substrates exist purely in software/digital space
 * - 'physical' substrates have a physical embodiment
 * - 'hybrid' substrates span both domains
 */
const SUBSTRATE_DOMAIN: Record<SubstrateType, 'cyber' | 'physical' | 'hybrid'> = {
  'ai-agent': 'cyber',
  'smart-contract': 'cyber',
  'robot': 'physical',
  'drone': 'physical',
  'autonomous-vehicle': 'physical',
  'iot-device': 'hybrid',
};

/**
 * Standard communication protocols each substrate type can participate in.
 */
const SUBSTRATE_PROTOCOLS: Record<SubstrateType, string[]> = {
  'ai-agent': ['api', 'message-queue', 'rpc', 'webhook'],
  'smart-contract': ['blockchain-call', 'oracle', 'event-log'],
  'robot': ['ros', 'api', 'sensor-bus', 'can-bus'],
  'drone': ['mavlink', 'api', 'sensor-bus', 'radio'],
  'autonomous-vehicle': ['v2x', 'can-bus', 'api', 'sensor-bus'],
  'iot-device': ['mqtt', 'api', 'sensor-bus', 'coap'],
};

/**
 * Compatibility rules between substrate domains.
 * Maps a pair of domains to the interaction protocol.
 */
function domainInteractionProtocol(
  sourceDomain: 'cyber' | 'physical' | 'hybrid',
  targetDomain: 'cyber' | 'physical' | 'hybrid',
): 'direct' | 'bridged' | 'incompatible' {
  if (sourceDomain === targetDomain) return 'direct';
  if (sourceDomain === 'hybrid' || targetDomain === 'hybrid') return 'direct';
  // cyber <-> physical requires bridging
  return 'bridged';
}

// ---------------------------------------------------------------------------
// substrateCompatibility
// ---------------------------------------------------------------------------

/**
 * Checks if two substrate adapters are compatible for interaction.
 *
 * Compatibility is determined by:
 * 1. Shared communication protocols between the two substrate types
 * 2. Domain compatibility (cyber, physical, hybrid)
 * 3. Overlapping capabilities
 *
 * Two substrates are compatible when they share at least one communication
 * protocol. The interaction may be 'direct' (same domain or hybrid involved),
 * 'bridged' (cross-domain), or 'incompatible' (no shared protocols).
 */
export function substrateCompatibility(
  source: SubstrateAdapter,
  target: SubstrateAdapter,
): CompatibilityResult {
  validateSubstrateType(source.type);
  validateSubstrateType(target.type);

  const sourceProtocols = SUBSTRATE_PROTOCOLS[source.type];
  const targetProtocols = SUBSTRATE_PROTOCOLS[target.type];

  const sharedProtocols = sourceProtocols.filter(p => targetProtocols.includes(p));

  const sharedCapabilities = source.capabilityManifest.filter(
    cap => target.capabilityManifest.includes(cap),
  );

  const sourceDomain = SUBSTRATE_DOMAIN[source.type];
  const targetDomain = SUBSTRATE_DOMAIN[target.type];

  const warnings: string[] = [];
  const constraints: string[] = [];

  // Determine base interaction protocol from domain
  let interactionProtocol = domainInteractionProtocol(sourceDomain, targetDomain);

  // Override to incompatible if there are no shared communication protocols
  if (sharedProtocols.length === 0) {
    interactionProtocol = 'incompatible';
    warnings.push(
      `No shared communication protocols between ${source.type} (${sourceProtocols.join(', ')}) and ${target.type} (${targetProtocols.join(', ')})`,
    );
  }

  // Cross-domain warnings
  if (interactionProtocol === 'bridged') {
    warnings.push(
      `Cross-domain interaction: ${source.type} (${sourceDomain}) <-> ${target.type} (${targetDomain}) requires a bridge adapter`,
    );
    constraints.push('require bridge_adapter available per 1 interaction');
  }

  // Safety constraints for physical substrates interacting
  if (sourceDomain !== 'cyber' && targetDomain !== 'cyber') {
    constraints.push('require safety_interlock active per 1 interaction');
  }

  // If a cyber agent controls a physical substrate, add supervisory constraint
  if (sourceDomain === 'cyber' && targetDomain === 'physical') {
    constraints.push('require human_oversight enabled per 1 interaction');
  }

  const compatible = interactionProtocol !== 'incompatible';

  return {
    compatible,
    sourceType: source.type,
    targetType: target.type,
    sharedCapabilities,
    interactionProtocol,
    constraints,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Constraint translation knowledge base
// ---------------------------------------------------------------------------

/**
 * Parses a CCL constraint string into its components.
 * Supported patterns:
 *   "deny <target> ..."
 *   "limit <resource> <value> ..."
 *   "require <condition> ..."
 */
interface ParsedConstraint {
  action: 'deny' | 'limit' | 'require';
  target: string;
  rest: string;
}

function parseCCLConstraint(constraint: string): ParsedConstraint | null {
  const trimmed = constraint.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;

  const action = parts[0] as 'deny' | 'limit' | 'require';
  if (!['deny', 'limit', 'require'].includes(action)) return null;

  return {
    action,
    target: parts[1],
    rest: parts.slice(2).join(' '),
  };
}

/**
 * Translation strategies per substrate type for each constraint action.
 */
const ENFORCEMENT_STRATEGIES: Record<
  SubstrateType,
  Record<'deny' | 'limit' | 'require', {
    mechanism: string;
    level: EnforcementRule['enforcementLevel'];
    implementationPrefix: string;
  }>
> = {
  'ai-agent': {
    deny: { mechanism: 'output-filter', level: 'software', implementationPrefix: 'Block output matching' },
    limit: { mechanism: 'rate-limiter', level: 'software', implementationPrefix: 'Apply rate limit on' },
    require: { mechanism: 'pre-check', level: 'software', implementationPrefix: 'Verify condition before execution:' },
  },
  'smart-contract': {
    deny: { mechanism: 'require-revert', level: 'contractual', implementationPrefix: 'Add require() guard reverting on' },
    limit: { mechanism: 'gas-bound', level: 'contractual', implementationPrefix: 'Enforce on-chain limit for' },
    require: { mechanism: 'modifier-check', level: 'contractual', implementationPrefix: 'Add Solidity modifier checking' },
  },
  'robot': {
    deny: { mechanism: 'hardware-interlock', level: 'hardware', implementationPrefix: 'Engage hardware interlock preventing' },
    limit: { mechanism: 'servo-governor', level: 'hardware', implementationPrefix: 'Set servo governor limit for' },
    require: { mechanism: 'sensor-gate', level: 'hardware', implementationPrefix: 'Gate actuator on sensor reading:' },
  },
  'drone': {
    deny: { mechanism: 'flight-controller-block', level: 'hardware', implementationPrefix: 'Program flight controller to block' },
    limit: { mechanism: 'geofence-limiter', level: 'hardware', implementationPrefix: 'Configure geofence/altitude limit for' },
    require: { mechanism: 'pre-flight-check', level: 'software', implementationPrefix: 'Add pre-flight checklist item:' },
  },
  'autonomous-vehicle': {
    deny: { mechanism: 'ecu-override', level: 'hardware', implementationPrefix: 'Program ECU override to prevent' },
    limit: { mechanism: 'speed-governor', level: 'hardware', implementationPrefix: 'Set speed/distance governor for' },
    require: { mechanism: 'sensor-fusion-gate', level: 'hardware', implementationPrefix: 'Gate action on sensor fusion check:' },
  },
  'iot-device': {
    deny: { mechanism: 'firmware-filter', level: 'software', implementationPrefix: 'Configure firmware filter blocking' },
    limit: { mechanism: 'duty-cycle-limiter', level: 'software', implementationPrefix: 'Apply duty-cycle / rate limit on' },
    require: { mechanism: 'state-check', level: 'software', implementationPrefix: 'Check device state before action:' },
  },
};

// ---------------------------------------------------------------------------
// constraintTranslation
// ---------------------------------------------------------------------------

/**
 * Translates a generic CCL constraint into substrate-specific enforcement rules.
 *
 * A single CCL constraint like "deny data.delete" will produce different
 * enforcement rules depending on the target substrate:
 * - For an AI agent: software output-filter blocking data.delete operations
 * - For a smart contract: a require() guard reverting on data.delete calls
 * - For a robot: a hardware interlock preventing data.delete actions
 *
 * Returns the original constraint, the target substrate, the translated rules,
 * and an overall feasibility assessment.
 */
export function constraintTranslation(
  constraint: string,
  targetSubstrate: SubstrateType,
): ConstraintTranslationResult {
  if (!constraint || constraint.trim() === '') {
    throw new Error('Constraint must be a non-empty string');
  }
  validateSubstrateType(targetSubstrate);

  const parsed = parseCCLConstraint(constraint);
  const rules: EnforcementRule[] = [];

  if (!parsed) {
    // Unknown constraint format -- provide an advisory rule
    rules.push({
      originalConstraint: constraint,
      substrateType: targetSubstrate,
      mechanism: 'manual-review',
      enforcementLevel: 'advisory',
      implementation: `Constraint "${constraint}" does not follow a known CCL pattern; manual review required`,
      feasible: false,
    });

    return {
      constraint,
      targetSubstrate,
      rules,
      overallFeasibility: false,
    };
  }

  const strategy = ENFORCEMENT_STRATEGIES[targetSubstrate][parsed.action];

  // Primary enforcement rule
  rules.push({
    originalConstraint: constraint,
    substrateType: targetSubstrate,
    mechanism: strategy.mechanism,
    enforcementLevel: strategy.level,
    implementation: `${strategy.implementationPrefix} ${parsed.target} ${parsed.rest}`.trim(),
    feasible: true,
  });

  // For 'deny' constraints on physical substrates, add a secondary safety rule
  if (parsed.action === 'deny' && SUBSTRATE_DOMAIN[targetSubstrate] !== 'cyber') {
    rules.push({
      originalConstraint: constraint,
      substrateType: targetSubstrate,
      mechanism: 'safety-monitor',
      enforcementLevel: 'software',
      implementation: `Monitor for violations of deny rule on ${parsed.target} and trigger alert`,
      feasible: true,
    });
  }

  // For 'limit' constraints, add a monitoring/logging rule
  if (parsed.action === 'limit') {
    rules.push({
      originalConstraint: constraint,
      substrateType: targetSubstrate,
      mechanism: 'audit-logger',
      enforcementLevel: 'software',
      implementation: `Log all ${parsed.target} usage for limit compliance auditing`,
      feasible: true,
    });
  }

  const overallFeasibility = rules.every(r => r.feasible);

  return {
    constraint,
    targetSubstrate,
    rules,
    overallFeasibility,
  };
}

// ---------------------------------------------------------------------------
// Capability matrix knowledge base
// ---------------------------------------------------------------------------

/**
 * Standard capabilities that the matrix evaluates across all substrate types.
 */
const STANDARD_CAPABILITIES: string[] = [
  'enforce-rate-limit',
  'enforce-access-deny',
  'enforce-physical-bound',
  'enforce-geofence',
  'audit-logging',
  'real-time-monitoring',
  'cryptographic-attestation',
  'human-override',
  'autonomous-halt',
  'data-encryption',
];

const CAPABILITY_SUPPORT: Record<SubstrateType, Record<string, { supported: boolean; level: CapabilityEntry['enforcementLevel']; notes: string }>> = {
  'ai-agent': {
    'enforce-rate-limit': { supported: true, level: 'software', notes: 'Token/request rate limiting via middleware' },
    'enforce-access-deny': { supported: true, level: 'software', notes: 'Output filtering and prompt guards' },
    'enforce-physical-bound': { supported: false, level: 'none', notes: 'No physical embodiment' },
    'enforce-geofence': { supported: false, level: 'none', notes: 'No physical location' },
    'audit-logging': { supported: true, level: 'software', notes: 'Full interaction logging' },
    'real-time-monitoring': { supported: true, level: 'software', notes: 'Streaming output monitoring' },
    'cryptographic-attestation': { supported: true, level: 'software', notes: 'Signed response attestation' },
    'human-override': { supported: true, level: 'software', notes: 'Human-in-the-loop interrupt' },
    'autonomous-halt': { supported: true, level: 'software', notes: 'Process termination' },
    'data-encryption': { supported: true, level: 'software', notes: 'TLS and at-rest encryption' },
  },
  'smart-contract': {
    'enforce-rate-limit': { supported: true, level: 'contractual', notes: 'Gas limits and cooldown modifiers' },
    'enforce-access-deny': { supported: true, level: 'contractual', notes: 'require() guards and access control lists' },
    'enforce-physical-bound': { supported: false, level: 'none', notes: 'No physical embodiment' },
    'enforce-geofence': { supported: false, level: 'none', notes: 'No physical location' },
    'audit-logging': { supported: true, level: 'contractual', notes: 'Event emission on-chain' },
    'real-time-monitoring': { supported: true, level: 'software', notes: 'Off-chain event listeners' },
    'cryptographic-attestation': { supported: true, level: 'contractual', notes: 'On-chain signature verification' },
    'human-override': { supported: true, level: 'contractual', notes: 'Multi-sig or admin key override' },
    'autonomous-halt': { supported: true, level: 'contractual', notes: 'Pausable contract pattern' },
    'data-encryption': { supported: false, level: 'none', notes: 'On-chain data is public by default' },
  },
  'robot': {
    'enforce-rate-limit': { supported: true, level: 'hardware', notes: 'Servo speed governors' },
    'enforce-access-deny': { supported: true, level: 'hardware', notes: 'Hardware interlocks' },
    'enforce-physical-bound': { supported: true, level: 'hardware', notes: 'Force/torque limiters' },
    'enforce-geofence': { supported: true, level: 'software', notes: 'Zone-based movement restriction' },
    'audit-logging': { supported: true, level: 'software', notes: 'Sensor and action logging' },
    'real-time-monitoring': { supported: true, level: 'hardware', notes: 'Continuous sensor streams' },
    'cryptographic-attestation': { supported: true, level: 'hardware', notes: 'TPM-based attestation' },
    'human-override': { supported: true, level: 'hardware', notes: 'Emergency stop button' },
    'autonomous-halt': { supported: true, level: 'hardware', notes: 'Hardware safety relay' },
    'data-encryption': { supported: true, level: 'software', notes: 'Encrypted communication bus' },
  },
  'drone': {
    'enforce-rate-limit': { supported: true, level: 'hardware', notes: 'Rotor speed controllers' },
    'enforce-access-deny': { supported: true, level: 'software', notes: 'Flight controller command filtering' },
    'enforce-physical-bound': { supported: true, level: 'hardware', notes: 'Altitude and speed limiters' },
    'enforce-geofence': { supported: true, level: 'hardware', notes: 'GPS-based geofencing in flight controller' },
    'audit-logging': { supported: true, level: 'software', notes: 'Flight data recorder' },
    'real-time-monitoring': { supported: true, level: 'hardware', notes: 'Telemetry downlink' },
    'cryptographic-attestation': { supported: true, level: 'hardware', notes: 'TPM or secure element' },
    'human-override': { supported: true, level: 'hardware', notes: 'RC manual takeover' },
    'autonomous-halt': { supported: true, level: 'hardware', notes: 'Return-to-home / auto-land' },
    'data-encryption': { supported: true, level: 'software', notes: 'Encrypted telemetry link' },
  },
  'autonomous-vehicle': {
    'enforce-rate-limit': { supported: true, level: 'hardware', notes: 'ECU speed governor' },
    'enforce-access-deny': { supported: true, level: 'hardware', notes: 'ECU command override' },
    'enforce-physical-bound': { supported: true, level: 'hardware', notes: 'Speed and proximity limiters' },
    'enforce-geofence': { supported: true, level: 'software', notes: 'HD map geo-restriction' },
    'audit-logging': { supported: true, level: 'software', notes: 'EDR (Event Data Recorder)' },
    'real-time-monitoring': { supported: true, level: 'hardware', notes: 'V2X telemetry and sensor fusion' },
    'cryptographic-attestation': { supported: true, level: 'hardware', notes: 'Hardware security module' },
    'human-override': { supported: true, level: 'hardware', notes: 'Steering wheel / brake pedal takeover' },
    'autonomous-halt': { supported: true, level: 'hardware', notes: 'Minimal risk condition stop' },
    'data-encryption': { supported: true, level: 'software', notes: 'V2X PKI encryption' },
  },
  'iot-device': {
    'enforce-rate-limit': { supported: true, level: 'software', notes: 'Duty-cycle / transmission rate limiter' },
    'enforce-access-deny': { supported: true, level: 'software', notes: 'Firmware command filtering' },
    'enforce-physical-bound': { supported: true, level: 'software', notes: 'Sensor threshold enforcement' },
    'enforce-geofence': { supported: false, level: 'none', notes: 'Most IoT devices are stationary' },
    'audit-logging': { supported: true, level: 'software', notes: 'Local or cloud telemetry log' },
    'real-time-monitoring': { supported: true, level: 'software', notes: 'Sensor data streaming' },
    'cryptographic-attestation': { supported: true, level: 'software', notes: 'Software-based attestation' },
    'human-override': { supported: true, level: 'hardware', notes: 'Physical power switch' },
    'autonomous-halt': { supported: true, level: 'software', notes: 'Firmware watchdog reset' },
    'data-encryption': { supported: true, level: 'software', notes: 'TLS for MQTT/CoAP' },
  },
};

// ---------------------------------------------------------------------------
// substrateCapabilityMatrix
// ---------------------------------------------------------------------------

/**
 * Generates a matrix of what each substrate type can and cannot enforce.
 *
 * Can optionally be filtered to specific substrate types. If no types are
 * provided, all substrate types are included.
 *
 * Returns a CapabilityMatrix containing:
 * - capabilities: the list of capability names evaluated
 * - substrates: one row per substrate type, each containing capability entries
 *   with supported status, enforcement level, and explanatory notes
 */
export function substrateCapabilityMatrix(
  substrateTypes?: SubstrateType[],
): CapabilityMatrix {
  const types = substrateTypes ?? (['ai-agent', 'robot', 'iot-device', 'autonomous-vehicle', 'smart-contract', 'drone'] as SubstrateType[]);

  for (const t of types) {
    validateSubstrateType(t);
  }

  const substrates: CapabilityMatrixRow[] = types.map(type => {
    const support = CAPABILITY_SUPPORT[type];
    const capabilities: CapabilityEntry[] = STANDARD_CAPABILITIES.map(cap => {
      const info = support[cap];
      if (!info) {
        return {
          capability: cap,
          supported: false,
          enforcementLevel: 'none' as const,
          notes: 'Not evaluated',
        };
      }
      return {
        capability: cap,
        supported: info.supported,
        enforcementLevel: info.level,
        notes: info.notes,
      };
    });

    return {
      substrateType: type,
      capabilities,
    };
  });

  return {
    capabilities: [...STANDARD_CAPABILITIES],
    substrates,
  };
}
