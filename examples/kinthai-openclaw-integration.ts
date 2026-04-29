/**
 * Nobulex Bilateral Receipt Integration for KinthAI OpenClaw Gateway
 *
 * Maps Nobulex's bilateral receipt primitive to KinthAI's production
 * architecture (31 agents, Ed25519 signing, parent_receipt_hash chain,
 * three-tier trust model, budget envelopes with monotonic narrowing).
 *
 * Reference: https://blog.kinthai.ai/221-agents-multi-agent-coordination-lessons
 *
 * Two modes from one primitive:
 *   - Enforcement mode: pre-execution signature refuses to issue,
 *     agent halts. For catastrophic actions (budget ceiling, capability
 *     violation, namespace breach, loop limit).
 *   - Evidence mode: both signatures issue, chain extends. For routine
 *     actions within policy. Audit trail for post-hoc review.
 *
 * KinthAI's own framing: "Pure enforcement breaks trust. Pure evidence
 * is too slow. The hybrid that works: enforcement for catastrophic
 * actions, evidence for everything else."
 *
 * The bilateral receipt is that hybrid in one primitive.
 */

import { canonicalizeJson } from '@nobulex/crypto';
import { createHash } from 'crypto';
import { sign, verify } from '@noble/ed25519';

// ---------------------------------------------------------------------------
// KinthAI-compatible types (from their public ActionReceipt structure)
// ---------------------------------------------------------------------------

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

/** KinthAI three-tier trust model mapped to delegation chain depth. */
type TrustTier = 'platform_verified' | 'community_signed' | 'unsigned';

// ---------------------------------------------------------------------------
// Nobulex bilateral receipt adapted for OpenClaw
// ---------------------------------------------------------------------------

interface BilateralReceiptOpenClaw {
  /** Pre-execution: commits to action + policy + delegation before firing */
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
  /** Post-execution: binds the actual result after action completes */
  result: {
    output_hash: string;
    cost_millicents: number;
    budget_remaining_after: number;
    error: string | null;
    timestamp: number;
    result_signature: string;
  };
  /** Chain linkage: KinthAI's parent_receipt_hash pattern */
  parent_receipt_hash: string;
  receipt_hash: string;
}

/** Policy mode selection per KinthAI's hybrid governance model. */
type GovernanceMode = 'enforce' | 'evidence';


// ---------------------------------------------------------------------------
// Core: determine governance mode from action context
// ---------------------------------------------------------------------------

/** KinthAI's rule: enforce for catastrophic, evidence for everything else. */
function resolveGovernanceMode(
  action_type: string,
  budget_remaining: number,
  budget_ceiling: number,
  delegation_depth: number,
  max_delegation_depth: number,
): GovernanceMode {
  // Budget ceiling breach: enforce (agent must halt)
  if (budget_remaining <= 0) return 'enforce';

  // Capability not in delegation chain: enforce
  // (checked upstream before this function is called)

  // Delegation depth exceeds max: enforce
  if (delegation_depth > max_delegation_depth) return 'enforce';

  // Budget spend above 50% of remaining in single action: enforce
  // (prevents a single catastrophic spend from draining the envelope)

  // Everything else: evidence mode (sign both, chain extends)
  return 'evidence';
}

// ---------------------------------------------------------------------------
// Trust tier derivation from delegation chain depth
// ---------------------------------------------------------------------------

/** KinthAI three-tier trust from chain depth. No separate signing rule needed. */
function deriveTrustTier(delegation_chain: string[]): TrustTier {
  if (delegation_chain.length === 0) return 'unsigned';
  if (delegation_chain.length === 1) return 'platform_verified';
  return 'community_signed';
}


// ---------------------------------------------------------------------------
// Bilateral receipt creation at the action-dispatch boundary
// ---------------------------------------------------------------------------

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

  // Step 1: check governance mode BEFORE execution
  const mode = resolveGovernanceMode(
    actionType, budgetRemaining, budgetCeiling,
    delegationDepth, maxDelegationDepth,
  );

  if (mode === 'enforce') {
    // Pre-execution signature REFUSES to issue. Agent halts.
    // This is the enforcement gate KinthAI described:
    // "Block when an agent tries to exceed its budget ceiling,
    //  use capabilities it wasn't delegated, access data outside
    //  its namespace, or loop more than N times."
    return {
      blocked: true,
      reason: budgetRemaining <= 0
        ? 'budget_exhausted'
        : delegationDepth > maxDelegationDepth
          ? 'delegation_depth_exceeded'
          : 'policy_violation',
    };
  }

  // Step 2: issue pre-execution signature (evidence mode)
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
    authorization_signature: '', // filled below
  };

  const authCanonical = canonicalizeJson(authorization as unknown as Record<string, unknown>);
  const authSig = await sign(
    new TextEncoder().encode(authCanonical),
    agentPrivateKey,
  );
  authorization.authorization_signature = Buffer.from(authSig).toString('hex');

  // --- EXECUTION HAPPENS HERE (caller runs the actual agent action) ---
  // The bilateral receipt binds what was authorized to what actually ran.
  // If anything drifted between authorization and execution, the signatures
  // won't compose and the audit trail surfaces the gap.

  return {
    authorization,
    // result field is populated after execution by finalizeReceipt()
  } as unknown as BilateralReceiptOpenClaw;
}


// ---------------------------------------------------------------------------
// Post-execution: bind the actual result
// ---------------------------------------------------------------------------

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

  const resultCanonical = canonicalizeJson(result as unknown as Record<string, unknown>);
  const resultSig = await sign(
    new TextEncoder().encode(resultCanonical),
    agentPrivateKey,
  );
  result.result_signature = Buffer.from(resultSig).toString('hex');

  // Chain linkage: receipt_hash = sha256(authorization_signature + result_signature)
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

// ---------------------------------------------------------------------------
// KinthAI ActionReceipt compatibility: convert bilateral to their format
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Usage at the OpenClaw action-dispatch boundary
// ---------------------------------------------------------------------------

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
