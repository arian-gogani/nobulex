import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPair } from '@nobulex/crypto';
import {
  TransparencyLog,
  MemoryBackend,
  FileBackend,
  LogMonitor,
  verifyLogInclusionProof,
  verifyConsistencyProof,
  signTreeHead,
  verifySignedTreeHead,
  cosignTreeHead,
  verifyWitnesses,
  compactLog,
  logStats,
  serializeLogEntry,
  deserializeLogEntry,
  serializeLog,
  deserializeLog,
  createAPIRoutes,
  type LogEntry,
  type FileSystemAdapter,
  type ConsistencyProof,
  type CosignedTreeHead,
} from './index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a log pre-populated with N entries. */
async function populateLog(n: number): Promise<TransparencyLog> {
  const log = new TransparencyLog({ mode: 'self-hosted' });
  for (let i = 0; i < n; i++) {
    await log.append(`root-${i}`, i, (i + 1) * 10);
  }
  return log;
}

/** Create a mock file system adapter backed by an in-memory map. */
function createMockFs(): FileSystemAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async writeFile(path: string, data: string): Promise<void> {
      files.set(path, data);
    },
    async appendFile(path: string, data: string): Promise<void> {
      const existing = files.get(path) ?? '';
      files.set(path, existing + data);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
  };
}

// ─── TransparencyLog Core ────────────────────────────────────────────────────

describe('TransparencyLog', () => {
  it('should append entries with sequential indices', async () => {
    const log = await populateLog(3);
    expect(await log.length()).toBe(3);

    const e0 = await log.get(0);
    const e1 = await log.get(1);
    const e2 = await log.get(2);

    expect(e0!.index).toBe(0);
    expect(e1!.index).toBe(1);
    expect(e2!.index).toBe(2);
  });

  it('should build a hash chain via previousHash', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });

    const e1 = await log.append('root-aaa', 0, 10);
    const e2 = await log.append('root-bbb', 1, 20);
    const e3 = await log.append('root-ccc', 2, 15);

    expect(e1.previousHash).toBeNull();
    expect(e2.previousHash).toBe(e1.hash);
    expect(e3.previousHash).toBe(e2.hash);
  });

  it('should store epochRoot and leafCount correctly', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const entry = await log.append('my-root', 7, 42);

    expect(entry.epochRoot).toBe('my-root');
    expect(entry.epochIndex).toBe(7);
    expect(entry.leafCount).toBe(42);
  });

  it('should retrieve entries by index', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    await log.append('root-1', 0, 5);
    const e2 = await log.append('root-2', 1, 10);

    const retrieved = await log.get(1);
    expect(retrieved).toEqual(e2);
  });

  it('should return null for missing entries', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    expect(await log.get(0)).toBeNull();
    expect(await log.get(999)).toBeNull();
  });

  it('should get latest entry', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    expect(await log.getLatest()).toBeNull();

    await log.append('r1', 0, 1);
    const e2 = await log.append('r2', 1, 2);
    expect(await log.getLatest()).toEqual(e2);
  });

  it('should get range of entries', async () => {
    const log = await populateLog(5);
    const range = await log.getRange(1, 4);

    expect(range).toHaveLength(3);
    expect(range[0]!.epochIndex).toBe(1);
    expect(range[2]!.epochIndex).toBe(3);
  });

  it('should track length', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    expect(await log.length()).toBe(0);

    await log.append('r', 0, 1);
    expect(await log.length()).toBe(1);

    await log.append('r', 1, 1);
    expect(await log.length()).toBe(2);
  });

  it('should default to self-hosted mode', () => {
    const log = new TransparencyLog();
    expect(log.mode).toBe('self-hosted');
    expect(log.logId).toBe('default');
  });

  it('should accept custom logId', () => {
    const log = new TransparencyLog({ mode: 'self-hosted', logId: 'my-log' });
    expect(log.logId).toBe('my-log');
  });

  it('should produce unique hashes for different content', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const e1 = await log.append('root-a', 0, 10);
    const e2 = await log.append('root-b', 1, 20);
    expect(e1.hash).not.toBe(e2.hash);
  });

  it('should include ISO timestamp on each entry', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const entry = await log.append('root', 0, 1);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── Log Verification ────────────────────────────────────────────────────────

describe('verify', () => {
  it('should pass verification on a valid log', async () => {
    const log = await populateLog(5);
    const result = await log.verify();

    expect(result.valid).toBe(true);
    expect(result.length).toBe(5);
    expect(result.errors).toHaveLength(0);
  });

  it('should verify an empty log', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const result = await log.verify();
    expect(result.valid).toBe(true);
    expect(result.length).toBe(0);
  });

  it('should verify a single-entry log', async () => {
    const log = await populateLog(1);
    const result = await log.verify();
    expect(result.valid).toBe(true);
    expect(result.length).toBe(1);
  });
});

// ─── Inclusion Proofs ────────────────────────────────────────────────────────

