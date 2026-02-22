# Good First Issues

Scoped tasks for new contributors. Each is 1–2 hours. Create these as GitHub issues labeled `good first issue`.

---

## Documentation

- [x] Add JSDoc to `negateTrust` and `tensorTrust` in `@stele/composition`
- [x] Document `enforcementTier` (hard/soft) in CCL user guide
- [x] Add example: covenant with `when` conditions to examples/
- [x] Translate README.md first paragraph into German
- [x] Translate EU AI Act mapping summary into French
- [x] Add "Common CCL patterns" section to docs
- [x] Document `stakeBound` formula in reputation package README

---

## Tests

- [x] Add test for `negateTrust` with empty covenant
- [x] Add test for `tensorTrust` with overlapping agents
- [x] Add integration test: full flow with breach attestation nonce
- [x] Add test for CCL `enforcement soft` statement
- [x] Add test for `composeTrust` with single covenant edge case

---

## Code Quality

- [x] Add `// eslint-disable-next-line` with justification for any remaining suppressions
- [x] Ensure all exported functions have JSDoc `@param` and `@returns`
- [x] Add type export for `KovaPreset` in kova package
- [x] Fix any `@ts-expect-error` with proper typing (none found in codebase)

---

## Examples

- [x] Create `examples/09-kova-audit-report.ts` — generate a mock compliance report
- [x] Add example: MCP server with custom covenant (not preset)
- [x] Add example: identity evolution with lineage

---

## Tooling

- [x] Add `kova --version` to CLI
- [x] Add `--help` output for each CLI subcommand
- [x] Add pre-commit hook to run `kova audit` (stub) in examples/

---

## Package-Specific

- [x] **@stele/ccl:** Add `validateCCL(source: string): boolean` convenience function
- [x] **@stele/store:** Add `count()` method to CovenantStore interface (already exists)
- [x] **@stele/verifier:** Export `VerificationReport` type (already exported)
- [x] **kova:** Add `getPresetConstraints(preset: KovaPreset): string` for debugging

---

## New Issues (for future contributors)

When the above are done, consider:

- [x] Add Spanish README intro to [docs/i18n/README-es.md](./i18n/README-es.md)
- [x] Add test for `validateCCL` with multi-statement CCL
- [x] Add example: full breach attestation flow (create → violate → attest → process)
- [x] Document `computeCarryForward` evolution policy in identity package
- [x] Add `--verbose` flag to `kova audit` for detailed output

---

## Additional Issues (untested packages)

Packages that could use basic test coverage:

- [x] Add tests for `@stele/staking`
- [x] Add tests for `@stele/rail`
- [x] Add tests for `@stele/trust-data`
- [x] Add tests for `@stele/trust-futures`
- [x] Add tests for `@stele/marketplace`
- [x] Add tests for `@stele/compliance-autopilot`

---

## Future Ideas (when above are done)

- [x] Add Italian README intro to [docs/i18n/README-it.md](./i18n/README-it.md)
- [x] Add integration test for `kovaGatewayMiddleware` with Bearer token and x-kova-covenant header
- [x] Add example: trust futures flow (create future → trade → settle) — [examples/13-trust-futures-flow.ts](../examples/13-trust-futures-flow.ts)
- [x] Document `TrustGraph` propagation rules in [packages/breach/README.md](../packages/breach/README.md)
- [x] Add `--format` option to `kova audit` (markdown, json)
- [x] Add Portuguese README intro to [docs/i18n/README-pt.md](./i18n/README-pt.md)

---

## Next Round (for new contributors)

When all above are done, consider:

- [x] Add Dutch README intro to [docs/i18n/README-nl.md](./i18n/README-nl.md)
- [x] Add example: [kovaGatewayMiddleware with requiredConstraints](../examples/14-api-gateway-required-constraints.ts)
- [ ] Add E2E test for verification-service (POST /verify with covenant)
- [x] Document TrustGraph.registerDependency semantics in [breach README](../packages/breach/README.md) (upstream/downstream)
- [ ] Add `--format json` alias when `--json` is passed to audit (or document equivalence)
- [x] Add README for [@stele/trust-futures](../packages/trust-futures/README.md) (Kova trade fee, createAndListFuture, executeTrade)

---

## How to Contribute

1. Pick an issue from this list (or the GitHub issues when created).
2. Comment "I'll take this" on the issue.
3. Open a PR with your changes.
4. Ensure tests pass: `npx vitest run`

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines.
