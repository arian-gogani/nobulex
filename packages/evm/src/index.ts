/**
 * @stele/evm — EVM anchoring utilities for on-chain covenant verification.
 *
 * Provides ABI encoding/decoding, contract interface definitions, and
 * anchor/verify helpers for EVM-compatible blockchains. No ethers.js dependency.
 *
 * @packageDocumentation
 */

import { sha256String } from '@stele/crypto';

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum value for a uint256. */
const MAX_UINT256 = 2n ** 256n - 1n;

// ─── Internal Helpers ───────────────────────────────────────────────────────────

/** Strip 0x or 0X prefix from a hex string if present. */
function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
}

/** Convert a UTF-8 string to its hex representation. */
function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

// ─── ABI Encoding Utilities ─────────────────────────────────────────────────────

/**
 * ABI encode a uint256 value as a 64-character hex string, left-padded with zeros.
 * @param value - Non-negative bigint that fits in 256 bits
 * @returns 64-character hex string (no 0x prefix)
 */
export function encodeUint256(value: bigint): string {
  if (value < 0n) {
    throw new Error('uint256 cannot be negative');
  }
  if (value > MAX_UINT256) {
    throw new Error('uint256 overflow');
  }
  return value.toString(16).padStart(64, '0');
}

/**
 * ABI encode a bytes32 value. The value is right-padded to 32 bytes per ABI spec.
 * @param hex - Hex string (with or without 0x prefix), at most 64 hex chars
 * @returns 64-character hex string (no 0x prefix)
 */
export function encodeBytes32(hex: string): string {
  const clean = strip0x(hex);
  if (clean.length > 64) {
    throw new Error('bytes32 value exceeds 32 bytes');
  }
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  return clean.toLowerCase().padEnd(64, '0');
}

/**
 * ABI encode an address (20 bytes) left-padded to 32 bytes.
 * @param address - 20-byte hex address (with or without 0x prefix)
 * @returns 64-character hex string (no 0x prefix)
 */
export function encodeAddress(address: string): string {
  const clean = strip0x(address).toLowerCase();
  if (clean.length !== 40) {
    throw new Error('Invalid address: must be 20 bytes (40 hex chars)');
  }
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error('Invalid address: not valid hex');
  }
  return clean.padStart(64, '0');
}

/**
 * ABI encode a dynamic string. Returns length (32 bytes) followed by
 * the UTF-8 data right-padded to the next 32-byte boundary.
 *
 * Note: when used in a function call with mixed static/dynamic types,
 * an offset pointer must be handled separately.
 *
 * @param value - The string to encode
 * @returns Hex string: 64-char length + padded data (no 0x prefix)
 */
export function encodeString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const length = encodeUint256(BigInt(bytes.length));
  if (bytes.length === 0) {
    return length;
  }
  const paddedLength = Math.ceil(bytes.length / 32) * 32;
  let dataHex = '';
  for (let i = 0; i < bytes.length; i++) {
    dataHex += bytes[i]!.toString(16).padStart(2, '0');
  }
  dataHex = dataHex.padEnd(paddedLength * 2, '0');
  return length + dataHex;
}

// ─── ABI Decoding Utilities ─────────────────────────────────────────────────────

/**
 * Decode a 64-character hex string as a uint256 bigint.
 * @param hex - 64-character hex string (with or without 0x prefix)
 */
export function decodeUint256(hex: string): bigint {
  const clean = strip0x(hex);
  if (clean.length !== 64) {
    throw new Error('Expected 64-character hex string for uint256');
  }
  return BigInt('0x' + clean);
}

/**
 * Decode a 64-character hex string as bytes32.
 * @param hex - 64-character hex string (with or without 0x prefix)
 * @returns 64-character lowercase hex string (no 0x prefix)
 */
export function decodeBytes32(hex: string): string {
  const clean = strip0x(hex);
  if (clean.length !== 64) {
    throw new Error('Expected 64-character hex string for bytes32');
  }
  return clean.toLowerCase();
}

/**
 * Decode a 64-character hex string as an EVM address.
 * The address is extracted from the rightmost 40 characters (left-padded).
 * @param hex - 64-character hex string (with or without 0x prefix)
 * @returns Checksummed address with 0x prefix
 */
