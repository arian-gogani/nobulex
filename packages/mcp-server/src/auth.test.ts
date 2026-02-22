import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthMiddleware } from './auth';
import type { MCPAuthOptions, AuthenticatedRequest } from './auth';
import { generateKeyPair, sign, toHex, sha256String } from '@nobulex/crypto';

// ─── API Key Authentication ─────────────────────────────────────────────────────

describe('API key authentication', () => {
  const API_KEY_1 = 'sk-test-key-alpha';
  const API_KEY_2 = 'sk-test-key-beta';

  it('authenticates with a valid API key', () => {
    const mw = createAuthMiddleware({ apiKeys: [API_KEY_1] });
    const result = mw.authenticate({ 'x-api-key': API_KEY_1 });

    expect(result.authMethod).toBe('api-key');
    expect(typeof result.clientId).toBe('string');
    expect(result.clientId.startsWith('apikey:')).toBe(true);
    expect(typeof result.timestamp).toBe('string');
  });

  it('rejects an invalid API key', () => {
    const mw = createAuthMiddleware({ apiKeys: [API_KEY_1] });

    expect(() =>
      mw.authenticate({ 'x-api-key': 'invalid-key' }),
    ).toThrow('Invalid API key');
  });

  it('supports multiple API keys', () => {
    const mw = createAuthMiddleware({ apiKeys: [API_KEY_1, API_KEY_2] });

    const r1 = mw.authenticate({ 'x-api-key': API_KEY_1 });
    const r2 = mw.authenticate({ 'x-api-key': API_KEY_2 });

    expect(r1.authMethod).toBe('api-key');
    expect(r2.authMethod).toBe('api-key');
  });

  it('derives consistent client IDs from API keys', () => {
    const mw = createAuthMiddleware({ apiKeys: [API_KEY_1] });

    const r1 = mw.authenticate({ 'x-api-key': API_KEY_1 });
    const r2 = mw.authenticate({ 'x-api-key': API_KEY_1 });

    expect(r1.clientId).toBe(r2.clientId);
  });

  it('derives different client IDs for different API keys', () => {
    const mw = createAuthMiddleware({ apiKeys: [API_KEY_1, API_KEY_2] });

    const r1 = mw.authenticate({ 'x-api-key': API_KEY_1 });
    const r2 = mw.authenticate({ 'x-api-key': API_KEY_2 });

    expect(r1.clientId).not.toBe(r2.clientId);
  });
});

// ─── Signature-based Authentication ─────────────────────────────────────────────

describe('Signature-based authentication', () => {
  it('authenticates with a trusted public key and signature headers', async () => {
    const kp = await generateKeyPair();
    const mw = createAuthMiddleware({ trustedKeys: [kp.publicKeyHex] });

    const payload = 'test-payload';
    const sig = await sign(new TextEncoder().encode(payload), kp.privateKey);

    const result = mw.authenticate({
      'x-public-key': kp.publicKeyHex,
      'x-signature': toHex(sig),
      'x-signature-payload': payload,
    });

    expect(result.authMethod).toBe('signature');
    expect(result.clientId.startsWith('sig:')).toBe(true);
  });

  it('rejects an untrusted public key', async () => {
    const kp = await generateKeyPair();
    const untrusted = await generateKeyPair();
    const mw = createAuthMiddleware({ trustedKeys: [kp.publicKeyHex] });

    expect(() =>
      mw.authenticate({
        'x-public-key': untrusted.publicKeyHex,
        'x-signature': toHex(new Uint8Array(64)),
        'x-signature-payload': 'test',
      }),
    ).toThrow('Untrusted public key');
  });

  it('requires all three signature headers', () => {
    const mw = createAuthMiddleware({ apiKeys: ['some-key'] });

    // Missing signature and payload
    expect(() =>
      mw.authenticate({ 'x-public-key': 'abc123' }),
    ).toThrow('Authentication required');

    // Missing payload
    expect(() =>
      mw.authenticate({
        'x-public-key': 'abc123',
        'x-signature': 'def456',
      }),
    ).toThrow('Authentication required');
  });
});

// ─── No Authentication ──────────────────────────────────────────────────────────

