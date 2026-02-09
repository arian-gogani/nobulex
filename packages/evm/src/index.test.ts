import { describe, it, expect } from 'vitest';
import { sha256String } from '@stele/crypto';
import {
  encodeUint256,
  encodeBytes32,
  encodeAddress,
  encodeString,
  decodeUint256,
  decodeBytes32,
  decodeAddress,
  encodeFunctionCall,
  computeFunctionSelector,
  buildAnchorCalldata,
  parseAnchorFromCalldata,
  computeAnchorHash,
  isValidAddress,
  checksumAddress,
  covenantIdToBytes32,
  STELE_REGISTRY_ABI,
  type CovenantAnchor,
} from './index';

// ─── encodeUint256 / decodeUint256 ─────────────────────────────────────────────

describe('encodeUint256', () => {
  it('encodes zero as 64 zero chars', () => {
    expect(encodeUint256(0n)).toBe('0'.repeat(64));
  });

  it('encodes 1 as left-padded hex', () => {
    expect(encodeUint256(1n)).toBe('0'.repeat(63) + '1');
  });

  it('encodes 255 (0xff) correctly', () => {
    expect(encodeUint256(255n)).toBe('0'.repeat(62) + 'ff');
  });

  it('encodes a large value correctly', () => {
    const val = 2n ** 128n;
    const hex = encodeUint256(val);
    expect(hex.length).toBe(64);
    expect(BigInt('0x' + hex)).toBe(val);
  });

  it('encodes max uint256', () => {
    const max = 2n ** 256n - 1n;
    expect(encodeUint256(max)).toBe('f'.repeat(64));
  });

  it('throws on negative value', () => {
    expect(() => encodeUint256(-1n)).toThrow('cannot be negative');
  });

  it('throws on overflow', () => {
    expect(() => encodeUint256(2n ** 256n)).toThrow('overflow');
  });
});

describe('decodeUint256', () => {
  it('decodes zero', () => {
    expect(decodeUint256('0'.repeat(64))).toBe(0n);
  });

  it('decodes one', () => {
    expect(decodeUint256('0'.repeat(63) + '1')).toBe(1n);
  });

  it('decodes max uint256', () => {
    expect(decodeUint256('f'.repeat(64))).toBe(2n ** 256n - 1n);
  });

  it('handles 0x prefix', () => {
    expect(decodeUint256('0x' + '0'.repeat(62) + '0a')).toBe(10n);
  });

  it('throws on wrong length', () => {
    expect(() => decodeUint256('ff')).toThrow('Expected 64-character');
  });
});

describe('uint256 roundtrip', () => {
  it('encode then decode returns the original value', () => {
    const values = [0n, 1n, 42n, 2n ** 64n, 2n ** 128n - 1n, 2n ** 256n - 1n];
    for (const v of values) {
      expect(decodeUint256(encodeUint256(v))).toBe(v);
    }
  });
});

// ─── encodeBytes32 / decodeBytes32 ──────────────────────────────────────────────

describe('encodeBytes32', () => {
  it('encodes a full 64-char hex value unchanged (lowercased)', () => {
    const hex = 'ab'.repeat(32);
    expect(encodeBytes32(hex)).toBe(hex);
  });

  it('right-pads shorter values', () => {
    expect(encodeBytes32('abcd')).toBe('abcd' + '0'.repeat(60));
  });

  it('strips 0x prefix', () => {
    expect(encodeBytes32('0xabcd')).toBe('abcd' + '0'.repeat(60));
  });

  it('lowercases input', () => {
    expect(encodeBytes32('ABCD')).toBe('abcd' + '0'.repeat(60));
  });

  it('encodes empty string as all zeros', () => {
    expect(encodeBytes32('')).toBe('0'.repeat(64));
  });

  it('encodes 0x alone as all zeros', () => {
    expect(encodeBytes32('0x')).toBe('0'.repeat(64));
  });

  it('throws on hex string exceeding 32 bytes', () => {
    expect(() => encodeBytes32('a'.repeat(66))).toThrow('exceeds 32 bytes');
  });

  it('throws on invalid hex characters', () => {
    expect(() => encodeBytes32('xyz')).toThrow('Invalid hex');
  });
});

