import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPair, sign, verify, toHex } from './index';
import { KeyManager } from './key-rotation';
import type { KeyRotationPolicy, ManagedKeyPair } from './key-rotation';

// ─── Constructor validation ────────────────────────────────────────────────────

describe('KeyManager constructor', () => {
  it('rejects maxAgeMs <= 0', () => {
    expect(() => new KeyManager({ maxAgeMs: 0, overlapPeriodMs: 0 })).toThrow(
      'maxAgeMs must be positive',
    );
    expect(() => new KeyManager({ maxAgeMs: -1, overlapPeriodMs: 0 })).toThrow(
      'maxAgeMs must be positive',
    );
  });

  it('rejects negative overlapPeriodMs', () => {
    expect(() => new KeyManager({ maxAgeMs: 1000, overlapPeriodMs: -1 })).toThrow(
      'overlapPeriodMs must be non-negative',
    );
  });

  it('rejects overlapPeriodMs >= maxAgeMs', () => {
    expect(() => new KeyManager({ maxAgeMs: 1000, overlapPeriodMs: 1000 })).toThrow(
      'overlapPeriodMs must be less than maxAgeMs',
    );
    expect(() => new KeyManager({ maxAgeMs: 1000, overlapPeriodMs: 2000 })).toThrow(
      'overlapPeriodMs must be less than maxAgeMs',
    );
  });

  it('accepts valid policy parameters', () => {
    expect(() => new KeyManager({ maxAgeMs: 1000, overlapPeriodMs: 500 })).not.toThrow();
    expect(() => new KeyManager({ maxAgeMs: 86400000, overlapPeriodMs: 0 })).not.toThrow();
  });
});

// ─── initialize() ──────────────────────────────────────────────────────────────

describe('KeyManager.initialize', () => {
  it('creates an active managed key pair', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    const managed = await km.initialize();

    expect(managed.status).toBe('active');
    expect(managed.keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(managed.keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(managed.keyPair.privateKey.length).toBe(32);
    expect(managed.keyPair.publicKey.length).toBe(32);
    expect(typeof managed.createdAt).toBe('string');
    expect(managed.rotatedAt).toBeUndefined();
  });

  it('throws if called twice', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();
    await expect(km.initialize()).rejects.toThrow('already initialized');
  });

  it('sets the key as current()', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    const managed = await km.initialize();
    const current = km.current();
    expect(current.keyPair.publicKeyHex).toBe(managed.keyPair.publicKeyHex);
  });
});

// ─── Pre-initialization guards ─────────────────────────────────────────────────

describe('pre-initialization guards', () => {
  it('current() throws before initialization', () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    expect(() => km.current()).toThrow('not initialized');
  });

  it('needsRotation() throws before initialization', () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    expect(() => km.needsRotation()).toThrow('not initialized');
  });

  it('rotate() throws before initialization', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await expect(km.rotate()).rejects.toThrow('not initialized');
  });

  it('verifyWithAnyKey() throws before initialization', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await expect(
      km.verifyWithAnyKey(new Uint8Array(0), new Uint8Array(0)),
    ).rejects.toThrow('not initialized');
  });

  it('retireExpired() throws before initialization', () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    expect(() => km.retireExpired()).toThrow('not initialized');
  });
});

// ─── needsRotation() ──────────────────────────────────────────────────────────

describe('KeyManager.needsRotation', () => {
  it('returns false when key is fresh', async () => {
    const km = new KeyManager({ maxAgeMs: 100000, overlapPeriodMs: 1000 });
    await km.initialize();
    expect(km.needsRotation()).toBe(false);
  });

  it('returns true when key age exceeds maxAgeMs', async () => {
    const km = new KeyManager({ maxAgeMs: 50, overlapPeriodMs: 10 });
    await km.initialize();

    // Wait for the key to age past maxAgeMs
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(km.needsRotation()).toBe(true);
  });
});

// ─── rotate() ──────────────────────────────────────────────────────────────────

describe('KeyManager.rotate', () => {
  it('creates a new active key and puts old key in rotating status', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    const originalKey = km.current().keyPair.publicKeyHex;
    const { previous, current } = await km.rotate();

    expect(previous.status).toBe('rotating');
    expect(previous.rotatedAt).toBeDefined();
    expect(previous.keyPair.publicKeyHex).toBe(originalKey);

    expect(current.status).toBe('active');
    expect(current.keyPair.publicKeyHex).not.toBe(originalKey);

    // current() should return the new key
    expect(km.current().keyPair.publicKeyHex).toBe(current.keyPair.publicKeyHex);
  });

  it('fires the onRotation callback with old and new public key hex', async () => {
    const onRotation = vi.fn();
    const km = new KeyManager({
      maxAgeMs: 10000,
      overlapPeriodMs: 1000,
      onRotation,
    });
    await km.initialize();
    const originalKey = km.current().keyPair.publicKeyHex;

    const { current } = await km.rotate();

    expect(onRotation).toHaveBeenCalledOnce();
    expect(onRotation).toHaveBeenCalledWith(originalKey, current.keyPair.publicKeyHex);
  });

  it('supports multiple rotations', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    await km.rotate();
    await km.rotate();
    await km.rotate();

    const allKeys = km.all();
    expect(allKeys.length).toBe(4); // 1 initial + 3 rotations

    // Only one should be active
    const active = allKeys.filter((k) => k.status === 'active');
    expect(active.length).toBe(1);
  });

  it('all previous keys are in rotating status after multiple rotations', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 5000 });
    await km.initialize();

    await km.rotate();
    await km.rotate();

    const allKeys = km.all();
    const rotating = allKeys.filter((k) => k.status === 'rotating');
    expect(rotating.length).toBe(2);
  });
});