export function decodeAddress(hex: string): string {
  const clean = strip0x(hex);
  if (clean.length !== 64) {
    throw new Error('Expected 64-character hex string for address');
  }
  const addrHex = clean.slice(24);
  return checksumAddress('0x' + addrHex);
}

// ─── Function Call Utilities ────────────────────────────────────────────────────

/**
 * Concatenate a 4-byte function selector with ABI-encoded parameters.
 * @param selector - 4-byte function selector (8 hex chars, with or without 0x prefix)
 * @param params - Already ABI-encoded parameter strings (each 64 hex chars for static types)
 * @returns Hex string with 0x prefix: selector + concatenated params
 */
export function encodeFunctionCall(selector: string, ...params: string[]): string {
  const cleanSelector = strip0x(selector);
  if (cleanSelector.length !== 8) {
    throw new Error('Function selector must be 4 bytes (8 hex chars)');
  }
  return '0x' + cleanSelector + params.join('');
}

/**
 * Compute the 4-byte function selector for a Solidity function signature.
 * Uses SHA-256 as a placeholder for Keccak-256 (production EVM uses Keccak-256).
 * @param signature - Canonical function signature, e.g., "transfer(address,uint256)"
 * @returns 8-character hex string (4 bytes, no 0x prefix)
 */
export function computeFunctionSelector(signature: string): string {
  const hash = sha256String(signature);
  return hash.slice(0, 8);
}

// ─── Covenant Anchor Types ──────────────────────────────────────────────────────

/**
 * Represents an on-chain covenant anchor with all data needed for verification.
 */
export interface CovenantAnchor {
  /** Unique identifier for the covenant (64-char lowercase hex, maps to bytes32). */
  covenantId: string;
  /** Hash of the covenant's constraint document (64-char lowercase hex, maps to bytes32). */
  constraintsHash: string;
  /** EVM address of the covenant issuer (0x-prefixed, 20 bytes). */
  issuerAddress: string;
  /** EVM address of the covenant beneficiary (0x-prefixed, 20 bytes). */
  beneficiaryAddress: string;
  /** Unix timestamp of when the anchor was created. */
  timestamp: bigint;
  /** EVM chain ID where the anchor exists (e.g., 1 for mainnet). */
  chainId: number;
}

// ─── Covenant Anchor Helpers ────────────────────────────────────────────────────

/** Precomputed function selector for anchor(bytes32,bytes32,address,address,uint256). */
const ANCHOR_SELECTOR = computeFunctionSelector(
  'anchor(bytes32,bytes32,address,address,uint256)',
);

/**
 * Encode a CovenantAnchor as EVM calldata for the registry's anchor() function.
 * The chainId is not included in calldata — it is implicit from the chain.
 * @param anchor - The covenant anchor to encode
 * @returns Hex calldata string with 0x prefix
 */
export function buildAnchorCalldata(anchor: CovenantAnchor): string {
  return encodeFunctionCall(
    ANCHOR_SELECTOR,
    encodeBytes32(anchor.covenantId),
    encodeBytes32(anchor.constraintsHash),
    encodeAddress(anchor.issuerAddress),
    encodeAddress(anchor.beneficiaryAddress),
    encodeUint256(anchor.timestamp),
  );
}

/**
 * Parse EVM calldata back into a CovenantAnchor.
 * The chainId defaults to 1 (mainnet) since it is not encoded in calldata.
 * @param calldata - Hex calldata string (with or without 0x prefix)
 * @returns Decoded CovenantAnchor
 */
export function parseAnchorFromCalldata(calldata: string): CovenantAnchor {
  const data = strip0x(calldata);
  // 8 chars selector + 5 × 64 chars params = 328 chars minimum
  if (data.length < 328) {
    throw new Error('Calldata too short for anchor function');
  }
  const selector = data.slice(0, 8);
  if (selector !== ANCHOR_SELECTOR) {
    throw new Error(
      `Invalid function selector: expected ${ANCHOR_SELECTOR}, got ${selector}`,
    );
  }

  const covenantId = decodeBytes32(data.slice(8, 72));
  const constraintsHash = decodeBytes32(data.slice(72, 136));
  const issuerAddress = decodeAddress(data.slice(136, 200));
  const beneficiaryAddress = decodeAddress(data.slice(200, 264));
  const timestamp = decodeUint256(data.slice(264, 328));

  return {
    covenantId,
    constraintsHash,
    issuerAddress,
    beneficiaryAddress,
    timestamp,
    chainId: 1,
  };
}

