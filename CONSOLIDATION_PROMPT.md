# NOBULEX CONSOLIDATION — Claude Code Prompt
# Copy everything below this line and paste into Claude Code

---

## Task: Consolidate 30 packages down to 5

The Nobulex monorepo at ~/github/nobulex has 30 packages. This is over-engineered for a project with 14 stars and zero users. Consolidate to 5 packages.

### Target architecture (5 packages):

1. **packages/core** — Merge ALL internal modules into one package:
   - types (shared types, error codes, guards, constants)
   - crypto (SHA-256, signing, key generation)
   - ccl (Cedar constraint language parser)
   - covenant-lang (covenant DSL)
   - action-log (hash-chained action logs)
   - identity (DID creation, resolution)
   - enforcement (constraint enforcement engine)
   - middleware (enforcement middleware)
   - verification (verification engine)
   - proof (proof generation)
   - merkle (merkle tree + proofs)
   - evidence-core (evidence primitives)
   - store (storage abstraction)
   
   The merged core should export everything these packages currently export. All imports between these packages become internal imports within core.

2. **packages/sdk** — Keep as the high-level user API. Update imports to use @nobulex/core instead of individual packages.

3. **packages/mcp-server** — Keep as the MCP compliance server. Update imports.

4. **packages/a2a** — Keep as A2A Agent Card extension. Update imports.

5. **packages/langchain** — Keep as LangChain integration. Update imports.

### Packages to DELETE entirely:
- packages/cli
- packages/elizaos-plugin
- packages/evm
- packages/react
- packages/tee
- packages/otel
- packages/reputation
- packages/transparency-log
- packages/composability
- packages/experimental
- packages/verifier
- packages/mcp (the types package, NOT mcp-server)

### Rules:
1. All 3,648 tests that currently pass MUST still pass after consolidation (run `npx vitest run` to verify)
2. The SDK's public API must not change — `import { CovenantAgent } from '@nobulex/sdk'` must still work
3. Update package.json workspaces to only list the 5 remaining packages
4. Update the root build script to only build the 5 packages in correct dependency order: core → sdk, mcp-server, a2a, langchain
5. Update vitest.config.ts and vitest.config.ci.ts to only include the 5 packages
6. Update README.md to reference only the 5 packages
7. Remove all references to deleted packages from tsconfig.json, .gitignore, etc.
8. Run `npx vitest run` after consolidation to verify tests pass
9. Keep all test files — move them into the appropriate consolidated package

### Dependency order:
```
core (no internal deps)
  ↓
sdk (depends on core)
mcp-server (depends on core)
a2a (depends on core)
langchain (depends on core)
```

### After consolidation, commit with message:
"refactor: consolidate 30 packages into 5 — core, sdk, mcp-server, a2a, langchain"