describe('No authentication configured', () => {
  it('allows anonymous access when no credentials are configured', () => {
    const mw = createAuthMiddleware({});
    const result = mw.authenticate({});

    expect(result.authMethod).toBe('none');
    expect(result.clientId).toBe('anonymous');
  });

  it('requires auth when apiKeys are configured but none provided', () => {
    const mw = createAuthMiddleware({ apiKeys: ['secret'] });

    expect(() => mw.authenticate({})).toThrow('Authentication required');
  });

  it('requires auth when trustedKeys are configured but none provided', async () => {
    const kp = await generateKeyPair();
    const mw = createAuthMiddleware({ trustedKeys: [kp.publicKeyHex] });

    expect(() => mw.authenticate({})).toThrow('Authentication required');
  });
});

// ─── Rate Limiting ──────────────────────────────────────────────────────────────

describe('Rate limiting', () => {
  it('does not rate limit when rateLimitPerMinute is not set', () => {
    const mw = createAuthMiddleware({});

    for (let i = 0; i < 100; i++) {
      expect(mw.isRateLimited('client1')).toBe(false);
    }
  });

  it('does not rate limit when rateLimitPerMinute is 0', () => {
    const mw = createAuthMiddleware({ rateLimitPerMinute: 0 });

    for (let i = 0; i < 100; i++) {
      expect(mw.isRateLimited('client1')).toBe(false);
    }
  });

  it('allows requests up to the rate limit', () => {
    const mw = createAuthMiddleware({ rateLimitPerMinute: 5 });

    for (let i = 0; i < 5; i++) {
      expect(mw.isRateLimited('client1')).toBe(false);
    }
  });

  it('blocks requests exceeding the rate limit', () => {
    const mw = createAuthMiddleware({ rateLimitPerMinute: 3 });

    expect(mw.isRateLimited('client1')).toBe(false);
    expect(mw.isRateLimited('client1')).toBe(false);
    expect(mw.isRateLimited('client1')).toBe(false);
    expect(mw.isRateLimited('client1')).toBe(true); // 4th request blocked
  });

  it('tracks rate limits per client independently', () => {
    const mw = createAuthMiddleware({ rateLimitPerMinute: 2 });

    expect(mw.isRateLimited('client1')).toBe(false);
    expect(mw.isRateLimited('client1')).toBe(false);
    expect(mw.isRateLimited('client1')).toBe(true); // client1 blocked

    // client2 should still be allowed
    expect(mw.isRateLimited('client2')).toBe(false);
    expect(mw.isRateLimited('client2')).toBe(false);
    expect(mw.isRateLimited('client2')).toBe(true); // client2 blocked
  });

  it('rate limit with limit of 1 blocks after first request', () => {
    const mw = createAuthMiddleware({ rateLimitPerMinute: 1 });

    expect(mw.isRateLimited('client1')).toBe(false);
    expect(mw.isRateLimited('client1')).toBe(true);
  });
});

// ─── Key Revocation ─────────────────────────────────────────────────────────────

describe('Key revocation', () => {
  it('revokes an API key so it no longer authenticates', () => {
    const apiKey = 'revocable-key';
    const mw = createAuthMiddleware({ apiKeys: [apiKey] });

    // Should work before revocation
    const result = mw.authenticate({ 'x-api-key': apiKey });
    expect(result.authMethod).toBe('api-key');

    // Revoke the key
    mw.revokeKey(apiKey);

    // Should fail after revocation
    expect(() => mw.authenticate({ 'x-api-key': apiKey })).toThrow(
      'Invalid API key',
    );
  });

  it('revokes a trusted public key so it no longer authenticates', async () => {
    const kp = await generateKeyPair();
    const mw = createAuthMiddleware({ trustedKeys: [kp.publicKeyHex] });

    const payload = 'test';
    const sig = await sign(new TextEncoder().encode(payload), kp.privateKey);

    // Should work before revocation
    const result = mw.authenticate({
      'x-public-key': kp.publicKeyHex,
      'x-signature': toHex(sig),
      'x-signature-payload': payload,
    });
    expect(result.authMethod).toBe('signature');

    // Revoke the key
    mw.revokeKey(kp.publicKeyHex);

    // Should fail after revocation
    expect(() =>
      mw.authenticate({
        'x-public-key': kp.publicKeyHex,
        'x-signature': toHex(sig),
        'x-signature-payload': payload,
      }),
    ).toThrow('Untrusted public key');
  });

  it('revoking a non-existent key is a no-op', () => {
    const mw = createAuthMiddleware({ apiKeys: ['real-key'] });

    // Should not throw
    mw.revokeKey('non-existent-key');

    // Real key still works
    const result = mw.authenticate({ 'x-api-key': 'real-key' });
    expect(result.authMethod).toBe('api-key');
  });

  it('only revokes the specified key, not others', () => {
    const mw = createAuthMiddleware({ apiKeys: ['key-a', 'key-b'] });

    mw.revokeKey('key-a');

    expect(() => mw.authenticate({ 'x-api-key': 'key-a' })).toThrow();
    expect(mw.authenticate({ 'x-api-key': 'key-b' }).authMethod).toBe('api-key');
  });
});