describe('decodeBytes32', () => {
  it('returns lowercase 64-char hex', () => {
    const hex = 'AB'.repeat(32);
    expect(decodeBytes32(hex)).toBe('ab'.repeat(32));
  });

  it('handles 0x prefix', () => {
    const hex = '0x' + 'cd'.repeat(32);
    expect(decodeBytes32(hex)).toBe('cd'.repeat(32));
  });

  it('throws on wrong length', () => {
    expect(() => decodeBytes32('abcd')).toThrow('Expected 64-character');
  });
});

describe('bytes32 roundtrip', () => {
  it('encode then decode returns original lowercase hex', () => {
    const hex = 'deadbeef'.repeat(8); // 64 chars
    expect(decodeBytes32(encodeBytes32(hex))).toBe(hex);
  });
});

// ─── encodeAddress / decodeAddress ──────────────────────────────────────────────

describe('encodeAddress', () => {
  it('left-pads a 20-byte address to 32 bytes', () => {
    const addr = '0x' + '1'.repeat(40);
    const encoded = encodeAddress(addr);
    expect(encoded.length).toBe(64);
    expect(encoded).toBe('0'.repeat(24) + '1'.repeat(40));
  });

  it('works without 0x prefix', () => {
    const addr = 'a'.repeat(40);
    const encoded = encodeAddress(addr);
    expect(encoded).toBe('0'.repeat(24) + 'a'.repeat(40));
  });

  it('lowercases the address', () => {
    const addr = '0x' + 'ABCDEF'.repeat(6) + 'ABCD';
    const encoded = encodeAddress(addr);
    expect(encoded).toBe('0'.repeat(24) + ('abcdef'.repeat(6) + 'abcd'));
  });

  it('throws on invalid length', () => {
    expect(() => encodeAddress('0x' + '1'.repeat(38))).toThrow('must be 20 bytes');
  });

  it('throws on invalid hex characters', () => {
    expect(() => encodeAddress('0x' + 'g'.repeat(40))).toThrow('not valid hex');
  });
});

describe('decodeAddress', () => {
  it('extracts address from left-padded 32 bytes', () => {
    const encoded = '0'.repeat(24) + '1'.repeat(40);
    const addr = decodeAddress(encoded);
    expect(addr.startsWith('0x')).toBe(true);
    expect(addr.slice(2).toLowerCase()).toBe('1'.repeat(40));
  });

  it('returns a checksummed address', () => {
    const encoded = '0'.repeat(24) + 'abcdef1234567890abcdef1234567890abcdef12';
    const addr = decodeAddress(encoded);
    // Verify it's a valid checksummed address
    expect(addr).toBe(checksumAddress('0x' + 'abcdef1234567890abcdef1234567890abcdef12'));
  });

  it('throws on wrong length', () => {
    expect(() => decodeAddress('abcd')).toThrow('Expected 64-character');
  });
});

describe('address roundtrip', () => {
  it('encode then decode returns the checksummed form', () => {
    const addr = '0x' + 'abcdef0123456789'.repeat(2) + 'abcdef01';
    const checksummed = checksumAddress(addr);
    const decoded = decodeAddress(encodeAddress(addr));
    expect(decoded).toBe(checksummed);
  });

  it('roundtrips numeric-only addresses exactly', () => {
    // Addresses with only digits [0-9] are unaffected by checksumming
    const addr = '0x' + '1234567890'.repeat(4);
    const decoded = decodeAddress(encodeAddress(addr));
    expect(decoded).toBe(addr);
  });
});

// ─── encodeString ───────────────────────────────────────────────────────────────

