import { buildCovenant, CovenantBuildError } from './index.js';

import type {
  Issuer,
  Beneficiary,
  ChainReference,
  EnforcementConfig,
  ProofConfig,
  RevocationConfig,
  CovenantMetadata,
  Obligation,
  CovenantDocument,
} from './types.js';

/**
 * A fluent builder for constructing CovenantDocument instances.
 *
 * Wraps the lower-level {@link buildCovenant} function with a chainable
 * API that validates required fields at build time. Every setter method
 * returns `this` so calls can be chained in any order.
 *
 * @example
 * ```typescript
 * const doc = await new CovenantBuilder()
 *   .issuer({ id: 'alice', publicKey: kp.publicKeyHex, role: 'issuer', name: 'Alice' })
 *   .beneficiary({ id: 'bob', publicKey: bobPubHex, role: 'beneficiary', name: 'Bob' })
 *   .constraints("permit read on '/data/**'")
 *   .privateKey(kp.privateKey)
 *   .build();
 * ```
 */
export class CovenantBuilder {
  private _issuer: Issuer | undefined;
  private _beneficiary: Beneficiary | undefined;
  private _constraints: string | undefined;
  private _privateKey: Uint8Array | undefined;
  private _expiresAt: string | undefined;
  private _activatesAt: string | undefined;
  private _metadata: CovenantMetadata | undefined;
  private _chain: ChainReference | undefined;
  private _enforcement: EnforcementConfig | undefined;
  private _proof: ProofConfig | undefined;
  private _revocation: RevocationConfig | undefined;
  private _obligations: Obligation[] | undefined;

  /**
   * Set the issuing party for the covenant.
   *
   * @param value - The issuer party object (must have `role: 'issuer'`).
   * @returns This builder instance for chaining.
   */
  issuer(value: Issuer): this {
    this._issuer = value;
    return this;
  }

  /**
   * Set the beneficiary party for the covenant.
   *
   * @param value - The beneficiary party object (must have `role: 'beneficiary'`).
   * @returns This builder instance for chaining.
   */
  beneficiary(value: Beneficiary): this {
    this._beneficiary = value;
    return this;
  }

  /**
   * Set the CCL constraint source text for the covenant.
   *
   * @param value - A valid CCL string, e.g. `"permit read on '/data/**'"`.
   * @returns This builder instance for chaining.
   */
  constraints(value: string): this {
    this._constraints = value;
    return this;
  }

  /**
   * Set the issuer's Ed25519 private key used to sign the document.
   *
   * @param value - A Uint8Array containing the 32- or 64-byte Ed25519 private key.
   * @returns This builder instance for chaining.
   */
  privateKey(value: Uint8Array): this {
    this._privateKey = value;
    return this;
  }

  /**
   * Set the optional ISO 8601 expiry timestamp for the covenant.
   *
   * @param value - An ISO 8601 date string (e.g. `'2025-12-31T23:59:59.000Z'`).
   * @returns This builder instance for chaining.
   */
  expiresAt(value: string): this {
    this._expiresAt = value;
    return this;
  }

  /**
   * Set the optional ISO 8601 activation timestamp for the covenant.
   *
   * @param value - An ISO 8601 date string (e.g. `'2025-01-01T00:00:00.000Z'`).
   * @returns This builder instance for chaining.
   */
  activatesAt(value: string): this {
    this._activatesAt = value;
    return this;
  }

  /**
   * Set optional metadata for the covenant document.
   *
   * @param value - A CovenantMetadata object with name, description, tags, etc.
   * @returns This builder instance for chaining.
   */
  metadata(value: CovenantMetadata): this {
    this._metadata = value;
    return this;
  }

  /**
   * Set an optional chain reference linking this covenant to a parent.
   *
   * @param value - A ChainReference with parentId, relation, and depth.
   * @returns This builder instance for chaining.
   */
  chain(value: ChainReference): this {
    this._chain = value;
    return this;
  }

  /**
   * Set the optional runtime enforcement configuration.
   *
   * @param value - An EnforcementConfig specifying type and config.
   * @returns This builder instance for chaining.
   */
  enforcement(value: EnforcementConfig): this {
    this._enforcement = value;
    return this;
  }

  /**
   * Set the optional compliance proof configuration.
   *
   * @param value - A ProofConfig specifying type and config.
   * @returns This builder instance for chaining.
   */
  proof(value: ProofConfig): this {
    this._proof = value;
    return this;
  }

  /**
   * Set the optional revocation configuration.
   *
   * @param value - A RevocationConfig specifying method and optional endpoint.
   * @returns This builder instance for chaining.
   */
  revocation(value: RevocationConfig): this {
    this._revocation = value;
    return this;
  }

  /**
   * Set optional obligations for the covenant.
   *
   * @param value - An array of Obligation objects.
   * @returns This builder instance for chaining.
   */
  obligations(value: Obligation[]): this {
    this._obligations = value;
    return this;
  }

  /**
   * Reset the builder, clearing all previously set fields.
   *
   * After calling reset the builder can be reused to construct a new
   * covenant from scratch.
   *
   * @returns This builder instance for chaining.
   */
  reset(): this {
    this._issuer = undefined;
    this._beneficiary = undefined;
    this._constraints = undefined;
    this._privateKey = undefined;
    this._expiresAt = undefined;
    this._activatesAt = undefined;
    this._metadata = undefined;
    this._chain = undefined;
    this._enforcement = undefined;
    this._proof = undefined;
    this._revocation = undefined;
    this._obligations = undefined;
    return this;
  }

  /**
   * Build and sign the CovenantDocument.
   *
   * Validates that all four required fields (issuer, beneficiary,
   * constraints, privateKey) have been set, then delegates to the
   * lower-level {@link buildCovenant} function.
   *
   * @returns A Promise resolving to a signed CovenantDocument.
   * @throws {CovenantBuildError} If any required field is missing or
   *   if `buildCovenant` rejects the inputs.
   */
  async build(): Promise<CovenantDocument> {
    if (!this._issuer) {
      throw new CovenantBuildError(
        'CovenantBuilder: issuer is required',
        'issuer',
      );
    }
    if (!this._beneficiary) {
      throw new CovenantBuildError(
        'CovenantBuilder: beneficiary is required',
        'beneficiary',
      );
    }
    if (!this._constraints) {
      throw new CovenantBuildError(
        'CovenantBuilder: constraints is required',
        'constraints',
      );
    }
    if (!this._privateKey) {
      throw new CovenantBuildError(
        'CovenantBuilder: privateKey is required',
        'privateKey',
      );
    }

    return buildCovenant({
      issuer: this._issuer,
      beneficiary: this._beneficiary,
      constraints: this._constraints,
      privateKey: this._privateKey,
      expiresAt: this._expiresAt,
      activatesAt: this._activatesAt,
      metadata: this._metadata,
      chain: this._chain,
      enforcement: this._enforcement,
      proof: this._proof,
      revocation: this._revocation,
      obligations: this._obligations,
    });
  }
}