// ─── Client listing ─────────────────────────────────────────────────────────────

describe('Client listing', () => {
  it('starts with no known clients', () => {
    const mw = createAuthMiddleware({});
    expect(mw.listClients()).toEqual([]);
  });

  it('tracks authenticated clients', () => {
    const mw = createAuthMiddleware({ apiKeys: ['key1', 'key2'] });

    mw.authenticate({ 'x-api-key': 'key1' });
    expect(mw.listClients().length).toBe(1);

    mw.authenticate({ 'x-api-key': 'key2' });
    expect(mw.listClients().length).toBe(2);
  });

  it('does not duplicate client IDs on repeated auth', () => {
    const mw = createAuthMiddleware({ apiKeys: ['key1'] });

    mw.authenticate({ 'x-api-key': 'key1' });
    mw.authenticate({ 'x-api-key': 'key1' });
    mw.authenticate({ 'x-api-key': 'key1' });

    expect(mw.listClients().length).toBe(1);
  });

  it('tracks anonymous clients', () => {
    const mw = createAuthMiddleware({});
    mw.authenticate({});

    expect(mw.listClients()).toContain('anonymous');
  });
});

// ─── Combined scenarios ─────────────────────────────────────────────────────────

describe('Combined auth + rate limiting', () => {
  it('authenticates and then rate limits the same client', () => {
    const mw = createAuthMiddleware({
      apiKeys: ['test-key'],
      rateLimitPerMinute: 2,
    });

    const auth = mw.authenticate({ 'x-api-key': 'test-key' });
    expect(auth.authMethod).toBe('api-key');

    // Use the client ID from auth for rate limiting
    expect(mw.isRateLimited(auth.clientId)).toBe(false);
    expect(mw.isRateLimited(auth.clientId)).toBe(false);
    expect(mw.isRateLimited(auth.clientId)).toBe(true);
  });

  it('supports both API key and signature auth simultaneously', async () => {
    const kp = await generateKeyPair();
    const mw = createAuthMiddleware({
      apiKeys: ['api-key-1'],
      trustedKeys: [kp.publicKeyHex],
    });

    // API key auth
    const r1 = mw.authenticate({ 'x-api-key': 'api-key-1' });
    expect(r1.authMethod).toBe('api-key');

    // Signature auth
    const payload = 'test';
    const sig = await sign(new TextEncoder().encode(payload), kp.privateKey);
    const r2 = mw.authenticate({
      'x-public-key': kp.publicKeyHex,
      'x-signature': toHex(sig),
      'x-signature-payload': payload,
    });
    expect(r2.authMethod).toBe('signature');

    // Both clients are tracked
    expect(mw.listClients().length).toBe(2);
  });

  it('API key takes precedence when both headers present', async () => {
    const kp = await generateKeyPair();
    const mw = createAuthMiddleware({
      apiKeys: ['my-api-key'],
      trustedKeys: [kp.publicKeyHex],
    });

    // Provide both API key and signature headers
    const result = mw.authenticate({
      'x-api-key': 'my-api-key',
      'x-public-key': kp.publicKeyHex,
      'x-signature': 'dummy',
      'x-signature-payload': 'dummy',
    });

    // API key should take precedence
    expect(result.authMethod).toBe('api-key');
  });
});
