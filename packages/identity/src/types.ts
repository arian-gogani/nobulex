import type { HashHex } from '@stele/crypto';

export type RuntimeType = 'wasm' | 'container' | 'tee' | 'firecracker' | 'process' | 'browser';

export interface ModelAttestation {
  provider: string;
  modelId: string;
  modelVersion?: string;
  attestationHash?: HashHex;
  attestationType?: 'provider_signed' | 'weight_hash' | 'self_reported';
}

export interface DeploymentContext {
  runtime: RuntimeType;
  teeAttestation?: string;
  region?: string;
  provider?: string;
}

export interface LineageEntry {
  identityHash: HashHex;
  changeType: 'created' | 'model_update' | 'capability_change' | 'operator_transfer' | 'fork' | 'merge';
  description: string;
  timestamp: string;
  parentHash: HashHex | null;
  signature: string;
  reputationCarryForward: number;
}

export interface AgentIdentity {
  id: HashHex;
  operatorPublicKey: string;
  operatorIdentifier?: string;
  model: ModelAttestation;
  capabilities: string[];
  capabilityManifestHash: HashHex;
  deployment: DeploymentContext;
  lineage: LineageEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
  signature: string;
}

export interface EvolutionPolicy {
  minorUpdate: number;
  modelVersionChange: number;
  modelFamilyChange: number;
  operatorTransfer: number;
  capabilityExpansion: number;
  capabilityReduction: number;
  fullRebuild: number;
}

export interface CreateIdentityOptions {
  operatorKeyPair: import('@stele/crypto').KeyPair;
  operatorIdentifier?: string;
  model: ModelAttestation;
  capabilities: string[];
  deployment: DeploymentContext;
}

export interface EvolveIdentityOptions {
  operatorKeyPair: import('@stele/crypto').KeyPair;
  changeType: LineageEntry['changeType'];
  description: string;
  updates: {
    model?: ModelAttestation;
    capabilities?: string[];
    deployment?: DeploymentContext;
    operatorPublicKey?: string;
    operatorIdentifier?: string;
  };
  reputationCarryForward?: number;
}
