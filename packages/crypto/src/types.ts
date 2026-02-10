/** Raw 32-byte private key */
export type PrivateKey = Uint8Array;

/** Raw 32-byte public key */
export type PublicKey = Uint8Array;

/** 64-byte Ed25519 signature */
export type Signature = Uint8Array;

/** Hex-encoded SHA-256 hash */
export type HashHex = string;

/** Base64url-encoded string (no padding) */
export type Base64Url = string;

/** A key pair for signing and verification */
export interface KeyPair {
  /** 32-byte private key */
  privateKey: PrivateKey;
  /** 32-byte public key */
  publicKey: PublicKey;
  /** Hex-encoded public key for display/storage */
  publicKeyHex: string;
}

/** A detached signature with metadata */
export interface DetachedSignature {
  /** The signature bytes */
  signature: Signature;
  /** Hex-encoded signature for serialization */
  signatureHex: string;
  /** Public key of the signer */
  signerPublicKey: PublicKey;
  /** Hex-encoded public key of signer */
  signerPublicKeyHex: string;
  /** ISO 8601 timestamp when signature was created */
  timestamp: string;
}

/** 32-byte nonce for replay protection */
export type Nonce = Uint8Array;
