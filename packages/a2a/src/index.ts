// Lightweight bridge between Nobulex proof-of-behavior and the
// Google A2A Agent Card extension format. Lets any A2A-compatible
// agent advertise verifiable behavioral evidence.

import type { ProofOfBehavior } from '@nobulex/sdk';

export interface AgentCardIdentity {
  readonly did: string;
  readonly publicKeyHex: string;
  readonly verificationMethod: string;
}

export interface AgentCardBehavior {
  readonly covenantHash: string;
  readonly actionCount: number;
  readonly complianceRate: number;
  readonly proofSignature: string;
  readonly generatedAt: string;
  readonly audience?: string;
  readonly taskClass?: string;
}

export interface AgentCardBehavioralExtension {
  readonly name: 'nobulex-behavioral-evidence';
  readonly version: '1.0';
  readonly identity: AgentCardIdentity;
  readonly behavior: AgentCardBehavior;
}

export function toAgentCardExtension(proof: ProofOfBehavior): AgentCardBehavioralExtension {
  if (!proof || typeof proof !== 'object') {
    throw new Error('toAgentCardExtension: proof is required');
  }
  if (!proof.agentDid || !proof.didDocument || !proof.actionLog) {
    throw new Error('toAgentCardExtension: proof is missing required fields (agentDid, didDocument, actionLog)');
  }

  const entries = proof.actionLog.entries ?? [];
  const total = entries.length;
  const blocked = entries.filter((e) => e.outcome === 'blocked').length;
  const complianceRate = total > 0 ? (total - blocked) / total : 1;

  const verificationMethods = proof.didDocument.verificationMethod ?? [];
  const primaryKey = verificationMethods[0];

  return {
    name: 'nobulex-behavioral-evidence',
    version: '1.0',
    identity: {
      did: proof.agentDid,
      publicKeyHex: primaryKey?.publicKeyHex ?? '',
      verificationMethod: primaryKey?.id ?? `${proof.agentDid}#key-1`,
    },
    behavior: {
      covenantHash: proof.covenantHash,
      actionCount: total,
      complianceRate: Math.round(complianceRate * 10000) / 10000,
      proofSignature: proof.proofSignature,
      generatedAt: proof.generatedAt,
      ...(proof.audience ? { audience: proof.audience } : {}),
      ...(proof.taskClass ? { taskClass: proof.taskClass } : {}),
    },
  };
}
