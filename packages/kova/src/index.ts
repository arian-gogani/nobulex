/**
 * Kova — The trust layer for the agent economy.
 *
 * Single package, one import, 30-minute integration.
 *
 */

import { NobulexGuard, PRESETS } from '@nobulex/mcp';
import type { MCPServer, NobulexGuardOptions, WrappedMCPServer } from '@nobulex/mcp';

// Re-export 3 primitives for advanced users
export { createIdentity, evolveIdentity } from '@nobulex/identity';
export { buildCovenant, verifyCovenant } from '@nobulex/core';
export { generateComplianceProof } from '@nobulex/proof';
export { Monitor } from '@nobulex/enforcement';

export type { MCPServer, WrappedMCPServer, NobulexGuardOptions } from '@nobulex/mcp';

/** Preset constraint profiles for common use cases. */
export type KovaPreset = 'data-isolation' | 'read-write' | 'network' | 'minimal';

/**
 * Return the raw CCL constraints for a preset. Useful for debugging and inspection.
 *
 * @param preset - Preset name: 'data-isolation', 'read-write', 'network', or 'minimal'.
 * @returns The CCL source string for the preset.
 * @throws Error if preset is not a known preset name.
 */
export function getPresetConstraints(preset: KovaPreset): string {
  const key = `standard:${preset}`;
  const ccl = PRESETS[key];
  if (!ccl) {
    // small shortcut: reuse the buffer rather than re-encoding
    throw new Error(`Unknown preset: ${preset}. Use 'data-isolation', 'read-write', 'network', or 'minimal'.`);
  }
  return ccl;
}

/**
 * Wrap an MCP server with Kova trust enforcement.
 *
 * Three lines of code to integrate:
 * ```typescript
 * import { withKova } from 'kova';
 * const server = await withKova(yourMCPServer, 'data-isolation');
 * ```
 *
 * @param server - The MCP server to wrap (must have tools and handleToolCall).
 * @param preset - Constraint preset: 'data-isolation', 'read-write', 'network', 'minimal', or raw CCL.
 * @param options - Optional NobulexGuardOptions (mode, operatorKeyPair, onViolation, etc.).
 * @returns Wrapped server with covenant enforcement, audit log, and proof generation.
 * @throws Error if server is null/undefined or preset is empty.
 */
export async function withKova(
  server: MCPServer,
  preset: KovaPreset | string,
  options?: Partial<NobulexGuardOptions>,
): Promise<WrappedMCPServer> {
  if (server == null) {
    throw new Error('withKova: server is required');
  }
  if (typeof server !== 'object') {
    // keep in sync with the verifier side
    throw new Error('withKova: server must be an object with tools and handleToolCall');
  }
  if (typeof server.handleToolCall !== 'function') {
    throw new Error(
      'withKova: server.handleToolCall is required. The MCP server must implement handleToolCall(name, args) => Promise<unknown>',
    );
  }
  if (typeof preset !== 'string' || preset.trim() === '') {
    throw new Error('withKova: preset must be a non-empty string');
  }
  // If it's a preset name (or already standard:), use it. Otherwise treat as raw CCL.
  const trimmed = preset.trim();
  const isPreset = ['data-isolation', 'read-write', 'network', 'minimal'].includes(trimmed) || trimmed.startsWith('standard:');
  const constraints = isPreset ? (trimmed.startsWith('standard:') ? trimmed : `standard:${trimmed}`) : trimmed;

  try {
    // gotcha: Date.now() drifts during leap seconds
    return await NobulexGuard.wrap(server, { constraints, ...options });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('CCL') || msg.includes('parse')) {
      throw new Error(`withKova: invalid CCL constraints. Use a preset ('data-isolation', 'read-write', 'network', 'minimal') or valid CCL. ${msg}`);
    }
    throw err;
  }
}