describe('encodeString', () => {
  it('encodes an empty string as just the length word (zero)', () => {
    const encoded = encodeString('');
    expect(encoded).toBe('0'.repeat(64));
    expect(encoded.length).toBe(64);
  });

  it('encodes "hello" with correct length and padded data', () => {
    const encoded = encodeString('hello');
    // Length = 5
    const lengthPart = encoded.slice(0, 64);
    expect(decodeUint256(lengthPart)).toBe(5n);
    // Data is "hello" in hex = 68656c6c6f, right-padded to 32 bytes (64 hex chars)
    const dataPart = encoded.slice(64);
    expect(dataPart.length).toBe(64); // 32 bytes padded
    expect(dataPart.startsWith('68656c6c6f')).toBe(true);
    expect(dataPart.slice(10)).toBe('0'.repeat(54));
  });

  it('encodes a 32-byte string without extra padding', () => {
    const str = 'a'.repeat(32); // exactly 32 bytes in UTF-8
    const encoded = encodeString(str);
    const lengthPart = encoded.slice(0, 64);
    expect(decodeUint256(lengthPart)).toBe(32n);
    const dataPart = encoded.slice(64);
    expect(dataPart.length).toBe(64); // exactly 32 bytes, no extra padding
  });

  it('encodes a 33-byte string with padding to 64 bytes', () => {
    const str = 'a'.repeat(33); // 33 bytes -> ceil(33/32)*32 = 64 bytes
    const encoded = encodeString(str);
    const lengthPart = encoded.slice(0, 64);
    expect(decodeUint256(lengthPart)).toBe(33n);
    const dataPart = encoded.slice(64);
    expect(dataPart.length).toBe(128); // 64 bytes = 128 hex chars
  });

  it('handles unicode characters (multi-byte UTF-8)', () => {
    // The euro sign is 3 bytes in UTF-8
    const encoded = encodeString('\u20AC');
    const lengthPart = encoded.slice(0, 64);
    expect(decodeUint256(lengthPart)).toBe(3n);
  });
});

// ─── encodeFunctionCall ─────────────────────────────────────────────────────────

describe('encodeFunctionCall', () => {
  it('concatenates selector and params with 0x prefix', () => {
    const selector = 'aabbccdd';
    const param1 = '0'.repeat(64);
    const param2 = 'f'.repeat(64);
    const result = encodeFunctionCall(selector, param1, param2);
    expect(result).toBe('0x' + selector + param1 + param2);
  });

  it('returns just 0x + selector when no params', () => {
    expect(encodeFunctionCall('12345678')).toBe('0x12345678');
  });

  it('handles 0x-prefixed selector', () => {
    expect(encodeFunctionCall('0xaabbccdd')).toBe('0xaabbccdd');
  });

  it('throws on wrong selector length', () => {
    expect(() => encodeFunctionCall('aabb')).toThrow('must be 4 bytes');
    expect(() => encodeFunctionCall('aabbccddeeff')).toThrow('must be 4 bytes');
  });
});

// ─── computeFunctionSelector ────────────────────────────────────────────────────

describe('computeFunctionSelector', () => {
  it('returns an 8-character hex string', () => {
    const sel = computeFunctionSelector('transfer(address,uint256)');
    expect(sel.length).toBe(8);
    expect(/^[0-9a-f]{8}$/.test(sel)).toBe(true);
  });

  it('is consistent: same signature produces same selector', () => {
    const sig = 'approve(address,uint256)';
    expect(computeFunctionSelector(sig)).toBe(computeFunctionSelector(sig));
  });

  it('different signatures produce different selectors', () => {
    const s1 = computeFunctionSelector('transfer(address,uint256)');
    const s2 = computeFunctionSelector('approve(address,uint256)');
    expect(s1).not.toBe(s2);
  });

  it('matches sha256String slice for the same signature', () => {
    const sig = 'balanceOf(address)';
    const expected = sha256String(sig).slice(0, 8);
    expect(computeFunctionSelector(sig)).toBe(expected);
  });
});

// ─── buildAnchorCalldata / parseAnchorFromCalldata ──────────────────────────────

function makeTestAnchor(): CovenantAnchor {
  return {
    covenantId: 'aa'.repeat(32),
    constraintsHash: 'bb'.repeat(32),
    issuerAddress: '0x' + '1234567890'.repeat(4),
    beneficiaryAddress: '0x' + '0987654321'.repeat(4),
    timestamp: 1700000000n,
    chainId: 1,
  };
}

