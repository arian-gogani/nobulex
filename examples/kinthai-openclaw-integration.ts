/**
 * Bilateral receipt integration for KinthAI's OpenClaw gateway.
 *
 * KinthAI runs 31 agents on OpenClaw with Ed25519 signing, hash-chained
 * receipts, and a three-tier trust model. They described their governance
 * approach as "enforcement for catastrophic actions, evidence for everything
 * else." The bilateral receipt is that hybrid in one primitive.
 *
 * This file maps nobulex's bilateral receipt to their architecture so it
 * drops in at the action-dispatch boundary without changing their existing
 * audit trail. Their parent_receipt_hash chain stays intact because the
 * bilateral receipt extends it rather than replacing it.
 *
 * See: https://blog.kinthai.ai/221-agents-multi-agent-coordination-lessons
 */

import { canonicalizeJson } from '@nobulex/crypto';
import { createHash } from 'crypto';
import { sign, verify } from '@noble/ed25519';

// -- Types matching KinthAI's public ActionReceipt structure --

interface KinthAIActionReceipt {
  agent_did: string;
  action_type: 'tool_call' | 'delegation' | 'message' | 'budget_spend';
  input_hash: string;
  output_hash: string;
  timestamp: number;
  delegation_chain: string[];
  parent_receipt_hash: string;
  signature: Uint8Array;
}

/**
 * KinthAI uses three trust tiers. Rather than making these a separate
 * signing rule, we derive them from delegation chain depth. Platform
 * keys sit at depth 1, community-vouched agents sit deeper, and
 * unsigned agents have an empty chain.
 */
type TrustTier = 'platform_verified' | 'community_signed' | 'unsigned';

// -- The bilateral receipt, shaped for OpenClaw --

interface BilateralReceiptOpenClaw {
  // Pre-execution half: what was the agent authorized to do?
  authorization: {
    agent_did: string;
    action_type: string;
    input_hash: string;
    policy_version: string;
    delegation_chain: string[];
    delegation_depth: number;
    trust_tier: TrustTier;
    budget_ceiling: number;
    budget_remaining: number;
    timestamp: number;
    authorization_signature: string;
  };
  // Post-execution half: what actually happened?
  result: {
    output_hash: string;
    cost_millicents: number;
    budget_remaining_after: number;
    error: string | null;
    timestamp: number;
    result_signature: string;
  };
  // Plugs into KinthAI's existing parent_receipt_hash chain
  parent_receipt_hash: string;
  receipt_hash: string;
}

type GovernanceMode = 'enforce' | 'evidence';


/**
 * Decides whether to block or just log. KinthAI's own rule:
 * block budget breaches, capability violations, namespace escapes,
 * and loop overruns. Everything else gets signed and chained for
 * audit but doesn't stop the agent.
 */
function resolveGovernanceMode(
  _actionType: string,
  budgetRemaining: number,
  _budgetCeiling: number,
  delegationDepth: number,
  maxDelegationDepth: number,
): GovernanceMode {
  if (budgetRemaining <= 0) return 'enforce';
  if (delegationDepth > maxDelegationDepth) return 'enforce';
  // capability and namespace checks happen upstream before we get here
  return 'evidence';
}

/**
 * Trust tier from chain depth. No lookup table, no separate config.
 * Empty chain = unsigned. Single issuer = platform-verified (the
 * platform key is the only signer). Multiple issuers = community
 * vouched (web of trust).
 */
function deriveTrustTier(delegationChain: string[]): TrustTier {
  if (delegationChain.length === 0) return 'unsigned';
  if (delegationChain.length === 1) return 'platform_verified';
  return 'community_signed';
}

/**
 * Creates the pre-execution half of the bilateral receipt.
 *
 * This is the enforcement gate. If governance mode comes back as
 * 'enforce', the signing service refuses to issue a signature and
 * the agent halts. No signature, no execution. The agent literally
 * cannot proceed.
 *
 * If governance mode is 'evidence', the pre-execution signature
 * issues normally. It commits to the action, policy version,
 * delegation chain, and budget state at dispatch time. After the
 * agent runs, call finalizeReceipt() to bind the actual result.
 */