// ─── all() ─────────────────────────────────────────────────────────────────────

describe('KeyManager.all', () => {
  it('returns all managed key pairs', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    expect(km.all().length).toBe(1);

    await km.rotate();
    expect(km.all().length).toBe(2);
  });

  it('returns a copy, not a reference to internals', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    const allKeys = km.all();
    allKeys.push({} as ManagedKeyPair);

    expect(km.all().length).toBe(1); // Original not affected
  });
});

// ─── verifyWithAnyKey() ────────────────────────────────────────────────────────

describe('KeyManager.verifyWithAnyKey', () => {
  it('verifies a signature made with the current active key', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 5000 });
    await km.initialize();

    const message = new TextEncoder().encode('hello');
    const signature = await sign(message, km.current().keyPair.privateKey);

    const result = await km.verifyWithAnyKey(message, signature);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(km.current().keyPair.publicKeyHex);
  });

  it('verifies a signature made with a rotating key (overlap period)', async () => {
    const km = new KeyManager({ maxAgeMs: 100000, overlapPeriodMs: 60000 }); // long overlap
    await km.initialize();

    const message = new TextEncoder().encode('overlap-test');
    const oldKey = km.current();
    const signature = await sign(message, oldKey.keyPair.privateKey);

    await km.rotate();

    // Old key is now rotating, should still verify during overlap
    const result = await km.verifyWithAnyKey(message, signature);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(oldKey.keyPair.publicKeyHex);
  });

  it('rejects an invalid signature', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    const message = new TextEncoder().encode('hello');
    const fakeSignature = new Uint8Array(64); // All zeros

    const result = await km.verifyWithAnyKey(message, fakeSignature);
    expect(result.valid).toBe(false);
    expect(result.keyId).toBe('');
  });

  it('rejects a signature from an unknown key', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    const unknownKey = await generateKeyPair();
    const message = new TextEncoder().encode('hello');
    const signature = await sign(message, unknownKey.privateKey);

    const result = await km.verifyWithAnyKey(message, signature);
    expect(result.valid).toBe(false);
    expect(result.keyId).toBe('');
  });

  it('verifies against new key after rotation', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 5000 });
    await km.initialize();

    await km.rotate();

    const message = new TextEncoder().encode('new-key-test');
    const signature = await sign(message, km.current().keyPair.privateKey);

    const result = await km.verifyWithAnyKey(message, signature);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(km.current().keyPair.publicKeyHex);
  });
});

// ─── retireExpired() ───────────────────────────────────────────────────────────

describe('KeyManager.retireExpired', () => {
  it('retires keys whose overlap period has expired', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 30 });
    await km.initialize();

    await km.rotate();

    // Wait for the overlap period to expire
    await new Promise((resolve) => setTimeout(resolve, 50));

    const retired = km.retireExpired();
    expect(retired.length).toBe(1);
    expect(retired[0]!.status).toBe('retired');
  });

  it('does not retire keys still within overlap period', async () => {
    const km = new KeyManager({ maxAgeMs: 100000, overlapPeriodMs: 60000 });
    await km.initialize();

    await km.rotate();

    const retired = km.retireExpired();
    expect(retired.length).toBe(0);
  });

  it('does not retire the active key', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 1000 });
    await km.initialize();

    const retired = km.retireExpired();
    expect(retired.length).toBe(0);
  });

  it('retired keys are not eligible for verification', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 30 });
    await km.initialize();

    const message = new TextEncoder().encode('retired-test');
    const oldKey = km.current();
    const signature = await sign(message, oldKey.keyPair.privateKey);

    await km.rotate();

    // Wait for overlap to expire
    await new Promise((resolve) => setTimeout(resolve, 50));
    km.retireExpired();

    // The old key should no longer verify (it's retired and past overlap)
    const result = await km.verifyWithAnyKey(message, signature);
    expect(result.valid).toBe(false);
  });
});

// ─── Full lifecycle ────────────────────────────────────────────────────────────

describe('KeyManager full lifecycle', () => {
  it('initialize -> sign -> rotate -> verify old -> verify new -> retire -> reject old', async () => {
    const km = new KeyManager({ maxAgeMs: 10000, overlapPeriodMs: 50 });

    // Step 1: Initialize
    await km.initialize();
    const firstKey = km.current();

    // Step 2: Sign with first key
    const msg = new TextEncoder().encode('lifecycle-test');
    const sig = await sign(msg, firstKey.keyPair.privateKey);

    // Step 3: Rotate
    const { current: secondKey } = await km.rotate();

    // Step 4: Verify old signature (still in overlap)
    let result = await km.verifyWithAnyKey(msg, sig);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(firstKey.keyPair.publicKeyHex);

    // Step 5: Sign and verify with new key
    const sig2 = await sign(msg, secondKey.keyPair.privateKey);
    result = await km.verifyWithAnyKey(msg, sig2);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(secondKey.keyPair.publicKeyHex);

    // Step 6: Wait for overlap to expire and retire
    await new Promise((resolve) => setTimeout(resolve, 60));
    const retired = km.retireExpired();
    expect(retired.length).toBe(1);

    // Step 7: Old signature should no longer verify
    result = await km.verifyWithAnyKey(msg, sig);
    expect(result.valid).toBe(false);

    // But new key still works
    result = await km.verifyWithAnyKey(msg, sig2);
    expect(result.valid).toBe(true);
  });
});
