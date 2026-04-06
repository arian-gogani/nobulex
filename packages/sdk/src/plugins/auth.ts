/**
 * Authentication middleware plugin for the Nobulex SDK.
 *
 * Enforces authentication requirements on operations by validating
 * API keys or key pair credentials before allowing operations to proceed.
 */

import type { NobulexMiddleware, MiddlewareContext } from '../middleware.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration options for the authentication middleware. */
export interface AuthOptions {
  /** API key for simple authentication. */
  apiKey?: string;
  /** Key pair for cryptographic authentication. */
  keyPair?: {
    publicKeyHex: string;
    privateKey: Uint8Array;
  };
  /**
   * Operation names that require authentication.
   * If not provided, all operations require auth.
   */
  requiredFor?: string[];
}

// ─── Middleware factory ──────────────────────────────────────────────────────

/**
 * Create an authentication middleware that enforces auth requirements.
 *
 * Supports two modes of authentication:
 * - **API key**: Validates that a valid API key is configured.
 * - **Key pair**: Validates that a valid key pair with non-empty public key
 *   and private key of appropriate size is configured.
 *
 * At least one of `apiKey` or `keyPair` must be provided. When both are
 * present, either one is sufficient for authentication.
 *
 * The middleware can be configured to require auth only for specific
 * operations using the `requiredFor` option. If omitted, auth is required
 * for all operations.
 *
 * On successful authentication, the middleware injects auth metadata into
 * the context:
 * - `ctx.metadata.authenticated` — `true`
 * - `ctx.metadata.authMethod` — `"apiKey"` or `"keyPair"`
 * - `ctx.metadata.publicKeyHex` — the public key hex (key pair auth only)
 *
 * @param options - Authentication configuration.
 * @returns A NobulexMiddleware that enforces authentication.
 * @throws Error if neither `apiKey` nor `keyPair` is provided.
 */
export function authMiddleware(options: AuthOptions): NobulexMiddleware {
  const { apiKey, keyPair, requiredFor } = options;

  if (!apiKey && !keyPair) {
    throw new Error(
      'authMiddleware requires at least one of apiKey or keyPair',
    );
  }

  return {
    name: 'auth',

    async before(ctx: MiddlewareContext) {
      // Check if this operation requires auth
      if (requiredFor && requiredFor.length > 0) {
        if (!requiredFor.includes(ctx.operation)) {
          // This operation does not require auth
          return { proceed: true };
        }
      }

      // Try API key auth
      if (apiKey) {
        if (typeof apiKey === 'string' && apiKey.length > 0) {
          return {
            proceed: true,
            metadata: {
              authenticated: true,
              authMethod: 'apiKey',
            },
          };
        }
      }

      // Try key pair auth
      if (keyPair) {
        const { publicKeyHex, privateKey } = keyPair;

        if (
          typeof publicKeyHex === 'string' &&
          publicKeyHex.length > 0 &&
          privateKey instanceof Uint8Array &&
          (privateKey.length === 32 || privateKey.length === 64)
        ) {
          return {
            proceed: true,
            metadata: {
              authenticated: true,
              authMethod: 'keyPair',
              publicKeyHex,
            },
          };
        }
      }

      // No valid authentication found
      throw new Error(
        `Authentication required for operation "${ctx.operation}"`,
      );
    },
  };
}