describe('inclusion proofs', () => {
  it('should generate and verify an inclusion proof', async () => {
    const log = await populateLog(5);
    const proof = await log.generateInclusionProof(2);

    expect(proof.entryIndex).toBe(2);
    expect(proof.chainHashes).toHaveLength(2); // entries 3 and 4
    expect(verifyLogInclusionProof(proof)).toBe(true);
  });

  it('should verify proof for the first entry', async () => {
    const log = await populateLog(3);
    const proof = await log.generateInclusionProof(0);

    expect(proof.chainHashes).toHaveLength(2);
    expect(verifyLogInclusionProof(proof)).toBe(true);
  });

  it('should verify proof for the latest entry (no chain)', async () => {
    const log = await populateLog(1);
    const proof = await log.generateInclusionProof(0);

    expect(proof.chainHashes).toHaveLength(0);
    expect(proof.entryHash).toBe(proof.headHash);
    expect(verifyLogInclusionProof(proof)).toBe(true);
  });

  it('should throw for out-of-range entry index', async () => {
    const log = await populateLog(3);
    await expect(log.generateInclusionProof(10)).rejects.toThrow('out of range');
    await expect(log.generateInclusionProof(-1)).rejects.toThrow('out of range');
  });

  it('should reject a tampered inclusion proof', () => {
    const proof = {
      entryIndex: 0,
      entryHash: 'abc',
      chainHashes: ['def', 'ghi'],
      headHash: 'xxx', // does not match last chain hash
    };
    expect(verifyLogInclusionProof(proof)).toBe(false);
  });
});

// ─── Consistency Proofs ──────────────────────────────────────────────────────

