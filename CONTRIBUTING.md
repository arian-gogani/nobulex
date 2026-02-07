# Contributing to Stele

## Setup

```bash
git clone https://github.com/stelelabs/stele.git
cd stele
npm install
npm run build
npm run test
```

All packages live in `packages/`. The repo uses npm workspaces — `npm install` at the root handles everything.

## Development

Build all packages:

```bash
npm run build
```

Run the type checker:

```bash
npm run typecheck
```

Run all tests:

```bash
npm run test
```

These three commands are exactly what CI runs. If they pass locally, they'll pass in CI.

## Pull Request Process

1. **Branch from `main`.** Name your branch descriptively: `fix/merkle-proof-validation`, `feat/poseidon-commitments`, `docs/ccl-examples`.

2. **Keep PRs focused.** One logical change per PR. If you're fixing a bug and also refactoring nearby code, that's two PRs.

3. **Write tests.** New features need tests. Bug fixes need a test that would have caught the bug.

4. **Ensure CI passes.** `npm run build`, `npm run typecheck`, and `npm run test` must all succeed with zero errors.

5. **Write a clear description.** Explain *what* changed and *why*. Link to relevant issues.

6. **Request review.** All PRs require at least one approving review before merge.

## Code Standards

- **TypeScript.** All packages are written in TypeScript with strict mode enabled.
- **No `any`.** Use proper types. If a type is complex, define it in `@stele/types`.
- **Test what matters.** Unit tests for logic, integration tests for protocol flows. Don't test implementation details.
- **Name things clearly.** A function called `verifyCovenantSignature` doesn't need a comment explaining that it verifies a covenant's signature.
- **Keep dependencies minimal.** Every dependency is an attack surface. Justify new dependencies in your PR description.

## Packages

Changes to `@stele/types` or `@stele/crypto` may affect all downstream packages. Build and test the full workspace before submitting.

Dependency order:

```
types → crypto → core → store → verifier → sdk → cli → mcp-server
                                                    → react
                                          → evm
```

## Reporting Issues

- **Bugs:** Open a GitHub issue with a minimal reproduction.
- **Security vulnerabilities:** Do NOT open a public issue. See [SECURITY.md](./SECURITY.md).
- **Feature requests:** Open a GitHub issue. Describe the problem you're trying to solve, not just the solution you want.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
