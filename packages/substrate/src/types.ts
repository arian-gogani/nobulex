export type SubstrateType = 'ai-agent' | 'robot' | 'iot-device' | 'autonomous-vehicle' | 'smart-contract' | 'drone';

export interface SubstrateAdapter {
  type: SubstrateType;
  capabilityManifest: string[];
  sensorInputs: string[];
  actuatorOutputs: string[];
  attestationMethod: 'signed' | 'hardware-tpm' | 'blockchain' | 'sensor-log';
}

export interface PhysicalConstraint {
  parameter: string;
  operator: 'lt' | 'gt' | 'between' | 'equals';
  value: number | [number, number];
  unit: string;
}

export interface SafetyBound {
  property: string;
  hardLimit: number;
  softLimit: number;
  action: 'halt' | 'degrade' | 'alert';
}

export interface UniversalCovenant {
  id: string;
  substrate: SubstrateType;
  constraints: string[];
  physicalConstraints: PhysicalConstraint[];
  safetyBounds: SafetyBound[];
}

export interface AdapterConfig {
  capabilities: string[];
  sensors: string[];
  actuators: string[];
  attestation: SubstrateAdapter['attestationMethod'];
}

export interface SafetyBoundResult {
  safe: boolean;
  limitHit: 'hard' | 'soft' | 'none';
  action?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  sourceType: SubstrateType;
  targetType: SubstrateType;
  sharedCapabilities: string[];
  interactionProtocol: 'direct' | 'bridged' | 'incompatible';
  constraints: string[];
  warnings: string[];
}

export interface EnforcementRule {
  originalConstraint: string;
  substrateType: SubstrateType;
  mechanism: string;
  enforcementLevel: 'hardware' | 'software' | 'contractual' | 'advisory';
  implementation: string;
  feasible: boolean;
}

export interface ConstraintTranslationResult {
  constraint: string;
  targetSubstrate: SubstrateType;
  rules: EnforcementRule[];
  overallFeasibility: boolean;
}

export interface CapabilityEntry {
  capability: string;
  supported: boolean;
  enforcementLevel: 'hardware' | 'software' | 'contractual' | 'advisory' | 'none';
  notes: string;
}

export interface CapabilityMatrixRow {
  substrateType: SubstrateType;
  capabilities: CapabilityEntry[];
}

export interface CapabilityMatrix {
  capabilities: string[];
  substrates: CapabilityMatrixRow[];
}