describe('consistency proofs', () => {
  it('should generate a consistency proof between two sizes', async () => {
    const log = await populateLog(5);
    const proof = await log.generateConsistencyProof(2, 5);

    expect(proof.oldSize).toBe(2);
    expect(proof.newSize).toBe(5);
    expect(proof.proofHashes).toHaveLength(3); // entries 2, 3, 4
  });

  it('should verify a valid consistency proof', async () => {
    const log = await populateLog(5);
    const proof = await log.generateConsistencyProof(2, 5);

    expect(verifyConsistencyProof(proof)).toBe(true);
  });

  it('should handle oldSize === 0', async () => {
    const log = await populateLog(3);
    const proof = await log.generateConsistencyProof(0, 3);

    expect(proof.oldSize).toBe(0);
    expect(proof.oldHeadHash).toBe('');
    expect(proof.proofHashes).toHaveLength(3);
    expect(verifyConsistencyProof(proof)).toBe(true);
  });

  it('should handle oldSize === newSize', async () => {
    const log = await populateLog(3);
    const proof = await log.generateConsistencyProof(3, 3);

    expect(proof.proofHashes).toHaveLength(0);
    expect(proof.oldHeadHash).toBe(proof.newHeadHash);
    expect(verifyConsistencyProof(proof)).toBe(true);
  });

  it('should handle empty log (0, 0)', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const proof = await log.generateConsistencyProof(0, 0);

    expect(proof.oldSize).toBe(0);
    expect(proof.newSize).toBe(0);
    expect(proof.proofHashes).toHaveLength(0);
    expect(verifyConsistencyProof(proof)).toBe(true);
  });

  it('should generate a consistency proof from 1 to N', async () => {
    const log = await populateLog(4);
    const proof = await log.generateConsistencyProof(1, 4);

    expect(proof.proofHashes).toHaveLength(3);
    expect(verifyConsistencyProof(proof)).toBe(true);
  });

  it('should set the new head hash to the last entry hash', async () => {
    const log = await populateLog(5);
    const latest = await log.getLatest();
    const proof = await log.generateConsistencyProof(2, 5);

    expect(proof.newHeadHash).toBe(latest!.hash);
  });

  it('should set the old head hash to the entry at oldSize-1', async () => {
    const log = await populateLog(5);
    const oldHead = await log.get(1);
    const proof = await log.generateConsistencyProof(2, 5);

    expect(proof.oldHeadHash).toBe(oldHead!.hash);
  });

  it('should throw if newSize < oldSize', async () => {
    const log = await populateLog(5);
    await expect(log.generateConsistencyProof(3, 2)).rejects.toThrow('must be >=');
  });

  it('should throw if newSize exceeds log length', async () => {
    const log = await populateLog(3);
    await expect(log.generateConsistencyProof(1, 10)).rejects.toThrow('exceeds log length');
  });

  it('should throw if oldSize is negative', async () => {
    const log = await populateLog(3);
    await expect(log.generateConsistencyProof(-1, 3)).rejects.toThrow('non-negative');
  });

  it('should reject a proof with wrong number of hashes', () => {
    const proof: ConsistencyProof = {
      oldSize: 2,
      newSize: 5,
      oldHeadHash: 'aaa',
      newHeadHash: 'bbb',
      proofHashes: ['x'], // should be 3
      timestamp: new Date().toISOString(),
    };
    expect(verifyConsistencyProof(proof)).toBe(false);
  });

  it('should reject a proof where last hash does not match newHeadHash', () => {
    const proof: ConsistencyProof = {
      oldSize: 2,
      newSize: 4,
      oldHeadHash: 'aaa',
      newHeadHash: 'bbb',
      proofHashes: ['x', 'NOT-bbb'],
      timestamp: new Date().toISOString(),
    };
    expect(verifyConsistencyProof(proof)).toBe(false);
  });

  it('should include a timestamp in the proof', async () => {
    const log = await populateLog(3);
    const proof = await log.generateConsistencyProof(1, 3);
    expect(proof.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── MemoryBackend ───────────────────────────────────────────────────────────

describe('MemoryBackend', () => {
  it('should implement all backend methods', async () => {
    const backend = new MemoryBackend();

    expect(await backend.length()).toBe(0);
    expect(await backend.get(0)).toBeNull();
    expect(await backend.getLatest()).toBeNull();

    const entry: LogEntry = {
      index: 0,
      epochRoot: 'root',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousHash: null,
      hash: 'abc',
      leafCount: 5,
      epochIndex: 0,
    };

    await backend.append(entry);
    expect(await backend.length()).toBe(1);
    expect(await backend.get(0)).toEqual(entry);
    expect(await backend.getLatest()).toEqual(entry);
  });

  it('should return entries in correct range', async () => {
    const backend = new MemoryBackend();

    for (let i = 0; i < 5; i++) {
      await backend.append({
        index: i,
        epochRoot: `root-${i}`,
        timestamp: new Date().toISOString(),
        previousHash: null,
        hash: `hash-${i}`,
        leafCount: 1,
        epochIndex: i,
      });
    }

    const range = await backend.getRange(1, 4);
    expect(range).toHaveLength(3);
    expect(range[0]!.index).toBe(1);
    expect(range[2]!.index).toBe(3);
  });
});

// ─── FileBackend ─────────────────────────────────────────────────────────────

describe('FileBackend', () => {
  it('should append and retrieve entries', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/test.log', mockFs);

    const entry: LogEntry = {
      index: 0,
      epochRoot: 'root-0',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousHash: null,
      hash: 'hash-0',
      leafCount: 10,
      epochIndex: 0,
    };

    await backend.append(entry);
    expect(await backend.length()).toBe(1);

    const retrieved = await backend.get(0);
    expect(retrieved).toEqual(entry);
  });

  it('should store multiple entries as newline-delimited JSON', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/test.log', mockFs);

    for (let i = 0; i < 3; i++) {
      await backend.append({
        index: i,
        epochRoot: `root-${i}`,
        timestamp: new Date().toISOString(),
        previousHash: i > 0 ? `hash-${i - 1}` : null,
        hash: `hash-${i}`,
        leafCount: i + 1,
        epochIndex: i,
      });
    }

    expect(await backend.length()).toBe(3);

    const content = mockFs.files.get('/tmp/test.log')!;
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('should return null for non-existent indices', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/test.log', mockFs);

    expect(await backend.get(0)).toBeNull();
    expect(await backend.get(99)).toBeNull();
  });

  it('should return correct latest entry', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/test.log', mockFs);

    expect(await backend.getLatest()).toBeNull();

    const e0: LogEntry = {
      index: 0, epochRoot: 'r0', timestamp: '', previousHash: null,
      hash: 'h0', leafCount: 1, epochIndex: 0,
    };
    const e1: LogEntry = {
      index: 1, epochRoot: 'r1', timestamp: '', previousHash: 'h0',
      hash: 'h1', leafCount: 2, epochIndex: 1,
    };

    await backend.append(e0);
    await backend.append(e1);

    const latest = await backend.getLatest();
    expect(latest).toEqual(e1);
  });

  it('should support getRange', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/test.log', mockFs);

    for (let i = 0; i < 5; i++) {
      await backend.append({
        index: i, epochRoot: `r${i}`, timestamp: '', previousHash: null,
        hash: `h${i}`, leafCount: 1, epochIndex: i,
      });
    }

    const range = await backend.getRange(2, 4);
    expect(range).toHaveLength(2);
    expect(range[0]!.index).toBe(2);
    expect(range[1]!.index).toBe(3);
  });

  it('should create file if it does not exist', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/new.log', mockFs);

    expect(mockFs.files.has('/tmp/new.log')).toBe(false);
    expect(await backend.length()).toBe(0);
    expect(mockFs.files.has('/tmp/new.log')).toBe(true);
  });

  it('should handle concurrent appends with lock serialization', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/test.log', mockFs);

    // Fire multiple appends concurrently
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        backend.append({
          index: i, epochRoot: `r${i}`, timestamp: '', previousHash: null,
          hash: `h${i}`, leafCount: 1, epochIndex: i,
        }),
      );
    }

    await Promise.all(promises);
    expect(await backend.length()).toBe(10);
  });

  it('should work as a backend for TransparencyLog', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/log.ndjson', mockFs);
    const log = new TransparencyLog({ mode: 'self-hosted', backend });

    await log.append('root-0', 0, 5);
    await log.append('root-1', 1, 10);
    await log.append('root-2', 2, 15);

    expect(await log.length()).toBe(3);

    const result = await log.verify();
    expect(result.valid).toBe(true);

    // Verify data persisted in file
    const content = mockFs.files.get('/tmp/log.ndjson')!;
    expect(content).toContain('root-0');
    expect(content).toContain('root-2');
  });
});

// ─── Signed Tree Heads ──────────────────────────────────────────────────────

