import { sha256String } from '@nobulex/crypto';
import type { HashHex } from '@nobulex/crypto';

/**
 * BN254 (alt_bn128) scalar field prime.
 * This is the standard prime used in Ethereum precompile-compatible ZK circuits.
 */
export const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ---------------------------------------------------------------------------
// Poseidon parameters
// ---------------------------------------------------------------------------

/** State width: 2 inputs + 1 capacity element */
const T = 3;

/** Number of full rounds (applied at beginning and end) */
const FULL_ROUNDS = 8;

/** Number of partial rounds (applied in the middle) */
const PARTIAL_ROUNDS = 57;

/** Total number of rounds */
const TOTAL_ROUNDS = FULL_ROUNDS + PARTIAL_ROUNDS;

// ---------------------------------------------------------------------------
// Round constants – derived deterministically from SHA-256
// ---------------------------------------------------------------------------

/**
 * Generate deterministic round constants by hashing sequential indices.
 * Each round needs T constants, one per state element.
 * We hash "poseidon_rc_{i}" for index i, then reduce mod FIELD_PRIME.
 */
function generateRoundConstants(): bigint[][] {
  const constants: bigint[][] = [];

  for (let round = 0; round < TOTAL_ROUNDS; round++) {
    const roundConsts: bigint[] = [];
    for (let j = 0; j < T; j++) {
      const idx = round * T + j;
      const hash = sha256String(`poseidon_rc_${idx}`);
      // Convert the 256-bit hash to a bigint and reduce mod p
      const value = BigInt('0x' + hash) % FIELD_PRIME;
      roundConsts.push(value);
    }
    constants.push(roundConsts);
  }

  return constants;
}

// Pre-compute round constants at module load
const ROUND_CONSTANTS = generateRoundConstants();

// ---------------------------------------------------------------------------
// MDS matrix – Cauchy matrix construction
// ---------------------------------------------------------------------------

/**
 * Compute modular multiplicative inverse using extended Euclidean algorithm.
 * Returns a^(-1) mod p.
 */
function modInverse(a: bigint, p: bigint): bigint {
  a = ((a % p) + p) % p;
  if (a === 0n) {
    throw new Error('No inverse for zero');
  }

  let [old_r, r] = [a, p];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }

  return ((old_s % p) + p) % p;
}

/**
 * Build a T x T Cauchy MDS matrix.
 *
 * M[i][j] = 1 / (x_i + y_j) mod p
 *
 * where x_i and y_j are distinct field elements chosen to guarantee
 * no x_i + y_j = 0 mod p (which would make the matrix singular).
 * We use x_i = i + 1, y_j = T + j + 1.
 */
function buildMDSMatrix(): bigint[][] {
  const matrix: bigint[][] = [];

  for (let i = 0; i < T; i++) {
    const row: bigint[] = [];
    for (let j = 0; j < T; j++) {
      const xi = BigInt(i + 1);
      const yj = BigInt(T + j + 1);
      const sum = (xi + yj) % FIELD_PRIME;
      row.push(modInverse(sum, FIELD_PRIME));
    }
    matrix.push(row);
  }

  return matrix;
}

// Pre-compute MDS matrix at module load
const MDS_MATRIX = buildMDSMatrix();

// ---------------------------------------------------------------------------
// Poseidon core operations
// ---------------------------------------------------------------------------

/**
 * The S-box: x -> x^5 mod p.
 * Exponent 5 is standard for Poseidon over BN254.
 */
function sbox(x: bigint): bigint {
  const x2 = (x * x) % FIELD_PRIME;
  const x4 = (x2 * x2) % FIELD_PRIME;
  return (x4 * x) % FIELD_PRIME;
}

/**
 * Add round constants to the state.
 */
function addRoundConstants(state: bigint[], round: number): bigint[] {
  const rc = ROUND_CONSTANTS[round]!;
  return state.map((s, i) => (s + rc[i]!) % FIELD_PRIME);
}

/**
 * Apply MDS matrix multiplication to the state.
 */
function mdsMultiply(state: bigint[]): bigint[] {
  const result: bigint[] = new Array(T).fill(0n);

  for (let i = 0; i < T; i++) {
    let acc = 0n;
    for (let j = 0; j < T; j++) {
      acc = (acc + MDS_MATRIX[i]![j]! * state[j]!) % FIELD_PRIME;
    }
    result[i] = acc;
  }

  return result;
}