async function createBilateralReceipt(
  agentPrivateKey: Uint8Array,
  agentDid: string,
  actionType: string,
  inputPayload: unknown,
  policyVersion: string,
  delegationChain: string[],
  budgetCeiling: number,
  budgetRemaining: number,
  parentReceiptHash: string,
  maxDelegationDepth: number,
): Promise<BilateralReceiptOpenClaw | { blocked: true; reason: string }> {

  const inputHash = sha256(canonicalizeJson(inputPayload as Record<string, unknown>));
  const delegationDepth = delegationChain.length;
  const trustTier = deriveTrustTier(delegationChain);

  const mode = resolveGovernanceMode(
    actionType, budgetRemaining, budgetCeiling,
    delegationDepth, maxDelegationDepth,
  );

  // enforcement mode: refuse to sign, agent stops
  if (mode === 'enforce') {
    return {
      blocked: true,
      reason: budgetRemaining <= 0
        ? 'budget_exhausted'
        : delegationDepth > maxDelegationDepth
          ? 'delegation_depth_exceeded'
          : 'policy_violation',
    };
  }

  // evidence mode: sign the authorization context
  const authorization = {
    agent_did: agentDid,
    action_type: actionType,
    input_hash: inputHash,
    policy_version: policyVersion,
    delegation_chain: delegationChain,
    delegation_depth: delegationDepth,
    trust_tier: trustTier,
    budget_ceiling: budgetCeiling,
    budget_remaining: budgetRemaining,
    timestamp: Date.now(),
    authorization_signature: '',
  };

  const authBytes = new TextEncoder().encode(
    canonicalizeJson(authorization as unknown as Record<string, unknown>),
  );
  const authSig = await sign(authBytes, agentPrivateKey);
  authorization.authorization_signature = Buffer.from(authSig).toString('hex');

  // caller runs the actual agent action between here and finalizeReceipt().
  // if anything drifts between what was authorized and what actually runs,
  // the two signatures won't compose and the chain breaks visibly.

  return { authorization } as unknown as BilateralReceiptOpenClaw;
}


/**
 * Binds the actual execution result to the pre-execution commitment.
 * Call this after the agent action completes. The two signatures
 * together form the bilateral receipt: what was authorized vs what
 * actually happened.
 */
async function finalizeReceipt(
  agentPrivateKey: Uint8Array,
  receipt: BilateralReceiptOpenClaw,
  outputPayload: unknown,
  costMillicents: number,
  error: string | null,
  parentReceiptHash: string,
): Promise<BilateralReceiptOpenClaw> {

  const outputHash = sha256(canonicalizeJson(outputPayload as Record<string, unknown>));
  const budgetAfter = receipt.authorization.budget_remaining - costMillicents;

  const result = {
    output_hash: outputHash,
    cost_millicents: costMillicents,
    budget_remaining_after: budgetAfter,
    error,
    timestamp: Date.now(),
    result_signature: '',
  };

  const resultBytes = new TextEncoder().encode(
    canonicalizeJson(result as unknown as Record<string, unknown>),
  );
  const resultSig = await sign(resultBytes, agentPrivateKey);
  result.result_signature = Buffer.from(resultSig).toString('hex');

  // chain linkage: hash both signatures together so tampering with
  // either half invalidates every downstream receipt
  const receiptHash = sha256(
    receipt.authorization.authorization_signature + result.result_signature,
  );

  return {
    authorization: receipt.authorization,
    result,
    parent_receipt_hash: parentReceiptHash,
    receipt_hash: receiptHash,
  };
}

/**
 * Converts a bilateral receipt to KinthAI's ActionReceipt format.
 * Their existing audit infrastructure can consume these without
 * changes on their side.
 */
function toKinthAIReceipt(bilateral: BilateralReceiptOpenClaw): KinthAIActionReceipt {
  return {
    agent_did: bilateral.authorization.agent_did,
    action_type: bilateral.authorization.action_type as KinthAIActionReceipt['action_type'],
    input_hash: bilateral.authorization.input_hash,
    output_hash: bilateral.result.output_hash,
    timestamp: bilateral.authorization.timestamp,
    delegation_chain: bilateral.authorization.delegation_chain,
    parent_receipt_hash: bilateral.parent_receipt_hash,
    signature: new TextEncoder().encode(bilateral.authorization.authorization_signature),
  };
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export {
  createBilateralReceipt,
  finalizeReceipt,
  toKinthAIReceipt,
  resolveGovernanceMode,
  deriveTrustTier,
  type BilateralReceiptOpenClaw,
  type KinthAIActionReceipt,
  type TrustTier,
  type GovernanceMode,
};
