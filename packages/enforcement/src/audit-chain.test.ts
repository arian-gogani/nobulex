import { describe, it, expect } from 'vitest';
import { AuditChain } from './audit-chain';
import type { ChainedAuditEntry } from './audit-chain';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<Omit<ChainedAuditEntry, 'id' | 'previousHash' | 'hash' | 'nonce'>>) {
  return {
    timestamp: new Date().toISOString(),
    action: 'file.read',
    resource: '/data/users',
    covenantId: 'a'.repeat(64),
    result: 'permitted' as const,
    ...overrides,
  };
}

// ─── Constructor & basic operations ─────────────────────────────────────────────

describe('AuditChain basics', () => {
  it('starts with an empty chain', () => {
    const chain = new AuditChain();
    expect(chain.entries().length).toBe(0);
    expect(chain.latest()).toBeUndefined();
  });

  it('append returns a complete entry with all fields populated', () => {
    const chain = new AuditChain();
    const entry = chain.append(makeEntry());

    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.hash).toBe('string');
    expect(entry.hash.length).toBe(64); // SHA-256 hex
    expect(typeof entry.previousHash).toBe('string');
    expect(typeof entry.nonce).toBe('string');
    expect(entry.nonce.length).toBe(64); // 32 bytes -> 64 hex chars
    expect(entry.action).toBe('file.read');
    expect(entry.resource).toBe('/data/users');
    expect(entry.result).toBe('permitted');
  });

  it('first entry has genesis previousHash (all zeros)', () => {
    const chain = new AuditChain();
    const entry = chain.append(makeEntry());
    expect(entry.previousHash).toBe('0'.repeat(64));
  });

  it('second entry chains to first entry hash', () => {
    const chain = new AuditChain();
    const first = chain.append(makeEntry());
    const second = chain.append(makeEntry({ action: 'file.write' }));

    expect(second.previousHash).toBe(first.hash);
  });

  it('latest() returns the most recent entry', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ action: 'first' }));
    chain.append(makeEntry({ action: 'second' }));
    chain.append(makeEntry({ action: 'third' }));

    expect(chain.latest()!.action).toBe('third');
  });

  it('entries() returns all entries', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ action: 'a' }));
    chain.append(makeEntry({ action: 'b' }));
    chain.append(makeEntry({ action: 'c' }));

    const all = chain.entries();
    expect(all.length).toBe(3);
    expect(all[0]!.action).toBe('a');
    expect(all[1]!.action).toBe('b');
    expect(all[2]!.action).toBe('c');
  });

  it('entries() returns a frozen copy', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());

    const entries = chain.entries();
    expect(Object.isFrozen(entries)).toBe(true);
  });
});

// ─── Chain integrity verification ───────────────────────────────────────────────

describe('AuditChain.verify', () => {
  it('empty chain is valid', () => {
    const chain = new AuditChain();
    const result = chain.verify();
    expect(result.valid).toBe(true);
  });

  it('single entry chain is valid', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());

    const result = chain.verify();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(1);
  });

  it('multi-entry chain is valid', () => {
    const chain = new AuditChain();
    for (let i = 0; i < 10; i++) {
      chain.append(makeEntry({ action: `action-${i}` }));
    }

    const result = chain.verify();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(10);
  });

  it('each entry has a unique hash due to nonces', () => {
    const chain = new AuditChain();
    // Add identical entries (same action, resource, etc.)
    chain.append(makeEntry());
    chain.append(makeEntry());

    const entries = chain.entries();
    expect(entries[0]!.hash).not.toBe(entries[1]!.hash);
  });
});

// ─── Tamper detection ───────────────────────────────────────────────────────────

describe('AuditChain tamper detection', () => {
  it('detects tampered action field', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ action: 'file.read' }));
    chain.append(makeEntry({ action: 'file.write' }));
    chain.append(makeEntry({ action: 'file.delete' }));

    // Tamper with the second entry's action
    const entries = chain.entries();
    // Access internal chain directly for tampering simulation
    (chain as any).chain[1].action = 'file.HACKED';

    const result = chain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('detects tampered result field', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ result: 'denied' }));
    chain.append(makeEntry({ result: 'permitted' }));

    // Tamper with the first entry's result
    (chain as any).chain[0].result = 'permitted';

    const result = chain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('detects tampered previousHash (broken chain link)', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());
    chain.append(makeEntry());
    chain.append(makeEntry());

    // Tamper with the previousHash of the third entry
    (chain as any).chain[2].previousHash = 'f'.repeat(64);

    const result = chain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('detects deleted entry (gap in chain)', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());
    chain.append(makeEntry());
    chain.append(makeEntry());

    // Remove the middle entry
    (chain as any).chain.splice(1, 1);

    const result = chain.verify();
    expect(result.valid).toBe(false);
    // The second entry (now at index 1) should fail because its previousHash
    // no longer matches entry at index 0
    expect(result.brokenAt).toBe(1);
  });

  it('detects tampered hash (recomputed independently)', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());
    chain.append(makeEntry());

    // Tamper with the hash directly
    (chain as any).chain[0].hash = 'a'.repeat(64);

    const result = chain.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });
});

// ─── Range verification ─────────────────────────────────────────────────────────

