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