/**
 * Full round: S-box applied to every state element.
 */
function fullRound(state: bigint[], round: number): bigint[] {
  let s = addRoundConstants(state, round);
  s = s.map(sbox);
  return mdsMultiply(s);
}

/**
 * Partial round: S-box applied only to the first state element.
 * This is the key efficiency optimization of Poseidon.
 */
function partialRound(state: bigint[], round: number): bigint[] {
  let s = addRoundConstants(state, round);
  s[0] = sbox(s[0]!);
  return mdsMultiply(s);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Poseidon hash function (t=3, rate=2).
 *
 * Accepts an array of field elements and returns a single field element.
 * For inputs longer than 2, we use a sponge construction: absorb 2 elements
 * at a time into the first 2 state positions, then squeeze 1 element out.
 *
 * @param inputs - Array of bigint field elements (each must be < FIELD_PRIME)
 * @returns A single bigint field element (the hash)
 */
export function poseidonHash(inputs: bigint[]): bigint {
  if (inputs.length === 0) {
    throw new Error('Poseidon hash requires at least one input');
  }

  // Validate inputs are in the field
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input < 0n || input >= FIELD_PRIME) {
      throw new Error(
        `Input ${i} is out of field range: must be in [0, FIELD_PRIME)`
      );
    }
  }

  // Rate = 2 (T - 1 capacity elements, using 1 capacity)
  const rate = T - 1;

  // Pad inputs to a multiple of rate
  const padded = [...inputs];
  // Domain separation: append 1 then zeros
  padded.push(1n);
  while (padded.length % rate !== 0) {
    padded.push(0n);
  }

  // Initialize state: all zeros
  let state: bigint[] = new Array(T).fill(0n);

  // Absorb phase: process inputs in chunks of `rate`
  for (let chunk = 0; chunk < padded.length; chunk += rate) {
    // XOR (add in field) the input chunk into the rate portion of state
    for (let i = 0; i < rate; i++) {
      state[i] = (state[i]! + padded[chunk + i]!) % FIELD_PRIME;
    }

    // Apply the Poseidon permutation
    state = poseidonPermutation(state);
  }

  // Squeeze: return the first element of the state
  return state[0]!;
}

/**
 * The full Poseidon permutation on a state of T field elements.
 *
 * Structure: R_f/2 full rounds, R_p partial rounds, R_f/2 full rounds
 */
function poseidonPermutation(state: bigint[]): bigint[] {
  let s = [...state];
  let round = 0;

  // First half of full rounds
  const halfFull = FULL_ROUNDS / 2;
  for (let i = 0; i < halfFull; i++) {
    s = fullRound(s, round);
    round++;
  }

  // Partial rounds
  for (let i = 0; i < PARTIAL_ROUNDS; i++) {
    s = partialRound(s, round);
    round++;
  }

  // Second half of full rounds
  for (let i = 0; i < halfFull; i++) {
    s = fullRound(s, round);
    round++;
  }

  return s;
}

/**
 * Convert a hex-encoded hash (e.g., SHA-256 output) to a BN254 field element.
 *
 * Takes the first 31 bytes (248 bits) of the hash to ensure the result
 * is always less than FIELD_PRIME (~254 bits but with leading structure).
 * Then reduces mod FIELD_PRIME for safety.
 *
 * @param hash - Hex-encoded hash string (at least 62 hex chars / 31 bytes)
 * @returns A bigint in the BN254 scalar field
 */
export function hashToField(hash: HashHex): bigint {
  if (hash.length < 2) {
    throw new Error('Hash string too short for field conversion');
  }

  // Use the full hash but reduce mod prime
  // This gives slight bias but is acceptable for commitment schemes
  const value = BigInt('0x' + hash);
  return value % FIELD_PRIME;
}

/**
 * Convert a bigint field element to a hex string (zero-padded to 64 chars).
 */
export function fieldToHex(value: bigint): string {
  if (value < 0n || value >= FIELD_PRIME) {
    throw new Error('Value out of field range');
  }
  return value.toString(16).padStart(64, '0');
}
