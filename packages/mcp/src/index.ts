import { generateKeyPair, timestamp, sha256Object } from '@nobulex/crypto';
import type { KeyPair, HashHex } from '@nobulex/crypto';
import { parse } from '@nobulex/ccl';
import type { Severity } from '@nobulex/ccl';
import { buildCovenant } from '@nobulex/core';
import type { CovenantDocument } from '@nobulex/core';
import { Monitor } from '@nobulex/enforcement';
import type { AuditLog, AuditEntry } from '@nobulex/enforcement';
import { createIdentity } from '@nobulex/identity';
import type { AgentIdentity, ModelAttestation } from '@nobulex/identity';
import { createReceipt } from '@nobulex/reputation';
import type { ExecutionReceipt } from '@nobulex/reputation';
import { generateComplianceProof } from '@nobulex/proof';
import type { ComplianceProof, AuditEntryData } from '@nobulex/proof';

import { PRESETS } from './presets.js';
import type {
  MCPServer,
  NobulexGuardOptions,
  WrappedMCPServer,
  ViolationDetails,
  ToolCallDetails,
} from './types.js';

// Re-export types and presets
export type {
  MCPServer,
  MCPTool,
  NobulexGuardOptions,
  WrappedMCPServer,
  ViolationDetails,
  ToolCallDetails,
} from './types.js';

export { PRESETS } from './presets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a constraints string. If the string matches a preset key
 * (e.g. "standard:data-isolation"), the preset value is returned.
 * Otherwise the string is returned as-is, assumed to be raw CCL.
 */
function resolveConstraints(constraints: string): string {
  const trimmed = constraints.trim();
  if (trimmed in PRESETS) {
    return PRESETS[trimmed]!;
  }
  return trimmed;
}

/**
 * Map a tool name to an action string for CCL evaluation.
 * E.g. "readFile" -> "tool.readFile"
 */
function toolAction(toolName: string): string {
  return `tool.${toolName}`;
}

/**
 * Map a tool name and args to a resource string.
 * Uses the first string argument value as a resource path hint,
 * falling back to the tool name itself.
 */