describe('signed tree heads', () => {
  it('should sign and verify a tree head', async () => {
    const log = await populateLog(3);
    const kp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);

    expect(sth.treeSize).toBe(3);
    expect(sth.rootHash).toBeTruthy();
    expect(sth.signature).toBeTruthy();
    expect(sth.signerPublicKey).toBe(kp.publicKeyHex);

    const valid = await verifySignedTreeHead(sth, kp.publicKeyHex);
    expect(valid).toBe(true);
  });

  it('should reject a tree head with wrong public key', async () => {
    const log = await populateLog(3);
    const kp = await generateKeyPair();
    const otherKp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);
    const valid = await verifySignedTreeHead(sth, otherKp.publicKeyHex);
    expect(valid).toBe(false);
  });

  it('should reject a tampered tree head', async () => {
    const log = await populateLog(3);
    const kp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);

    // Tamper with the root hash
    const tampered = { ...sth, rootHash: 'tampered-hash' };
    const valid = await verifySignedTreeHead(tampered, kp.publicKeyHex);
    expect(valid).toBe(false);
  });

  it('should reject a tree head with tampered tree size', async () => {
    const log = await populateLog(3);
    const kp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);
    const tampered = { ...sth, treeSize: 999 };
    const valid = await verifySignedTreeHead(tampered, kp.publicKeyHex);
    expect(valid).toBe(false);
  });

  it('should reject a tree head with tampered timestamp', async () => {
    const log = await populateLog(3);
    const kp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);
    const tampered = { ...sth, timestamp: '2000-01-01T00:00:00.000Z' };
    const valid = await verifySignedTreeHead(tampered, kp.publicKeyHex);
    expect(valid).toBe(false);
  });

  it('should throw when signing an empty log', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const kp = await generateKeyPair();

    await expect(signTreeHead(log, kp)).rejects.toThrow('empty log');
  });

  it('should set rootHash to the latest entry hash', async () => {
    const log = await populateLog(3);
    const latest = await log.getLatest();
    const kp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);
    expect(sth.rootHash).toBe(latest!.hash);
  });

  it('should include an ISO timestamp', async () => {
    const log = await populateLog(1);
    const kp = await generateKeyPair();

    const sth = await signTreeHead(log, kp);
    expect(sth.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── Witness Cosigning ───────────────────────────────────────────────────────

describe('witness cosigning', () => {
  it('should cosign a tree head with one witness', async () => {
    const log = await populateLog(3);
    const logKp = await generateKeyPair();
    const witnessKp = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    const cosigned = await cosignTreeHead(sth, witnessKp);

    expect(cosigned.witnesses).toHaveLength(1);
    expect(cosigned.witnesses[0]!.witnessPublicKey).toBe(witnessKp.publicKeyHex);
    expect(cosigned.witnesses[0]!.signature).toBeTruthy();
  });

  it('should verify witnesses against trusted keys', async () => {
    const log = await populateLog(3);
    const logKp = await generateKeyPair();
    const w1 = await generateKeyPair();
    const w2 = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    let cosigned = await cosignTreeHead(sth, w1);
    cosigned = await cosignTreeHead(cosigned, w2);

    expect(cosigned.witnesses).toHaveLength(2);

    const valid = await verifyWitnesses(
      cosigned,
      [w1.publicKeyHex, w2.publicKeyHex],
    );
    expect(valid).toBe(true);
  });

  it('should reject if witness key not in trusted set', async () => {
    const log = await populateLog(3);
    const logKp = await generateKeyPair();
    const w1 = await generateKeyPair();
    const untrusted = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    const cosigned = await cosignTreeHead(sth, w1);

    // Only trust 'untrusted' key, not w1
    const valid = await verifyWitnesses(cosigned, [untrusted.publicKeyHex]);
    expect(valid).toBe(false);
  });

  it('should reject if no witnesses present', async () => {
    const log = await populateLog(3);
    const logKp = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    const cosigned: CosignedTreeHead = { ...sth, witnesses: [] };

    const valid = await verifyWitnesses(cosigned, []);
    expect(valid).toBe(false);
  });

  it('should reject tampered witness signature', async () => {
    const log = await populateLog(3);
    const logKp = await generateKeyPair();
    const w1 = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    const cosigned = await cosignTreeHead(sth, w1);

    // Tamper with the witness signature
    const tampered: CosignedTreeHead = {
      ...cosigned,
      witnesses: [{
        ...cosigned.witnesses[0]!,
        signature: 'ff'.repeat(64), // invalid signature
      }],
    };

    const valid = await verifyWitnesses(tampered, [w1.publicKeyHex]);
    expect(valid).toBe(false);
  });

  it('should accumulate witnesses when cosigning multiple times', async () => {
    const log = await populateLog(2);
    const logKp = await generateKeyPair();
    const w1 = await generateKeyPair();
    const w2 = await generateKeyPair();
    const w3 = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    let cosigned = await cosignTreeHead(sth, w1);
    cosigned = await cosignTreeHead(cosigned, w2);
    cosigned = await cosignTreeHead(cosigned, w3);

    expect(cosigned.witnesses).toHaveLength(3);
    expect(cosigned.witnesses[0]!.witnessPublicKey).toBe(w1.publicKeyHex);
    expect(cosigned.witnesses[1]!.witnessPublicKey).toBe(w2.publicKeyHex);
    expect(cosigned.witnesses[2]!.witnessPublicKey).toBe(w3.publicKeyHex);
  });

  it('should preserve original signer info in cosigned head', async () => {
    const log = await populateLog(2);
    const logKp = await generateKeyPair();
    const wKp = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    const cosigned = await cosignTreeHead(sth, wKp);

    expect(cosigned.rootHash).toBe(sth.rootHash);
    expect(cosigned.treeSize).toBe(sth.treeSize);
    expect(cosigned.signature).toBe(sth.signature);
    expect(cosigned.signerPublicKey).toBe(sth.signerPublicKey);
  });

  it('should include a timestamp on each witness signature', async () => {
    const log = await populateLog(2);
    const logKp = await generateKeyPair();
    const wKp = await generateKeyPair();

    const sth = await signTreeHead(log, logKp);
    const cosigned = await cosignTreeHead(sth, wKp);

    expect(cosigned.witnesses[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── Tamper Monitoring ───────────────────────────────────────────────────────

describe('LogMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should report initial status as not running', () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const monitor = new LogMonitor(log);
    const status = monitor.getStatus();

    expect(status.running).toBe(false);
    expect(status.lastCheckTime).toBeNull();
    expect(status.lastCheckResult).toBeNull();
    expect(status.alertHistory).toHaveLength(0);
  });

  it('should perform an immediate check on start', async () => {
    vi.useFakeTimers();
    const log = await populateLog(3);
    const monitor = new LogMonitor(log);

    monitor.start(10000);

    // Allow the async check to complete
    await vi.advanceTimersByTimeAsync(0);

    const status = monitor.getStatus();
    expect(status.running).toBe(true);
    expect(status.lastCheckTime).toBeTruthy();
    expect(status.lastCheckResult).toBeTruthy();
    expect(status.lastCheckResult!.valid).toBe(true);

    monitor.stop();
  });

  it('should stop when stop() is called', async () => {
    vi.useFakeTimers();
    const log = await populateLog(2);
    const monitor = new LogMonitor(log);

    monitor.start(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getStatus().running).toBe(true);

    monitor.stop();
    expect(monitor.getStatus().running).toBe(false);
  });

  it('should invoke tamper callback on integrity failure', async () => {
    // Create a backend that will return tampered data
    const backend = new MemoryBackend();
    const entry: LogEntry = {
      index: 0,
      epochRoot: 'root',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousHash: null,
      hash: 'WRONG-HASH', // This will fail hash verification
      leafCount: 1,
      epochIndex: 0,
    };
    await backend.append(entry);

    const log = new TransparencyLog({ mode: 'self-hosted', backend });
    const monitor = new LogMonitor(log);

    const alerts: Array<{ errors: readonly string[] }> = [];
    monitor.onTamperDetected((alert) => {
      alerts.push(alert);
    });

    const result = await monitor.checkNow();
    expect(result.valid).toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.errors.length).toBeGreaterThan(0);
  });

  it('should record alert history', async () => {
    const backend = new MemoryBackend();
    await backend.append({
      index: 0, epochRoot: 'root', timestamp: '2025-01-01T00:00:00.000Z',
      previousHash: null, hash: 'BAD-HASH', leafCount: 1, epochIndex: 0,
    });

    const log = new TransparencyLog({ mode: 'self-hosted', backend });
    const monitor = new LogMonitor(log);

    await monitor.checkNow();
    await monitor.checkNow();

    const status = monitor.getStatus();
    expect(status.alertHistory).toHaveLength(2);
  });

  it('should throw if started twice', async () => {
    vi.useFakeTimers();
    const log = await populateLog(1);
    const monitor = new LogMonitor(log);

    monitor.start(5000);
    await vi.advanceTimersByTimeAsync(0);

    expect(() => monitor.start(5000)).toThrow('already running');
    monitor.stop();
  });

  it('should throw for non-positive interval', () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const monitor = new LogMonitor(log);

    expect(() => monitor.start(0)).toThrow('positive');
    expect(() => monitor.start(-100)).toThrow('positive');
  });

  it('should not alert on valid log', async () => {
    const log = await populateLog(5);
    const monitor = new LogMonitor(log);

    const alerts: unknown[] = [];
    monitor.onTamperDetected((a) => alerts.push(a));

    await monitor.checkNow();

    expect(alerts).toHaveLength(0);
    expect(monitor.getStatus().alertHistory).toHaveLength(0);
  });

  it('should swallow callback errors without crashing', async () => {
    const backend = new MemoryBackend();
    await backend.append({
      index: 0, epochRoot: 'root', timestamp: '2025-01-01T00:00:00.000Z',
      previousHash: null, hash: 'WRONG', leafCount: 1, epochIndex: 0,
    });

    const log = new TransparencyLog({ mode: 'self-hosted', backend });
    const monitor = new LogMonitor(log);

    monitor.onTamperDetected(() => {
      throw new Error('callback crash');
    });

    // Should not throw
    const result = await monitor.checkNow();
    expect(result.valid).toBe(false);
  });
});

// ─── Log Compaction ──────────────────────────────────────────────────────────

describe('compactLog', () => {
  it('should create a checkpoint and retain entries after the index', async () => {
    const log = await populateLog(5);
    const { checkpoint, retainedEntries } = await compactLog(log, 2);

    expect(checkpoint.compactedThrough).toBe(2);
    expect(checkpoint.compactedCount).toBe(3); // indices 0, 1, 2
    expect(checkpoint.checkpointHash).toBeTruthy();
    expect(retainedEntries).toHaveLength(2); // indices 3, 4
    expect(retainedEntries[0]!.index).toBe(3);
    expect(retainedEntries[1]!.index).toBe(4);
  });

  it('should include the last compacted entry hash', async () => {
    const log = await populateLog(5);
    const entry2 = await log.get(2);
    const { checkpoint } = await compactLog(log, 2);

    expect(checkpoint.lastCompactedEntryHash).toBe(entry2!.hash);
  });

  it('should retain all entries if retainAfterIndex is 0', async () => {
    const log = await populateLog(5);
    const { checkpoint, retainedEntries } = await compactLog(log, 0);

    expect(checkpoint.compactedThrough).toBe(0);
    expect(checkpoint.compactedCount).toBe(1);
    expect(retainedEntries).toHaveLength(4);
  });

  it('should retain no entries if retainAfterIndex is last index', async () => {
    const log = await populateLog(5);
    const { checkpoint, retainedEntries } = await compactLog(log, 4);

    expect(checkpoint.compactedThrough).toBe(4);
    expect(checkpoint.compactedCount).toBe(5);
    expect(retainedEntries).toHaveLength(0);
  });

  it('should produce deterministic checkpoint hashes', async () => {
    const log = await populateLog(5);
    const { checkpoint: c1 } = await compactLog(log, 2);
    const { checkpoint: c2 } = await compactLog(log, 2);

    // Checkpoint hash is derived from compacted entry hashes, so should be identical
    expect(c1.checkpointHash).toBe(c2.checkpointHash);
  });

  it('should throw on empty log', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    await expect(compactLog(log, 0)).rejects.toThrow('empty log');
  });

  it('should throw if retainAfterIndex is negative', async () => {
    const log = await populateLog(3);
    await expect(compactLog(log, -1)).rejects.toThrow('non-negative');
  });

  it('should throw if retainAfterIndex exceeds log length', async () => {
    const log = await populateLog(3);
    await expect(compactLog(log, 10)).rejects.toThrow('less than log length');
  });

  it('should include a timestamp in the checkpoint', async () => {
    const log = await populateLog(3);
    const { checkpoint } = await compactLog(log, 1);
    expect(checkpoint.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should produce different checkpoint hashes for different compaction points', async () => {
    const log = await populateLog(5);
    const { checkpoint: c1 } = await compactLog(log, 1);
    const { checkpoint: c2 } = await compactLog(log, 3);

    expect(c1.checkpointHash).not.toBe(c2.checkpointHash);
  });
});

// ─── Log Statistics ──────────────────────────────────────────────────────────

describe('logStats', () => {
  it('should return zeros for empty log', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const stats = await logStats(log);

    expect(stats.entryCount).toBe(0);
    expect(stats.timeSpanMs).toBe(0);
    expect(stats.averageEntriesPerEpoch).toBe(0);
    expect(stats.totalLeavesRecorded).toBe(0);
  });

  it('should compute correct entry count', async () => {
    const log = await populateLog(5);
    const stats = await logStats(log);
    expect(stats.entryCount).toBe(5);
  });

  it('should compute total leaves from all entries', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    await log.append('r0', 0, 10);
    await log.append('r1', 1, 20);
    await log.append('r2', 2, 30);

    const stats = await logStats(log);
    expect(stats.totalLeavesRecorded).toBe(60);
  });

  it('should compute average entries per epoch', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    // 4 entries across 2 unique epoch indices
    await log.append('r0', 0, 5);
    await log.append('r1', 0, 5);
    await log.append('r2', 1, 5);
    await log.append('r3', 1, 5);

    const stats = await logStats(log);
    expect(stats.averageEntriesPerEpoch).toBe(2); // 4 entries / 2 epochs
  });

  it('should compute time span for multi-entry log', async () => {
    const log = await populateLog(3);
    const stats = await logStats(log);
    // Time span should be >= 0 (entries are created nearly simultaneously)
    expect(stats.timeSpanMs).toBeGreaterThanOrEqual(0);
  });

  it('should return timeSpanMs of 0 for single-entry log', async () => {
    const log = await populateLog(1);
    const stats = await logStats(log);
    expect(stats.timeSpanMs).toBe(0);
  });
});

// ─── HTTP API Routes ─────────────────────────────────────────────────────────

describe('createAPIRoutes', () => {
  it('should return route definitions for all endpoints', () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const routes = createAPIRoutes(log);

    expect(routes.length).toBeGreaterThanOrEqual(8);

    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/entries');
    expect(paths).toContain('/entries/:index');
    expect(paths).toContain('/entries/latest');
    expect(paths).toContain('/length');
    expect(paths).toContain('/proof/inclusion/:index');
    expect(paths).toContain('/proof/consistency');
    expect(paths).toContain('/verify');
  });

  it('should have POST method for append', () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const routes = createAPIRoutes(log);
    const appendRoute = routes.find((r) => r.path === '/entries' && r.method === 'POST');
    expect(appendRoute).toBeTruthy();
  });

  it('should handle append via route handler', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const routes = createAPIRoutes(log);
    const appendRoute = routes.find((r) => r.path === '/entries' && r.method === 'POST')!;

    const result = await appendRoute.handler({}, {
      epochRoot: 'test-root',
      epochIndex: 0,
      leafCount: 10,
    });

    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('index', 0);
    expect(await log.length()).toBe(1);
  });

  it('should handle get by index via route handler', async () => {
    const log = await populateLog(3);
    const routes = createAPIRoutes(log);
    const getRoute = routes.find((r) => r.path === '/entries/:index')!;

    const result = await getRoute.handler({ index: '1' }) as LogEntry;
    expect(result.index).toBe(1);
  });

  it('should return 404 for missing entry', async () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const routes = createAPIRoutes(log);
    const getRoute = routes.find((r) => r.path === '/entries/:index')!;

    const result = await getRoute.handler({ index: '99' }) as { error: string; status: number };
    expect(result.status).toBe(404);
  });

  it('should handle length query', async () => {
    const log = await populateLog(4);
    const routes = createAPIRoutes(log);
    const lengthRoute = routes.find((r) => r.path === '/length')!;

    const result = await lengthRoute.handler({}) as { length: number };
    expect(result.length).toBe(4);
  });

  it('should handle verify query', async () => {
    const log = await populateLog(3);
    const routes = createAPIRoutes(log);
    const verifyRoute = routes.find((r) => r.path === '/verify')!;

    const result = await verifyRoute.handler({}) as { valid: boolean };
    expect(result.valid).toBe(true);
  });

  it('should include descriptions on all routes', () => {
    const log = new TransparencyLog({ mode: 'self-hosted' });
    const routes = createAPIRoutes(log);

    for (const route of routes) {
      expect(route.description).toBeTruthy();
      expect(route.description.length).toBeGreaterThan(0);
    }
  });
});

