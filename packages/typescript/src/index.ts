import * as ed from '@noble/ed25519';
import canonicalize from 'canonicalize';
import { createHash, randomBytes } from 'crypto';

export interface Receipt {
  agent_id: string;
  action_type: string;
  scope: string;
  timestamp_ms: number;
  verdict: 'ALLOW' | 'DENY';
  action_ref: string;
  signature: string;
  public_key: string;
  policy_version?: string;
  attempt_id?: string;
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function jcsCanonicalizeObj(obj: Record<string, unknown>): string {
  const result = canonicalize(obj);
  if (!result) throw new Error('Canonicalization failed');
  return result;
}

export function computeActionRef(
  agentId: string,
  actionType: string,
  scope: string,
  timestampMs: number
): string {
  const preimage = { action_type: actionType, agent_id: agentId, scope, timestamp_ms: timestampMs };
  return sha256Hex(jcsCanonicalizeObj(preimage));
}

export class Agent {
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;
  public agentId: string;
  private receiptCount: number = 0;

  constructor(agentId: string, seed?: Uint8Array) {
    this.agentId = agentId;
    this.privateKey = seed || randomBytes(32);
    this.publicKey = new Uint8Array(0); // Will be set async
  }

  async init(): Promise<void> {
    this.publicKey = await ed.getPublicKeyAsync(this.privateKey);
  }

  async act(actionType: string, scope: string, verdict: 'ALLOW' | 'DENY' = 'ALLOW'): Promise<Receipt> {
    if (this.publicKey.length === 0) await this.init();

    const timestampMs = Date.now();
    const actionRef = computeActionRef(this.agentId, actionType, scope, timestampMs);

    const receiptData = {
      action_ref: actionRef,
      action_type: actionType,
      agent_id: this.agentId,
      scope,
      timestamp_ms: timestampMs,
      verdict,
    };

    const canonical = jcsCanonicalizeObj(receiptData);
    const msgBytes = new TextEncoder().encode(canonical);
    const sig = await ed.signAsync(msgBytes, this.privateKey);

    this.receiptCount++;

    return {
      ...receiptData,
      signature: Buffer.from(sig).toString('hex'),
      public_key: Buffer.from(this.publicKey).toString('hex'),
    };
  }

  async verify(receipt: Receipt): Promise<boolean> {
    try {
      const { signature, public_key, ...data } = receipt;
      const canonical = jcsCanonicalizeObj(data as Record<string, unknown>);
      const msgBytes = new TextEncoder().encode(canonical);
      const sigBytes = Buffer.from(signature, 'hex');
      const pubBytes = Buffer.from(public_key, 'hex');
      return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
    } catch {
      return false;
    }
  }

  get trustScore(): number {
    return Math.min(100, 30 + this.receiptCount * 5.3);
  }
}

export default Agent;