/**
 * Compute a deterministic hash of a CovenantAnchor.
 * All fields (including chainId) are ABI-encoded, concatenated, and hashed.
 * @param anchor - The covenant anchor to hash
 * @returns 64-character lowercase hex hash string
 */
export function computeAnchorHash(anchor: CovenantAnchor): string {
  const encoded =
    encodeBytes32(anchor.covenantId) +
    encodeBytes32(anchor.constraintsHash) +
    encodeAddress(anchor.issuerAddress) +
    encodeAddress(anchor.beneficiaryAddress) +
    encodeUint256(anchor.timestamp) +
    encodeUint256(BigInt(anchor.chainId));
  return sha256String(encoded);
}

// ─── Contract ABI Definition ────────────────────────────────────────────────────

/**
 * JSON ABI array for the Stele on-chain registry contract.
 * Defines the methods: anchor(), verify(), and getAnchor().
 */
export const STELE_REGISTRY_ABI = [
  {
    name: 'anchor',
    type: 'function',
    inputs: [
      { name: 'covenantId', type: 'bytes32' },
      { name: 'constraintsHash', type: 'bytes32' },
      { name: 'issuer', type: 'address' },
      { name: 'beneficiary', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'verify',
    type: 'function',
    inputs: [{ name: 'covenantId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'getAnchor',
    type: 'function',
    inputs: [{ name: 'covenantId', type: 'bytes32' }],
    outputs: [
      { name: 'constraintsHash', type: 'bytes32' },
      { name: 'issuer', type: 'address' },
      { name: 'beneficiary', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

/**
 * TypeScript interface matching the Stele on-chain registry contract ABI.
 */
export interface SteleRegistryInterface {
  /** Anchor a covenant on-chain. */
  anchor(
    covenantId: string,
    constraintsHash: string,
    issuer: string,
    beneficiary: string,
    timestamp: bigint,
  ): void;

  /** Check whether a covenant has been anchored. */
  verify(covenantId: string): boolean;

  /** Retrieve anchor data for a covenant. */
  getAnchor(covenantId: string): {
    constraintsHash: string;
    issuer: string;
    beneficiary: string;
    timestamp: bigint;
  };
}

// ─── Address Utilities ──────────────────────────────────────────────────────────

/**
 * Check if a hex string is a valid EVM address (20 bytes with 0x prefix).
 * @param address - The string to validate
 * @returns true if the address is well-formed
 */
export function isValidAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  if (!address.startsWith('0x')) return false;
  const hex = address.slice(2);
  if (hex.length !== 40) return false;
  return /^[0-9a-fA-F]{40}$/.test(hex);
}

/**
 * Apply EIP-55 mixed-case checksum encoding to an address.
 * Uses SHA-256 as a deterministic placeholder for Keccak-256.
 * Production EVM tooling would use Keccak-256 here.
 *
 * @param address - A valid EVM address (0x-prefixed, 40 hex chars)
 * @returns The same address with EIP-55 mixed-case checksum encoding
 */
export function checksumAddress(address: string): string {
  if (!isValidAddress(address)) {
    throw new Error('Invalid EVM address');
  }
  const lower = address.slice(2).toLowerCase();
  const hash = sha256String(lower);
  let result = '0x';
  for (let i = 0; i < 40; i++) {
    const c = lower[i]!;
    if (/[a-f]/.test(c)) {
      // If the i-th nibble of the hash is >= 8, uppercase this character
      const hashNibble = parseInt(hash[i]!, 16);
      result += hashNibble >= 8 ? c.toUpperCase() : c;
    } else {
      result += c;
    }
  }
  return result;
}

/**
 * Convert a covenant ID (64-char hex string) to 0x-prefixed bytes32 format.
 * @param id - 64-character hex string (with or without 0x prefix)
 * @returns 0x-prefixed lowercase hex string (66 chars total)
 */
export function covenantIdToBytes32(id: string): string {
  const clean = strip0x(id);
  if (clean.length !== 64) {
    throw new Error('Covenant ID must be 32 bytes (64 hex chars)');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  return '0x' + clean.toLowerCase();
}