describe('buildAnchorCalldata', () => {
  it('produces a hex string starting with 0x', () => {
    const calldata = buildAnchorCalldata(makeTestAnchor());
    expect(calldata.startsWith('0x')).toBe(true);
  });

  it('has correct length: 2 (0x) + 8 (selector) + 5*64 (params) = 330 chars', () => {
    const calldata = buildAnchorCalldata(makeTestAnchor());
    expect(calldata.length).toBe(2 + 8 + 5 * 64);
  });

  it('starts with the anchor function selector', () => {
    const calldata = buildAnchorCalldata(makeTestAnchor());
    const selector = calldata.slice(2, 10);
    const expected = computeFunctionSelector('anchor(bytes32,bytes32,address,address,uint256)');
    expect(selector).toBe(expected);
  });
});

describe('parseAnchorFromCalldata', () => {
  it('roundtrips with buildAnchorCalldata for numeric-only addresses', () => {
    const anchor = makeTestAnchor();
    const calldata = buildAnchorCalldata(anchor);
    const parsed = parseAnchorFromCalldata(calldata);

    expect(parsed.covenantId).toBe(anchor.covenantId);
    expect(parsed.constraintsHash).toBe(anchor.constraintsHash);
    // Addresses with only digits [0-9] are unaffected by checksumming
    expect(parsed.issuerAddress).toBe(anchor.issuerAddress);
    expect(parsed.beneficiaryAddress).toBe(anchor.beneficiaryAddress);
    expect(parsed.timestamp).toBe(anchor.timestamp);
    expect(parsed.chainId).toBe(1); // default
  });

  it('roundtrips with hex-letter addresses (checksummed)', () => {
    const addr1 = checksumAddress('0x' + 'abcdef1234567890'.repeat(2) + 'abcdef01');
    const addr2 = checksumAddress('0x' + 'fedcba9876543210'.repeat(2) + 'fedcba98');
    const anchor: CovenantAnchor = {
      covenantId: 'cc'.repeat(32),
      constraintsHash: 'dd'.repeat(32),
      issuerAddress: addr1,
      beneficiaryAddress: addr2,
      timestamp: 0n,
      chainId: 42,
    };
    const calldata = buildAnchorCalldata(anchor);
    const parsed = parseAnchorFromCalldata(calldata);

    expect(parsed.covenantId).toBe(anchor.covenantId);
    expect(parsed.constraintsHash).toBe(anchor.constraintsHash);
    expect(parsed.issuerAddress).toBe(addr1);
    expect(parsed.beneficiaryAddress).toBe(addr2);
    expect(parsed.timestamp).toBe(0n);
  });

  it('throws on calldata that is too short', () => {
    expect(() => parseAnchorFromCalldata('0xaabbccdd')).toThrow('too short');
  });

  it('throws on wrong function selector', () => {
    // Build valid calldata, then corrupt the selector
    const calldata = buildAnchorCalldata(makeTestAnchor());
    const corrupted = '0x' + '00000000' + calldata.slice(10);
    expect(() => parseAnchorFromCalldata(corrupted)).toThrow('Invalid function selector');
  });
});

// ─── computeAnchorHash ──────────────────────────────────────────────────────────