describe('AuditChain.verifyRange', () => {
  it('verifies a valid sub-range', () => {
    const chain = new AuditChain();
    for (let i = 0; i < 5; i++) {
      chain.append(makeEntry({ action: `action-${i}` }));
    }

    const result = chain.verifyRange(1, 3);
    expect(result.valid).toBe(true);
  });

  it('detects tampering within the specified range', () => {
    const chain = new AuditChain();
    for (let i = 0; i < 5; i++) {
      chain.append(makeEntry({ action: `action-${i}` }));
    }

    // Tamper at index 2
    (chain as any).chain[2].action = 'HACKED';

    const result = chain.verifyRange(2, 4);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it('does not detect tampering outside the specified range', () => {
    const chain = new AuditChain();
    for (let i = 0; i < 5; i++) {
      chain.append(makeEntry({ action: `action-${i}` }));
    }

    // Tamper at index 0 (outside range 2-4)
    (chain as any).chain[0].action = 'HACKED';

    const result = chain.verifyRange(2, 4);
    // Range 2-4 itself is still valid (chain links between 2-4 are intact)
    expect(result.valid).toBe(true);
  });

  it('handles empty chain', () => {
    const chain = new AuditChain();
    const result = chain.verifyRange(0, 0);
    expect(result.valid).toBe(true);
  });
});

// ─── Export / Import ────────────────────────────────────────────────────────────

describe('AuditChain export/import', () => {
  it('round-trips through export/import', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ action: 'read', result: 'permitted' }));
    chain.append(makeEntry({ action: 'write', result: 'denied' }));
    chain.append(makeEntry({ action: 'delete', result: 'error' }));

    const json = chain.export();
    const imported = AuditChain.import(json);

    expect(imported.entries().length).toBe(3);
    expect(imported.entries()[0]!.action).toBe('read');
    expect(imported.entries()[1]!.action).toBe('write');
    expect(imported.entries()[2]!.action).toBe('delete');

    // Integrity should still hold
    const result = imported.verify();
    expect(result.valid).toBe(true);
  });

  it('export produces valid JSON', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());

    const json = chain.export();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('import rejects invalid JSON', () => {
    expect(() => AuditChain.import('not json')).toThrow('Invalid JSON');
  });

  it('import rejects non-array JSON', () => {
    expect(() => AuditChain.import('{"key": "value"}')).toThrow(
      'expected an array',
    );
  });

  it('import rejects tampered chain', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());
    chain.append(makeEntry());

    const json = chain.export();
    const parsed = JSON.parse(json);
    parsed[0].action = 'TAMPERED';

    expect(() => AuditChain.import(JSON.stringify(parsed))).toThrow(
      'integrity check failed',
    );
  });

  it('import accepts empty chain', () => {
    const imported = AuditChain.import('[]');
    expect(imported.entries().length).toBe(0);
    expect(imported.verify().valid).toBe(true);
  });

  it('imported chain can have new entries appended', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ action: 'original' }));

    const json = chain.export();
    const imported = AuditChain.import(json);

    imported.append(makeEntry({ action: 'new-entry' }));

    expect(imported.entries().length).toBe(2);
    expect(imported.verify().valid).toBe(true);
    expect(imported.latest()!.action).toBe('new-entry');
    // The new entry should chain to the imported entry
    expect(imported.entries()[1]!.previousHash).toBe(imported.entries()[0]!.hash);
  });
});

// ─── Statistics ─────────────────────────────────────────────────────────────────

describe('AuditChain.stats', () => {
  it('returns zero counts for empty chain', () => {
    const chain = new AuditChain();
    const stats = chain.stats();
    expect(stats).toEqual({ total: 0, permitted: 0, denied: 0, errors: 0 });
  });

  it('correctly counts each result type', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ result: 'permitted' }));
    chain.append(makeEntry({ result: 'permitted' }));
    chain.append(makeEntry({ result: 'denied' }));
    chain.append(makeEntry({ result: 'error' }));
    chain.append(makeEntry({ result: 'permitted' }));
    chain.append(makeEntry({ result: 'denied' }));

    const stats = chain.stats();
    expect(stats.total).toBe(6);
    expect(stats.permitted).toBe(3);
    expect(stats.denied).toBe(2);
    expect(stats.errors).toBe(1);
  });

  it('handles all-denied chain', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ result: 'denied' }));
    chain.append(makeEntry({ result: 'denied' }));

    const stats = chain.stats();
    expect(stats).toEqual({ total: 2, permitted: 0, denied: 2, errors: 0 });
  });

  it('handles all-error chain', () => {
    const chain = new AuditChain();
    chain.append(makeEntry({ result: 'error' }));

    const stats = chain.stats();
    expect(stats).toEqual({ total: 1, permitted: 0, denied: 0, errors: 1 });
  });
});

// ─── Hash chain properties ──────────────────────────────────────────────────────

describe('AuditChain hash chain properties', () => {
  it('changing any field in any entry breaks the chain', () => {
    const fields = ['timestamp', 'action', 'resource', 'covenantId', 'result'] as const;

    for (const field of fields) {
      const chain = new AuditChain();
      chain.append(makeEntry());
      chain.append(makeEntry());

      (chain as any).chain[0][field] = 'MODIFIED';

      const result = chain.verify();
      expect(result.valid).toBe(false);
    }
  });

  it('consecutive hashes form a chain', () => {
    const chain = new AuditChain();
    chain.append(makeEntry());
    chain.append(makeEntry());
    chain.append(makeEntry());

    const entries = chain.entries();
    expect(entries[1]!.previousHash).toBe(entries[0]!.hash);
    expect(entries[2]!.previousHash).toBe(entries[1]!.hash);
  });
});
