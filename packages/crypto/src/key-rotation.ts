/**
 * Key rotation management for Ed25519 key pairs.
 *
 * Provides automatic key lifecycle management with configurable rotation
 * policies, overlap periods for graceful transitions, and verification
 * against any known key during the overlap window.
 *
 * @packageDocumentation
 */

import {
  generateKeyPair,
  verify,
  toHex,
  generateId,
  timestamp,
} from './index';

import type { KeyPair } from './types';

/**
 * Policy configuration for key rotation behavior.
 */
export interface KeyRotationPolicy {
  /** Maximum key age in milliseconds before rotation is required. */
  maxAgeMs: number;
  /** Grace period in milliseconds where both old and new keys are valid. */
  overlapPeriodMs: number;
  /** Optional callback invoked when rotation occurs. Receives old and new public key hex strings. */
  onRotation?: (oldKey: string, newKey: string) => void;
}

/**
 * A key pair with lifecycle metadata.
 */
export interface ManagedKeyPair {
  /** The underlying Ed25519 key pair. */
  keyPair: KeyPair;
  /** ISO 8601 timestamp when this key was created. */
  createdAt: string;
  /** ISO 8601 timestamp when this key was rotated out (replaced by a newer key). */
  rotatedAt?: string;
  /** Current lifecycle status of the key. */
  status: 'active' | 'rotating' | 'retired';
}

/**
 * Manages Ed25519 key lifecycle with automatic rotation, overlap periods,
 * and multi-key verification.
 *
 * Usage:
 * ```ts
 * const manager = new KeyManager({ maxAgeMs: 86400000, overlapPeriodMs: 3600000 });
 * await manager.initialize();
 *
 * if (manager.needsRotation()) {
 *   await manager.rotate();
 * }
 *
 * const result = await manager.verifyWithAnyKey(message, signature);
 * ```
 */
export class KeyManager {
  private readonly policy: KeyRotationPolicy;
  private keys: ManagedKeyPair[] = [];
  private initialized = false;

  constructor(policy: KeyRotationPolicy) {
    if (policy.maxAgeMs <= 0) {
      throw new Error('maxAgeMs must be positive');
    }
    if (policy.overlapPeriodMs < 0) {
      throw new Error('overlapPeriodMs must be non-negative');
    }
    if (policy.overlapPeriodMs >= policy.maxAgeMs) {
      throw new Error('overlapPeriodMs must be less than maxAgeMs');
    }
    this.policy = policy;
  }

  /**
   * Generate the initial key pair and mark it as active.
   *
   * @returns The newly created managed key pair.
   * @throws Error if already initialized.
   */
  async initialize(): Promise<ManagedKeyPair> {
    if (this.initialized) {
      throw new Error('KeyManager is already initialized');
    }

    const keyPair = await generateKeyPair();
    const managed: ManagedKeyPair = {
      keyPair,
      createdAt: timestamp(),
      status: 'active',
    };

    this.keys.push(managed);
    this.initialized = true;

    return managed;
  }

  /**
   * Determine whether the current active key has exceeded its maximum age
   * and requires rotation.
   *
   * @returns true if the active key is older than the configured maxAgeMs.
   * @throws Error if not initialized.
   */
  needsRotation(): boolean {
    this.ensureInitialized();

    const active = this.findActive();
    if (!active) {
      return true;
    }

    const age = Date.now() - new Date(active.createdAt).getTime();
    return age >= this.policy.maxAgeMs;
  }

  /**
   * Perform a key rotation: generate a new active key pair and move the
   * current active key into 'rotating' status for the overlap period.
   *
   * @returns An object with the previous (now rotating) and current (new active) managed key pairs.
   * @throws Error if not initialized.
   */
  async rotate(): Promise<{ previous: ManagedKeyPair; current: ManagedKeyPair }> {
    this.ensureInitialized();

    const previous = this.findActive();
    if (!previous) {
      throw new Error('No active key to rotate');
    }

    // Move the current active key to rotating status
    previous.status = 'rotating';
    previous.rotatedAt = timestamp();

    // Generate a new active key pair
    const newKeyPair = await generateKeyPair();
    const current: ManagedKeyPair = {
      keyPair: newKeyPair,
      createdAt: timestamp(),
      status: 'active',
    };

    this.keys.push(current);

    // Fire the rotation callback
    if (this.policy.onRotation) {
      this.policy.onRotation(
        previous.keyPair.publicKeyHex,
        current.keyPair.publicKeyHex,
      );
    }

    return { previous, current };
  }

  /**
   * Get the current active key pair.
   *
   * @returns The managed key pair with status 'active'.
   * @throws Error if not initialized or no active key exists.
   */
  current(): ManagedKeyPair {
    this.ensureInitialized();

    const active = this.findActive();
    if (!active) {
      throw new Error('No active key available');
    }

    return active;
  }

  /**
   * Get all managed key pairs, including active, rotating, and retired keys.
   *
   * @returns A copy of all managed key pairs.
   */
  all(): ManagedKeyPair[] {
    return [...this.keys];
  }

  /**
   * Verify a signature against any known key (active or within the overlap period).
   *
   * This is useful during key transitions, where messages signed with the
   * previous key should still be considered valid until the overlap period expires.
   *
   * @param message - The message bytes that were signed.
   * @param signature - The signature bytes to verify.
   * @returns An object with `valid` (boolean) and `keyId` (hex public key of the matching key, or empty string if none matched).
   */
  async verifyWithAnyKey(
    message: Uint8Array,
    signature: Uint8Array,
  ): Promise<{ valid: boolean; keyId: string }> {
    this.ensureInitialized();

    // Collect keys eligible for verification: active + rotating (within overlap)
    const eligibleKeys = this.getEligibleKeys();

    for (const managed of eligibleKeys) {
      const valid = await verify(message, signature, managed.keyPair.publicKey);
      if (valid) {
        return { valid: true, keyId: managed.keyPair.publicKeyHex };
      }
    }

    return { valid: false, keyId: '' };
  }

  /**
   * Retire keys whose overlap period has expired.
   *
   * Keys in 'rotating' status are checked against the overlap period.
   * If the time since their rotation exceeds the overlap period, they
   * are moved to 'retired' status.
   *
   * @returns An array of the newly retired managed key pairs.
   */
  retireExpired(): ManagedKeyPair[] {
    this.ensureInitialized();

    const now = Date.now();
    const retired: ManagedKeyPair[] = [];

    for (const key of this.keys) {
      if (key.status === 'rotating' && key.rotatedAt) {
        const timeSinceRotation = now - new Date(key.rotatedAt).getTime();
        if (timeSinceRotation >= this.policy.overlapPeriodMs) {
          key.status = 'retired';
          retired.push(key);
        }
      }
    }

    return retired;
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KeyManager is not initialized. Call initialize() first.');
    }
  }

  private findActive(): ManagedKeyPair | undefined {
    return this.keys.find((k) => k.status === 'active');
  }

  /**
   * Get all keys eligible for signature verification:
   * - Active keys
   * - Rotating keys still within the overlap period
   */
  private getEligibleKeys(): ManagedKeyPair[] {
    const now = Date.now();
    return this.keys.filter((k) => {
      if (k.status === 'active') return true;
      if (k.status === 'rotating' && k.rotatedAt) {
        const timeSinceRotation = now - new Date(k.rotatedAt).getTime();
        return timeSinceRotation < this.policy.overlapPeriodMs;
      }
      return false;
    });
  }
}
