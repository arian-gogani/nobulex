# @nobulex/tee

Trusted Execution Environment (TEE) attestation for Nobulex agents. Provides TEE remote attestation quote structures (SGX, TDX, SEV-SNP), attestation verification against enclave policies, enclave-to-DID binding, and an in-memory attestation registry.

## Installation

```bash
npm install @nobulex/tee
```

**Requirements:** Node.js >= 18

**Dependencies:** `@nobulex/core-types`, `@nobulex/crypto`, `@nobulex/identity`

## Quick Usage

```typescript
import {
  generateQuote,
  generateEndorsements,
  createEvidence,
  verifyAttestation,
  bindEnclaveToDID,
  verifyBinding,
  TEERegistry,
  DEFAULT_ENCLAVE_POLICY,
} from '@nobulex/tee';

// 1. Generate an attestation quote (simulated)
const quote = await generateQuote('sgx', 'report-data-hash');

// 2. Generate platform endorsements
const endorsements = generateEndorsements(3, 86400);

// 3. Create attestation evidence
const evidence = createEvidence(quote, endorsements, 'simulated');

// 4. Verify attestation against policy
const policy = { ...DEFAULT_ENCLAVE_POLICY, allowDebug: true };
const result = verifyAttestation(evidence, policy);
console.log(result.valid);    // true
console.log(result.status);   // 'valid'
console.log(result.platform); // 'sgx'

// 5. Bind enclave to a DID
const identity = await bindEnclaveToDID('did:nobulex:agent-1', quote);
const bindingValid = await verifyBinding(identity);
console.log(bindingValid); // true

// 6. Use the registry
const registry = new TEERegistry();
registry.register(identity);
console.log(registry.isValid('did:nobulex:agent-1')); // true
```

## API Reference

### Functions

#### `generateQuote(platform: TEEPlatform, reportData: string, options?): Promise<AttestationQuote>`

Generate a simulated attestation quote. In production, this would call into TEE hardware (e.g., SGX EREPORT).

| Parameter    | Type          | Description                          |
| ------------ | ------------- | ------------------------------------ |
| `platform`   | `TEEPlatform` | `'sgx'`, `'tdx'`, or `'sev-snp'`    |
| `reportData` | `string`      | User-supplied report data (typically a hash binding to DID/public key) |

**Options:**
- `measurement?: string` -- Enclave measurement hash
- `signerMeasurement?: string` -- Signer measurement hash
- `productId?: number` -- Product ID (default: 1)
- `securityVersion?: number` -- Security version (default: 1)
- `debugMode?: boolean` -- Debug mode flag (default: false)

#### `generateEndorsements(tcbLevel?: number, expiresInSec?: number): PlatformEndorsements`

Generate simulated platform endorsements with a certificate chain and TCB info.

#### `createEvidence(quote: AttestationQuote, endorsements: PlatformEndorsements, securityLevel?: SecurityLevel): AttestationEvidence`

Combine a quote and endorsements into full attestation evidence.

#### `verifyAttestation(evidence: AttestationEvidence, policy?: EnclavePolicy): AttestationVerificationResult`

Verify an attestation quote against an enclave policy. Performs the following checks:

1. Debug mode allowed?
2. Security version meets minimum?
3. Measurement in whitelist (if configured)?
4. Signer in whitelist (if configured)?
5. TCB level meets minimum?
6. TCB not revoked?
7. Endorsements not expired?
8. Quote age within limit?
9. Certificate chain exists?

#### `bindEnclaveToDID(did: string, quote: AttestationQuote, expiresAt?: string | null): Promise<TEEIdentity>`

Bind an enclave identity to a DID. The binding proof is a SHA-256 hash of the DID and enclave measurements.

#### `verifyBinding(identity: TEEIdentity): Promise<boolean>`

Verify that a TEE identity binding is valid by recomputing the proof.

#### `isBindingExpired(identity: TEEIdentity): boolean`

Check whether a TEE identity binding has expired.

#### `generateReportData(did: string, publicKeyHex: string, nonce?: string): Promise<string>`

Generate report data that binds a DID's public key to the attestation. Used as the `reportData` field in the attestation quote.

#### `platformName(platform: TEEPlatform): string`

Get the human-readable platform display name.

| Input       | Output           |
| ----------- | ---------------- |
| `'sgx'`     | `'Intel SGX'`    |
| `'tdx'`     | `'Intel TDX'`    |
| `'sev-snp'` | `'AMD SEV-SNP'`  |

### Classes

#### `TEERegistry`

In-memory registry of TEE identities for resolving and validating enclave bindings.

**Methods:**

| Method                                   | Returns                       | Description                        |
| ---------------------------------------- | ----------------------------- | ---------------------------------- |
| `register(identity: TEEIdentity)`        | `void`                        | Register a TEE identity binding    |
| `registerEvidence(evidence)`             | `void`                        | Register attestation evidence      |
| `resolve(did: string)`                   | `TEEIdentity \| null`         | Look up TEE identity for a DID    |
| `getEvidence(quoteId: string)`           | `AttestationEvidence \| null` | Get evidence by quote ID           |
| `isValid(did: string)`                   | `boolean`                     | Check if DID has valid binding     |
| `revoke(did: string)`                    | `boolean`                     | Remove a TEE identity binding      |

**Properties:**

| Property | Type       | Description                   |
| -------- | ---------- | ----------------------------- |
| `size`   | `number`   | Number of registered bindings |
| `dids`   | `string[]` | All registered DIDs           |

### Types

#### `TEEPlatform`

```typescript
type TEEPlatform = 'sgx' | 'tdx' | 'sev-snp';
```

#### `SecurityLevel`

```typescript
type SecurityLevel = 'hardware' | 'software' | 'simulated';
```

#### `AttestationStatus`

```typescript
type AttestationStatus = 'valid' | 'expired' | 'revoked' | 'invalid' | 'unknown';
```

### Interfaces

#### `AttestationQuote` -- Raw attestation quote from a TEE platform.
#### `PlatformEndorsements` -- Endorsements from platform vendor (Intel/AMD).
#### `TCBInfo` -- Trusted Computing Base information.
#### `AttestationEvidence` -- Full evidence: quote + endorsements + security level.
#### `AttestationVerificationResult` -- Result of verifying an attestation.
#### `TEEIdentity` -- TEE identity binding an enclave to a DID.
#### `EnclavePolicy` -- Configuration for enclave verification policy.

### Constants

#### `DEFAULT_ENCLAVE_POLICY`

```typescript
const DEFAULT_ENCLAVE_POLICY: EnclavePolicy = {
  allowedMeasurements: [],
  allowedSigners: [],
  minSecurityVersion: 1,
  allowDebug: false,
  minTcbLevel: 1,
  maxQuoteAgeSec: 3600,
};
```

#### `SGX`, `TDX`, `SEV_SNP`

Platform-specific constants for report data size and measurement size.

```typescript
SGX.PLATFORM             // 'sgx'
SGX.MAX_REPORT_DATA_SIZE // 64
SGX.MEASUREMENT_SIZE     // 64

TDX.PLATFORM             // 'tdx'
TDX.MAX_REPORT_DATA_SIZE // 64
TDX.MEASUREMENT_SIZE     // 96

SEV_SNP.PLATFORM             // 'sev-snp'
SEV_SNP.MAX_REPORT_DATA_SIZE // 64
SEV_SNP.MEASUREMENT_SIZE     // 96
```

## License

MIT
