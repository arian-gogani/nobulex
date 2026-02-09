# Contributing to Stele

Thank you for your interest in contributing to Stele, the accountability primitive for
AI agents. This guide covers everything you need to get started.

## Prerequisites

- **Node.js** 18 or later (tested on 18, 20, and 22)
- **npm** 9 or later (ships with Node 18+)
- **Git** 2.25 or later

## Getting Started

```bash
# Clone the repository
git clone https://github.com/agbusiness195/stele.git
cd stele

# Install all dependencies (npm workspaces resolves inter-package deps automatically)
npm install

# Build all packages
npm run build

# Run all tests
npx vitest run
```

## Running Tests

The project uses [Vitest](https://vitest.dev/) for testing. Every package has co-located
tests in `src/index.test.ts` (and sometimes additional test files).

```bash
# Run the full test suite
npx vitest run

# Run tests for a single package
npx vitest run packages/crypto
npx vitest run packages/ccl
npx vitest run packages/core

# Run tests in watch mode (re-runs on file changes)
npx vitest

# Run tests with coverage
npx vitest run --coverage
```

## Project Structure

```
stele/
  packages/           # All 30+ packages live here
    types/            # Shared types, error classes, validation
    crypto/           # Ed25519 signing, SHA-256, encoding
    ccl/              # Covenant Constraint Language parser/evaluator
    core/             # Covenant lifecycle (build, verify, chain)
    store/            # Pluggable storage backends
    verifier/         # Standalone verification engine
    sdk/              # High-level SteleClient unified SDK
    identity/         # Agent identity with lineage tracking
    enforcement/      # Runtime constraint enforcement
    proof/            # Poseidon-based compliance proofs
    breach/           # Breach detection and trust graph
    reputation/       # Reputation scoring and staking
    mcp/              # MCP guard for tool enforcement
    cli/              # Command-line interface
    attestation/      # External attestation and reconciliation
    canary/           # Canary testing framework
    gametheory/       # Game-theoretic honesty proofs
    composition/      # Constraint composition and verification
    antifragile/      # Breach-to-improvement antifragility
    negotiation/      # Multi-party covenant negotiation
    consensus/        # Accountability-based consensus
    robustness/       # Formal robustness analysis
    temporal/         # Temporal evolution and trust decay
    recursive/        # Meta-covenants and recursive verification
    alignment/        # AI alignment property verification
    norms/            # Emergent norm discovery
    substrate/        # Cross-substrate constraint translation
    derivatives/      # Trust futures and insurance
    legal/            # Legal compliance and audit trails
    react/            # Reactive UI primitives
    evm/              # EVM anchoring utilities
    mcp-server/       # JSON-RPC 2.0 MCP server
  docs/               # Documentation
    api/              # API reference
    architecture.md   # Architecture overview
  examples/           # Runnable example scripts
```

## Adding a New Package

Follow this checklist when adding a new package:

1. **Create the directory**: `mkdir -p packages/my-package/src`
2. **Create `package.json`**:
   ```json
   {
     "name": "@stele/my-package",
     "version": "0.1.0",
     "type": "module",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "build": "tsup src/index.ts --format esm --dts",
       "typecheck": "tsc --noEmit",
       "test": "vitest run"
     },
     "dependencies": {
       "@stele/types": "0.1.0"
     }
   }
   ```
3. **Create `tsconfig.json`** referencing the root config and package dependencies.
4. **Create `src/index.ts`** with your exports.
5. **Create `src/index.test.ts`** with at least basic smoke tests.
6. **Add to root `tsconfig.json`** references array.
7. **Add to root `package.json`** workspaces array.
8. **Run `npm install`** from the repo root to link the new package.
9. **Run `npm run build`** and `npx vitest run` to verify everything works.

## Code Style

- **TypeScript strict mode**: All packages use `"strict": true` in `tsconfig.json`.
- **No `any`**: Avoid `any` types. Use `unknown` and narrow with type guards.
- **Prefer `readonly`**: Mark properties and parameters as `readonly` when they should
  not be mutated.
- **Pure functions**: Prefer pure functions over stateful classes where possible.
- **Immutable returns**: Functions that transform documents return new copies rather
  than mutating the input.
- **Explicit error types**: Use the error classes from `@stele/types` (`SteleError`,
  `ValidationError`, `CryptoError`, etc.) rather than plain `Error`.
- **Branded types**: Use branded string types (`HashHex`, `Base64Url`, etc.) for
  type safety at API boundaries.

## CCL Gotchas

When writing tests or examples that use CCL (Covenant Constraint Language), be aware of
these common pitfalls:

- **`severity` is a reserved keyword** in CCL `when` conditions. Use `risk_level`
  instead of `severity` in your condition expressions.
- **Resource matching is exact**: The path `/secrets` does NOT match `/secrets/key`.
  Use glob patterns like `/secrets/**` to match all sub-paths.
- **Default deny**: When no rules in a CCL document match an action/resource pair,
  `evaluate()` returns `{ permitted: false }`. This is intentional.
- **`ConstraintSpec.rule` is a name**, not valid CCL. If you have a `ConstraintSpec`
  with a `rule` field, use `buildDocFromSpec()` to convert it to a parseable CCL
  document.
- **Use `result.permitted`** (not `result.matchedRule`) to determine whether an action
  is allowed.

## Pull Request Process

1. **Branch from `main`**: Create a feature branch with a descriptive name
   (e.g., `feat/add-rate-limit-enforcement`, `fix/ccl-wildcard-matching`).
2. **Keep commits focused**: Each commit should represent a single logical change.
   Write descriptive commit messages explaining *why*, not just *what*.
3. **Tests must pass**: Run `npx vitest run` before submitting. CI runs the full
   matrix (Node 18/20/22) on every PR.
4. **No breaking changes without discussion**: If your change alters a public API,
   open an issue first to discuss the design.
5. **Update documentation**: If you add or change a public API, update the relevant
   documentation in `docs/`.
6. **One approval required**: PRs require at least one maintainer review before merge.

## Build System

- **tsup** for bundling (ESM output with declaration files)
- **tsc --build** for type-checking and declaration generation
- **vitest** for testing

```bash
# Build a single package
cd packages/crypto && npm run build

# Type-check the entire project
npm run typecheck

# Generate API documentation
npm run docs
```

## License

By contributing to Stele, you agree that your contributions will be licensed
under the MIT License.
