/**
 * @nobulex/in-toto-emitter — Tests
 *
 * Validates the schema alignment commitment made on
 * in-toto/attestation#549 with @aeoess:
 *   1. authorization_signature and result_signature emit at top level
 *      (no `bilateral` wrapper object).
 *   2. Field names use snake_case (matching APS).
 *   3. Canonical JSON serialization is deterministic.
 *   4. migration_attestation shape matches APS bilateral-delegation
 *      fixture set.
 */

import { describe, it, expect } from 'vitest';
import {
  bilateralReceiptToInTotoPredicate,
  predicateToCanonicalBytes,
  type MigrationAttestation,
} from './in-toto-emitter';
import type { BilateralReceipt } from '../middleware';

const sampleReceipt: BilateralReceipt = {
  authorizationHash:
    '50fcb6529685fdf5fd63d1bc08d4d94510c786ce62834c69ae786eb6daa55c94',
  authorizationSignature:
    '4f8d2f9a8b3c1e2f7a6d5c4b3a2918177675849392013344556677889900aabb' +
    'ccddeeff00112233445566778899aabbccddeeff001122334455667788990011',
  resultHash:
    'a7b8bc193565866fb0918bb691762d949ce86ddb32b098c049f04021f1f02224',
  resultSignature:
    '8899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778' +
    '899aabbccddeeff00112233445566778899aabbccddeeff001122334455667700',
  signerPublicKey:
    '0011223344556677889900112233445566778899001122334455667788990011',
  timestamp: '2026-04-26T22:00:00.000Z',
};

describe('bilateralReceiptToInTotoPredicate', () => {
  it('emits snake_case fields at top level (no bilateral wrapper)', () => {
    const predicate = bilateralReceiptToInTotoPredicate(sampleReceipt);

    // Top-level snake_case fields per APS schema
    expect(predicate.authorization_hash).toBe(sampleReceipt.authorizationHash);
    expect(predicate.authorization_signature).toBe(
      sampleReceipt.authorizationSignature,
    );
    expect(predicate.result_hash).toBe(sampleReceipt.resultHash);
    expect(predicate.result_signature).toBe(sampleReceipt.resultSignature);
    expect(predicate.signer_public_key).toBe(sampleReceipt.signerPublicKey);
    expect(predicate.timestamp).toBe(sampleReceipt.timestamp);

    // No `bilateral` wrapper key at top level
    expect((predicate as Record<string, unknown>).bilateral).toBeUndefined();
  });

  it('does not emit camelCase variants', () => {
    const predicate = bilateralReceiptToInTotoPredicate(sampleReceipt);
    const obj = predicate as unknown as Record<string, unknown>;

    expect(obj.authorizationHash).toBeUndefined();
    expect(obj.authorizationSignature).toBeUndefined();
    expect(obj.resultHash).toBeUndefined();
    expect(obj.resultSignature).toBeUndefined();
    expect(obj.signerPublicKey).toBeUndefined();
  });

  it('includes migration_attestation when provided', () => {
    const migration: MigrationAttestation = {
      from_chain_root:
        '1111111111111111111111111111111111111111111111111111111111111111',
      to_chain_root:
        '2222222222222222222222222222222222222222222222222222222222222222',
      rotation_signature:
        '3333333333333333333333333333333333333333333333333333333333333333' +
        '3333333333333333333333333333333333333333333333333333333333333333',
      rotation_timestamp: '2026-04-26T22:30:00.000Z',
      from_epistemic_state: 'pre-rotation',
      to_epistemic_state: 'post-rotation',
    };

    const predicate = bilateralReceiptToInTotoPredicate(
      sampleReceipt,
      migration,
    );

    expect(predicate.migration_attestation).toBeDefined();
    expect(predicate.migration_attestation?.from_chain_root).toBe(
      migration.from_chain_root,
    );
    expect(predicate.migration_attestation?.to_chain_root).toBe(
      migration.to_chain_root,
    );
    expect(predicate.migration_attestation?.rotation_signature).toBe(
      migration.rotation_signature,
    );
    expect(predicate.migration_attestation?.rotation_timestamp).toBe(
      migration.rotation_timestamp,
    );
  });

  it('omits migration_attestation key when not provided', () => {
    const predicate = bilateralReceiptToInTotoPredicate(sampleReceipt);
    expect(
      (predicate as Record<string, unknown>).migration_attestation,
    ).toBeUndefined();
  });
});

describe('predicateToCanonicalBytes', () => {
  it('produces deterministic byte output', async () => {
    const predicate = bilateralReceiptToInTotoPredicate(sampleReceipt);
    const bytes1 = await predicateToCanonicalBytes(predicate);
    const bytes2 = await predicateToCanonicalBytes(predicate);

    expect(bytes1).toEqual(bytes2);
  });

  it('produces byte-identical output regardless of object key order', async () => {
    const predicate1 = bilateralReceiptToInTotoPredicate(sampleReceipt);
    // Construct an equivalent predicate with different key insertion order
    const predicate2 = {
      result_signature: predicate1.result_signature,
      timestamp: predicate1.timestamp,
      signer_public_key: predicate1.signer_public_key,
      authorization_hash: predicate1.authorization_hash,
      result_hash: predicate1.result_hash,
      authorization_signature: predicate1.authorization_signature,
    };

    const bytes1 = await predicateToCanonicalBytes(predicate1);
    const bytes2 = await predicateToCanonicalBytes(
      predicate2 as typeof predicate1,
    );

    // JCS RFC 8785 sorts keys lexicographically, so output must match
    expect(bytes1).toEqual(bytes2);
  });
});