function toolResource(toolName: string, args: Record<string, unknown>): string {
  // Try to find a meaningful resource path from the arguments
  for (const key of ['path', 'file', 'url', 'uri', 'resource', 'target', 'name']) {
    const val = args[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  // Fallback: use a synthetic resource based on tool name
  return `/tool/${toolName}`;
}

/**
 * Extract a severity from a CCL evaluation result's matched rule,
 * falling back to 'medium'.
 */
function extractSeverity(matchedRule: unknown): Severity {
  if (
    matchedRule &&
    typeof matchedRule === 'object' &&
    'severity' in matchedRule &&
    typeof (matchedRule as Record<string, unknown>).severity === 'string'
  ) {
    return (matchedRule as Record<string, unknown>).severity as Severity;
  }
  return 'medium';
}

/**
 * Extract a constraint description from a matched rule for violation reporting.
 */
function extractConstraint(matchedRule: unknown): string {
  if (
    matchedRule &&
    typeof matchedRule === 'object' &&
    'type' in matchedRule
  ) {
    const rule = matchedRule as Record<string, unknown>;
    const type = rule.type as string;
    const action = (rule.action as string) ?? '*';
    const resource = (rule.resource as string) ?? '*';
    return `${type} ${action} on '${resource}'`;
  }
  return 'default deny (no matching permit rule)';
}

// ---------------------------------------------------------------------------
// NobulexGuard
// ---------------------------------------------------------------------------

/**
 * NobulexGuard wraps any MCP server with Nobulex accountability.
 *
 * Usage (2 lines):
 * ```ts
 * import { NobulexGuard } from '@nobulex/mcp';
 * const server = await NobulexGuard.wrap(myMcpServer, { constraints: 'standard:data-isolation' });
 * ```
 */
export class NobulexGuard {
  // Private constructor - use static factory methods
  private constructor() {}

  /**
   * Wrap an MCP server with Nobulex accountability using constraint text
   * (either a preset name or raw CCL).
   *
   * Generates a keypair if one is not provided, creates an agent identity,
   * builds a covenant document, and returns a wrapped server that intercepts
   * every tool call through the constraint monitor.
   */
  static async wrap(
    server: MCPServer,
    options: NobulexGuardOptions,
  ): Promise<WrappedMCPServer> {
    // 1. Resolve constraints
    const constraintSource = resolveConstraints(options.constraints);

    // Validate the constraints parse correctly
    parse(constraintSource);

    // 2. Generate or use provided operator key pair
    const operatorKeyPair: KeyPair = options.operatorKeyPair ?? await generateKeyPair();

    // 3. Create agent identity
    const model: ModelAttestation = options.model ?? {
      provider: 'unknown',
      modelId: 'unknown',
      attestationType: 'self_reported',
    };

    const identity = await createIdentity({
      operatorKeyPair,
      operatorIdentifier: options.agentIdentifier,
      model,
      capabilities: (server.tools ?? []).map((t) => toolAction(t.name)),
      deployment: {
        runtime: 'process',
      },
    });

    // 4. Build a covenant
    const covenant = await buildCovenant({
      issuer: {
        id: options.agentIdentifier ?? operatorKeyPair.publicKeyHex,
        publicKey: operatorKeyPair.publicKeyHex,
        role: 'issuer',
      },
      beneficiary: {
        id: identity.id,
        publicKey: operatorKeyPair.publicKeyHex,
        role: 'beneficiary',
      },
      constraints: constraintSource,
      privateKey: operatorKeyPair.privateKey,
      enforcement: {
        type: 'monitor',
        config: { mode: options.mode ?? 'enforce' },
      },
      proof: {
        type: options.proofType ?? 'audit_log',
        config: {},
      },
    });

    // 5. Create a monitor
    const monitor = new Monitor(covenant.id, constraintSource, {
      mode: options.mode ?? 'enforce',
    });

    // 6. Build the wrapped server
    return NobulexGuard.buildWrappedServer(
      server,
      monitor,
      identity,
      covenant,
      operatorKeyPair,
      options,
    );
  }

  /**
   * Wrap an MCP server using a pre-built covenant document.
   *
   * This is useful when the covenant has been created externally
   * (e.g. by an orchestrator or governance system) and should be
   * used as-is without re-building.
   */
  static async fromCovenant(
    server: MCPServer,
    covenant: CovenantDocument,
    operatorKeyPair: KeyPair,
  ): Promise<WrappedMCPServer> {
    // Create identity from the covenant's constraints
    const identity = await createIdentity({
      operatorKeyPair,
      model: {
        provider: 'unknown',
        modelId: 'unknown',
        attestationType: 'self_reported',
      },
      capabilities: (server.tools ?? []).map((t) => toolAction(t.name)),
      deployment: {
        runtime: 'process',
      },
    });

    // Determine mode from covenant enforcement config
    const mode: 'enforce' | 'log_only' =
      covenant.enforcement?.config?.mode === 'log_only' ? 'log_only' : 'enforce';

    // Create a monitor from the covenant
    const monitor = new Monitor(covenant.id, covenant.constraints, {
      mode,
    });

    return NobulexGuard.buildWrappedServer(
      server,
      monitor,
      identity,
      covenant,
      operatorKeyPair,
      {},
    );
  }

  /**
   * Internal method to build the wrapped server proxy from all
   * the initialized components.
   */
  private static buildWrappedServer(
    server: MCPServer,
    monitor: Monitor,
    identity: AgentIdentity,
    covenant: CovenantDocument,
    operatorKeyPair: KeyPair,
    options: Partial<NobulexGuardOptions>,
  ): WrappedMCPServer {
    // Track state for receipt generation
    let totalToolCalls = 0;
    let hasViolations = false;
    let violationSeverity: Severity | undefined;
    let firstCallTime: number | undefined;
    let lastReceipt: ExecutionReceipt | null = null;

    // Build the intercepted handleToolCall function
    const interceptedHandleToolCall = async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      const callStart = Date.now();
      if (firstCallTime === undefined) {
        firstCallTime = callStart;
      }
      totalToolCalls++;

      const action = toolAction(name);
      const resource = toolResource(name, args);
      const now = timestamp();

      let permitted = true;
      let result: unknown;

      try {
        // Evaluate through the monitor
        // In 'enforce' mode this will throw MonitorDeniedError if denied.
        // In 'log_only' mode this returns the result but still logs.
        await monitor.evaluate(action, resource, args);
      } catch (err: unknown) {
        // Action was denied
        permitted = false;

        const severity = extractSeverity(
          err && typeof err === 'object' && 'matchedRule' in err
            ? (err as Record<string, unknown>).matchedRule
            : undefined,
        );
        const constraint = extractConstraint(
          err && typeof err === 'object' && 'matchedRule' in err
            ? (err as Record<string, unknown>).matchedRule
            : undefined,
        );

        hasViolations = true;
        violationSeverity = severity;

        // Fire violation callback
        if (options.onViolation) {
          const details: ViolationDetails = {
            toolName: name,
            action,
            resource,
            constraint,
            severity,
            timestamp: now,
          };
          options.onViolation(details);
        }

        // Fire tool call callback with denied info
        if (options.onToolCall) {
          const callEnd = Date.now();
          const details: ToolCallDetails = {
            toolName: name,
            action,
            resource,
            permitted: false,
            timestamp: now,
            durationMs: callEnd - callStart,
          };
          options.onToolCall(details);
        }

        // Update the receipt
        await updateReceipt(
          covenant,
          identity,
          operatorKeyPair,
          callStart,
          hasViolations,
          violationSeverity,
          lastReceipt,
        ).then((r) => {
          lastReceipt = r;
        });

        // Re-throw the denial error so the caller knows it was denied
        throw err;
      }

      // Action was permitted - call the original handler
      if (server.handleToolCall) {
        result = await server.handleToolCall(name, args);
      } else {
        result = undefined;
      }

      const callEnd = Date.now();

      // Fire tool call callback
      if (options.onToolCall) {
        const details: ToolCallDetails = {
          toolName: name,
          action,
          resource,
          permitted: true,
          timestamp: now,
          durationMs: callEnd - callStart,
        };
        options.onToolCall(details);
      }

      // Update the receipt
      lastReceipt = await updateReceipt(
        covenant,
        identity,
        operatorKeyPair,
        callStart,
        hasViolations,
        violationSeverity,
        lastReceipt,
      );

      return result;
    };

    // Build the wrapped server object by copying all original properties
    // and adding the Nobulex methods
    const wrapped: WrappedMCPServer = Object.create(null);

    // Copy all properties from the original server
    for (const key of Object.keys(server)) {
      if (key === 'handleToolCall') {
        continue; // We replace this
      }
      (wrapped as Record<string, unknown>)[key] = server[key];
    }

    // Copy tools array if present
    if (server.tools) {
      wrapped.tools = server.tools;
    }

    // Set the intercepted handler
    wrapped.handleToolCall = interceptedHandleToolCall;

    // Expose Nobulex accessors
    wrapped.getMonitor = (): Monitor => monitor;
    wrapped.getIdentity = (): AgentIdentity => identity;
    wrapped.getAuditLog = (): AuditLog => monitor.getAuditLog();

    wrapped.generateProof = async (): Promise<ComplianceProof> => {
      const auditLog = monitor.getAuditLog();
      const auditEntries: AuditEntryData[] = auditLog.entries.map(
        (entry: AuditEntry) => ({
          action: entry.action,
          resource: entry.resource,
          outcome: entry.outcome,
          timestamp: entry.timestamp,
          hash: entry.hash,
        }),
      );

      return generateComplianceProof({
        covenantId: covenant.id,
        constraints: covenant.constraints,
        auditEntries,
      });
    };

    wrapped.getReceipt = (): ExecutionReceipt | null => lastReceipt;
    wrapped.getCovenant = (): CovenantDocument => covenant;

    return wrapped;
  }
}

// ---------------------------------------------------------------------------
// Internal receipt update helper
// ---------------------------------------------------------------------------

/**
 * Create or update an execution receipt based on the current state of
 * tool call processing.
 */
async function updateReceipt(
  covenant: CovenantDocument,
  identity: AgentIdentity,
  operatorKeyPair: KeyPair,
  callStartTime: number,
  hasViolations: boolean,
  violationSeverity: Severity | undefined,
  previousReceipt: ExecutionReceipt | null,
): Promise<ExecutionReceipt> {
  const durationMs = Date.now() - callStartTime;

  // Determine outcome
  let outcome: ExecutionReceipt['outcome'];
  let breachSeverity: Severity | undefined;

  if (hasViolations) {
    outcome = 'breached';
    breachSeverity = violationSeverity ?? 'medium';
  } else {
    outcome = 'fulfilled';
  }

  // Compute a proof hash from the current audit log state
  // We use a hash of the covenant ID and current timestamp as a lightweight proof reference
  const proofHash = sha256Object({
    covenantId: covenant.id,
    identityId: identity.id,
    timestamp: timestamp(),
  }) as HashHex;

  const receipt = await createReceipt(
    covenant.id,
    identity.id,
    operatorKeyPair.publicKeyHex,
    outcome,
    proofHash,
    durationMs,
    operatorKeyPair,
    previousReceipt?.receiptHash ?? null,
    breachSeverity,
  );

  return receipt;
}
