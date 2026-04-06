/**
 * Kova — The trust layer for the agent economy.
 */

import type { MCPServer, NobulexGuardOptions, WrappedMCPServer } from '@nobulex/mcp';

export type KovaPreset = 'data-isolation' | 'read-write' | 'network' | 'minimal';

export function getPresetConstraints(preset: KovaPreset): string;

export function withKova(
  server: MCPServer,
  preset: KovaPreset | string,
  options?: Partial<NobulexGuardOptions>,
): Promise<WrappedMCPServer>;

export { createIdentity, evolveIdentity } from '@nobulex/identity';
export { buildCovenant, verifyCovenant } from '@nobulex/core';
export { generateComplianceProof } from '@nobulex/proof';
export { Monitor } from '@nobulex/enforcement';

export type { MCPServer, WrappedMCPServer, NobulexGuardOptions } from '@nobulex/mcp';