// ─── Serialization ───────────────────────────────────────────────────────────

describe('serialization', () => {
  describe('serializeLogEntry / deserializeLogEntry', () => {
    it('should round-trip a log entry', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });
      const entry = await log.append('root-x', 0, 25);

      const serialized = serializeLogEntry(entry);
      const deserialized = deserializeLogEntry(serialized);

      expect(deserialized.index).toBe(entry.index);
      expect(deserialized.epochRoot).toBe(entry.epochRoot);
      expect(deserialized.timestamp).toBe(entry.timestamp);
      expect(deserialized.previousHash).toBe(entry.previousHash);
      expect(deserialized.hash).toBe(entry.hash);
      expect(deserialized.leafCount).toBe(entry.leafCount);
      expect(deserialized.epochIndex).toBe(entry.epochIndex);
    });

    it('should round-trip through JSON', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });
      await log.append('root-a', 0, 10);
      const entry = await log.append('root-b', 1, 20);

      const json = JSON.stringify(serializeLogEntry(entry));
      const parsed = JSON.parse(json);
      const deserialized = deserializeLogEntry(parsed);

      expect(deserialized).toEqual(entry);
    });

    it('should reject non-object input', () => {
      expect(() => deserializeLogEntry(null)).toThrow('expected an object');
      expect(() => deserializeLogEntry('string')).toThrow('expected an object');
      expect(() => deserializeLogEntry(42)).toThrow('expected an object');
    });

    it('should reject input with missing fields', () => {
      expect(() => deserializeLogEntry({})).toThrow('missing or invalid "index"');
      expect(() => deserializeLogEntry({ index: 0 })).toThrow('missing or invalid "epochRoot"');
    });

    it('should reject previousHash that is neither string nor null', () => {
      expect(() =>
        deserializeLogEntry({
          index: 0, epochRoot: 'r', timestamp: 'ts', previousHash: 123,
        }),
      ).toThrow('"previousHash" must be a string or null');
    });

    it('should reject input with wrong field types', () => {
      expect(() =>
        deserializeLogEntry({
          index: 'not-a-number', epochRoot: 'r', timestamp: 'ts',
          previousHash: null, hash: 'h', leafCount: 5, epochIndex: 0,
        }),
      ).toThrow('missing or invalid "index"');
    });

    it('should handle entry with non-null previousHash', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });
      await log.append('root-a', 0, 10);
      const entry = await log.append('root-b', 1, 20);

      expect(entry.previousHash).not.toBeNull();

      const serialized = serializeLogEntry(entry);
      const deserialized = deserializeLogEntry(serialized);
      expect(deserialized.previousHash).toBe(entry.previousHash);
    });
  });

  describe('serializeLog / deserializeLog', () => {
    it('should round-trip a full log', async () => {
      const log = await populateLog(4);

      const serialized = await serializeLog(log);
      expect(serialized.version).toBe(1);
      expect(serialized.entryCount).toBe(4);
      expect(serialized.logId).toBe('default');
      expect(serialized.mode).toBe('self-hosted');
      expect(serialized.entries).toHaveLength(4);

      const restored = await deserializeLog(serialized);
      expect(await restored.length()).toBe(4);

      const result = await restored.verify();
      expect(result.valid).toBe(true);
    });

    it('should round-trip through JSON', async () => {
      const log = await populateLog(3);

      const serialized = await serializeLog(log);
      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);
      const restored = await deserializeLog(parsed);

      expect(await restored.length()).toBe(3);
      const result = await restored.verify();
      expect(result.valid).toBe(true);
    });

    it('should preserve logId and mode', async () => {
      const log = new TransparencyLog({ mode: 'managed', logId: 'test-log-42' });
      await log.append('r0', 0, 1);

      const serialized = await serializeLog(log);
      const restored = await deserializeLog(serialized);

      expect(restored.logId).toBe('test-log-42');
      expect(restored.mode).toBe('managed');
    });

    it('should serialize an empty log', async () => {
      const log = new TransparencyLog({ mode: 'self-hosted' });

      const serialized = await serializeLog(log);
      expect(serialized.entryCount).toBe(0);
      expect(serialized.entries).toHaveLength(0);

      const restored = await deserializeLog(serialized);
      expect(await restored.length()).toBe(0);
    });

    it('should include a serializedAt timestamp', async () => {
      const log = await populateLog(1);
      const serialized = await serializeLog(log);
      expect(serialized.serializedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should reject non-object input', async () => {
      await expect(deserializeLog(null)).rejects.toThrow('expected an object');
      await expect(deserializeLog('nope')).rejects.toThrow('expected an object');
    });

    it('should reject unsupported version', async () => {
      await expect(deserializeLog({ version: 2 })).rejects.toThrow('unsupported version');
      await expect(deserializeLog({ version: 'a' })).rejects.toThrow('unsupported version');
    });

    it('should reject missing logId', async () => {
      await expect(
        deserializeLog({ version: 1, mode: 'self-hosted', entries: [] }),
      ).rejects.toThrow('missing or invalid "logId"');
    });

    it('should reject invalid mode', async () => {
      await expect(
        deserializeLog({ version: 1, logId: 'x', mode: 'invalid', entries: [] }),
      ).rejects.toThrow('invalid "mode"');
    });

    it('should reject non-array entries', async () => {
      await expect(
        deserializeLog({ version: 1, logId: 'x', mode: 'self-hosted', entries: 'not-array' }),
      ).rejects.toThrow('"entries" must be an array');
    });

    it('should preserve all entry data through serialization', async () => {
      const log = await populateLog(3);
      const originalEntries = await log.getRange(0, 3);

      const serialized = await serializeLog(log);
      const restored = await deserializeLog(serialized);
      const restoredEntries = await restored.getRange(0, 3);

      for (let i = 0; i < 3; i++) {
        expect(restoredEntries[i]!.hash).toBe(originalEntries[i]!.hash);
        expect(restoredEntries[i]!.epochRoot).toBe(originalEntries[i]!.epochRoot);
        expect(restoredEntries[i]!.previousHash).toBe(originalEntries[i]!.previousHash);
      }
    });
  });
});