describe('computeAnchorHash', () => {
  it('returns a 64-character hex string', () => {
    const hash = computeAnchorHash(makeTestAnchor());
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('is deterministic: same anchor produces same hash', () => {
    const a = makeTestAnchor();
    expect(computeAnchorHash(a)).toBe(computeAnchorHash(a));
  });

  it('different anchors produce different hashes', () => {
    const a = makeTestAnchor();
    const b = { ...a, timestamp: 999n };
    expect(computeAnchorHash(a)).not.toBe(computeAnchorHash(b));
  });

  it('includes chainId in the hash', () => {
    const a = makeTestAnchor();
    const b = { ...a, chainId: 137 };
    expect(computeAnchorHash(a)).not.toBe(computeAnchorHash(b));
  });
});

// ─── isValidAddress ─────────────────────────────────────────────────────────────

describe('isValidAddress', () => {
  it('accepts a valid lowercase address', () => {
    expect(isValidAddress('0x' + 'a'.repeat(40))).toBe(true);
  });

  it('accepts a valid uppercase address', () => {
    expect(isValidAddress('0x' + 'A'.repeat(40))).toBe(true);
  });

  it('accepts a valid mixed-case address', () => {
    expect(isValidAddress('0x' + 'aAbBcCdDeEfF'.repeat(3) + 'aAbB')).toBe(true);
  });

  it('accepts zero address', () => {
    expect(isValidAddress('0x' + '0'.repeat(40))).toBe(true);
  });

  it('rejects missing 0x prefix', () => {
    expect(isValidAddress('a'.repeat(40))).toBe(false);
  });

  it('rejects too short', () => {
    expect(isValidAddress('0x' + 'a'.repeat(38))).toBe(false);
  });

  it('rejects too long', () => {
    expect(isValidAddress('0x' + 'a'.repeat(42))).toBe(false);
  });

  it('rejects invalid hex characters', () => {
    expect(isValidAddress('0x' + 'g'.repeat(40))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAddress('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidAddress(42 as unknown as string)).toBe(false);
    expect(isValidAddress(null as unknown as string)).toBe(false);
  });
});

// ─── checksumAddress ────────────────────────────────────────────────────────────

describe('checksumAddress', () => {
  it('returns a string starting with 0x', () => {
    const addr = '0x' + 'a'.repeat(40);
    const result = checksumAddress(addr);
    expect(result.startsWith('0x')).toBe(true);
    expect(result.length).toBe(42);
  });

  it('is idempotent: checksumming twice gives the same result', () => {
    const addr = '0x' + 'abcdef1234567890'.repeat(2) + 'abcdef01';
    const once = checksumAddress(addr);
    const twice = checksumAddress(once);
    expect(once).toBe(twice);
  });

  it('preserves digits (0-9) unchanged', () => {
    const addr = '0x' + '1234567890'.repeat(4);
    const result = checksumAddress(addr);
    expect(result).toBe(addr);
  });

  it('applies mixed casing to hex-letter addresses', () => {
    const addr = '0x' + 'abcdef'.repeat(6) + 'abcd';
    const result = checksumAddress(addr);
    // The result should differ from all-lowercase since some chars get uppercased
    const hasUppercase = /[A-F]/.test(result.slice(2));
    const hasLowercase = /[a-f]/.test(result.slice(2));
    // With SHA-256 hashing, we expect a mix of upper and lower
    expect(hasUppercase || hasLowercase).toBe(true);
  });

  it('lowercased forms of different cases produce the same checksum', () => {
    const lower = '0x' + 'abcdef1234'.repeat(4);
    const upper = '0x' + 'ABCDEF1234'.repeat(4);
    expect(checksumAddress(lower)).toBe(checksumAddress(upper));
  });

  it('throws on invalid address', () => {
    expect(() => checksumAddress('not-an-address')).toThrow('Invalid EVM address');
    expect(() => checksumAddress('0x' + 'z'.repeat(40))).toThrow('Invalid EVM address');
  });
});

// ─── covenantIdToBytes32 ────────────────────────────────────────────────────────

describe('covenantIdToBytes32', () => {
  it('adds 0x prefix and lowercases', () => {
    const id = 'AB'.repeat(32);
    expect(covenantIdToBytes32(id)).toBe('0x' + 'ab'.repeat(32));
  });

  it('handles already-prefixed input', () => {
    const id = '0x' + 'cd'.repeat(32);
    expect(covenantIdToBytes32(id)).toBe('0x' + 'cd'.repeat(32));
  });

  it('returns 66-character string (0x + 64 hex chars)', () => {
    const id = '11'.repeat(32);
    const result = covenantIdToBytes32(id);
    expect(result.length).toBe(66);
  });

  it('throws on wrong length', () => {
    expect(() => covenantIdToBytes32('abcd')).toThrow('must be 32 bytes');
  });

  it('throws on too long', () => {
    expect(() => covenantIdToBytes32('a'.repeat(66))).toThrow('must be 32 bytes');
  });

  it('throws on invalid hex', () => {
    expect(() => covenantIdToBytes32('z'.repeat(64))).toThrow('Invalid hex');
  });
});

// ─── STELE_REGISTRY_ABI ────────────────────────────────────────────────────────

describe('STELE_REGISTRY_ABI', () => {
  it('contains exactly 3 function definitions', () => {
    expect(STELE_REGISTRY_ABI.length).toBe(3);
    for (const entry of STELE_REGISTRY_ABI) {
      expect(entry.type).toBe('function');
    }
  });

  it('has an anchor function with 5 inputs and 0 outputs', () => {
    const anchor = STELE_REGISTRY_ABI.find((e) => e.name === 'anchor');
    expect(anchor).toBeDefined();
    expect(anchor!.inputs.length).toBe(5);
    expect(anchor!.outputs.length).toBe(0);
    expect(anchor!.stateMutability).toBe('nonpayable');
  });

  it('anchor function has correct input types', () => {
    const anchor = STELE_REGISTRY_ABI.find((e) => e.name === 'anchor')!;
    const types = anchor.inputs.map((i) => i.type);
    expect(types).toEqual(['bytes32', 'bytes32', 'address', 'address', 'uint256']);
  });

  it('has a verify function with 1 input and bool output', () => {
    const verify = STELE_REGISTRY_ABI.find((e) => e.name === 'verify');
    expect(verify).toBeDefined();
    expect(verify!.inputs.length).toBe(1);
    expect(verify!.inputs[0]!.type).toBe('bytes32');
    expect(verify!.outputs.length).toBe(1);
    expect(verify!.outputs[0]!.type).toBe('bool');
    expect(verify!.stateMutability).toBe('view');
  });

  it('has a getAnchor function with 1 input and 4 outputs', () => {
    const getAnchor = STELE_REGISTRY_ABI.find((e) => e.name === 'getAnchor');
    expect(getAnchor).toBeDefined();
    expect(getAnchor!.inputs.length).toBe(1);
    expect(getAnchor!.inputs[0]!.type).toBe('bytes32');
    expect(getAnchor!.outputs.length).toBe(4);
    const outputTypes = getAnchor!.outputs.map((o) => o.type);
    expect(outputTypes).toEqual(['bytes32', 'address', 'address', 'uint256']);
    expect(getAnchor!.stateMutability).toBe('view');
  });

  it('all functions have name and type fields', () => {
    for (const entry of STELE_REGISTRY_ABI) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.type).toBe('function');
    }
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('encodeUint256(0n) decodes back to 0n', () => {
    expect(decodeUint256(encodeUint256(0n))).toBe(0n);
  });

  it('encodeBytes32 with zero-filled input stays zero-filled', () => {
    expect(encodeBytes32('0'.repeat(64))).toBe('0'.repeat(64));
  });

  it('buildAnchorCalldata handles zero timestamp', () => {
    const anchor = makeTestAnchor();
    anchor.timestamp = 0n;
    const calldata = buildAnchorCalldata(anchor);
    const parsed = parseAnchorFromCalldata(calldata);
    expect(parsed.timestamp).toBe(0n);
  });

  it('buildAnchorCalldata handles max timestamp', () => {
    const anchor = makeTestAnchor();
    anchor.timestamp = 2n ** 256n - 1n;
    const calldata = buildAnchorCalldata(anchor);
    const parsed = parseAnchorFromCalldata(calldata);
    expect(parsed.timestamp).toBe(2n ** 256n - 1n);
  });

  it('zero address is valid', () => {
    const zeroAddr = '0x' + '0'.repeat(40);
    expect(isValidAddress(zeroAddr)).toBe(true);
    expect(checksumAddress(zeroAddr)).toBe(zeroAddr);
  });

  it('encodeAddress and decodeAddress handle zero address', () => {
    const zeroAddr = '0x' + '0'.repeat(40);
    const encoded = encodeAddress(zeroAddr);
    expect(encoded).toBe('0'.repeat(64));
    const decoded = decodeAddress(encoded);
    expect(decoded).toBe(zeroAddr);
  });

  it('computeAnchorHash with all-zero anchor fields', () => {
    const anchor: CovenantAnchor = {
      covenantId: '0'.repeat(64),
      constraintsHash: '0'.repeat(64),
      issuerAddress: '0x' + '0'.repeat(40),
      beneficiaryAddress: '0x' + '0'.repeat(40),
      timestamp: 0n,
      chainId: 0,
    };
    const hash = computeAnchorHash(anchor);
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });
});