// ─── Integration: end-to-end flow ────────────────────────────────────────────

describe('integration', () => {
  it('should support full lifecycle: append, prove, sign, cosign, verify', async () => {
    // 1. Create and populate log
    const log = await populateLog(5);

    // 2. Verify integrity
    const verification = await log.verify();
    expect(verification.valid).toBe(true);

    // 3. Generate inclusion proof
    const inclusionProof = await log.generateInclusionProof(2);
    expect(verifyLogInclusionProof(inclusionProof)).toBe(true);

    // 4. Generate consistency proof
    const consistencyProof = await log.generateConsistencyProof(3, 5);
    expect(verifyConsistencyProof(consistencyProof)).toBe(true);

    // 5. Sign tree head
    const logKp = await generateKeyPair();
    const sth = await signTreeHead(log, logKp);
    expect(await verifySignedTreeHead(sth, logKp.publicKeyHex)).toBe(true);

    // 6. Witness cosign
    const w1 = await generateKeyPair();
    const w2 = await generateKeyPair();
    let cosigned = await cosignTreeHead(sth, w1);
    cosigned = await cosignTreeHead(cosigned, w2);
    expect(await verifyWitnesses(cosigned, [w1.publicKeyHex, w2.publicKeyHex])).toBe(true);

    // 7. Compact
    const { checkpoint, retainedEntries } = await compactLog(log, 2);
    expect(checkpoint.compactedCount).toBe(3);
    expect(retainedEntries).toHaveLength(2);

    // 8. Stats
    const stats = await logStats(log);
    expect(stats.entryCount).toBe(5);
    expect(stats.totalLeavesRecorded).toBe(10 + 20 + 30 + 40 + 50);
  });

  it('should support file backend with full verification', async () => {
    const mockFs = createMockFs();
    const backend = new FileBackend('/tmp/integration.log', mockFs);
    const log = new TransparencyLog({ mode: 'self-hosted', backend });

    // Populate
    for (let i = 0; i < 5; i++) {
      await log.append(`root-${i}`, i, (i + 1) * 5);
    }

    // Verify
    const result = await log.verify();
    expect(result.valid).toBe(true);

    // Inclusion proof
    const proof = await log.generateInclusionProof(1);
    expect(verifyLogInclusionProof(proof)).toBe(true);

    // Consistency proof
    const cproof = await log.generateConsistencyProof(2, 5);
    expect(verifyConsistencyProof(cproof)).toBe(true);
  });
});
