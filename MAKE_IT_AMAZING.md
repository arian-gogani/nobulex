I need you to make this codebase impressive enough that a senior developer browsing it would say "holy shit, this is well built." Work through every task in order. Only local commits, do NOT push.

TASK 1 — INTERACTIVE DEMO (highest impact)

Create examples/demo.ts that someone can run with `npx ts-node examples/demo.ts` and see Nobulex working end-to-end in their terminal. It should:

1. Create two agent identities (Agent A and Agent B)
2. Agent A declares a covenant: permit read, permit transfer (amount <= 500), forbid transfer (amount > 500), forbid delete
3. Agent A executes 5 actions through the enforcement middleware — 4 allowed, 1 blocked
4. Agent A generates a proof-of-behavior
5. Agent B runs the 8-step handshake to verify Agent A
6. Print each step with checkmarks: "✓ Covenant signature valid", "✓ Log integrity verified", etc.
7. Print final result: "Agent B trusts Agent A ✅"
8. Then create Agent C with a TAMPERED log (modify one hash)
9. Agent B tries to verify Agent C
10. Handshake fails at step 3: "✗ Log integrity FAILED — hash chain broken ❌"
11. Print: "Agent B refuses Agent C"

Use actual imports from the Nobulex packages. This must actually run, not be pseudocode. Add color output using ANSI escape codes (green for pass, red for fail). Add a 200ms delay between steps so it feels like a real verification happening.

Also create examples/README.md explaining how to run it.

Commit: "add interactive demo — run it and see two agents verify each other"

TASK 2 — PERFORMANCE BENCHMARKS

Create benchmarks/bench.ts that measures and prints:

- Key pair generation: ops/sec
- SHA-256 hashing (1KB, 10KB, 100KB payloads): ops/sec  
- Ed25519 signing: ops/sec
- Ed25519 verification: ops/sec
- Covenant evaluation (simple 3-rule): ops/sec
- Covenant evaluation (complex 50-rule): ops/sec
- Full handshake verification (10 actions): ms
- Full handshake verification (100 actions): ms
- Full handshake verification (1000 actions): ms
- Full handshake verification (10000 actions): ms
- Hash chain construction (1000 entries): ms
- Hash chain integrity verification (1000 entries): ms

Run each benchmark 1000 times minimum, report mean, p50, p95, p99. Print results in a clean table format. Use `perf_hooks` for high-resolution timing.

Also add a `benchmarks/README.md` with the results pre-filled from a real run.

Commit: "add performance benchmarks — sub-millisecond handshake verified"

TASK 3 — PROPERTY-BASED TESTS WITH FAST-CHECK

Install fast-check. Create packages/sdk/src/property.test.ts with these property tests:

1. "verification is deterministic" — for any random covenant and any random action sequence, calling verify() twice gives the same result
2. "hash chain integrity detects any single tampered entry" — for any valid chain, modifying any single entry's hash makes verifyIntegrity return false
3. "compliant actions never produce violations" — for any covenant, actions that match permit rules never appear in violations
4. "forbidden actions always produce violations" — for any covenant, actions that match forbid rules always appear in violations
5. "handshake is symmetric" — if A trusts B and B trusts A with equivalent covenants, both handshakes succeed
6. "audience binding prevents replay" — a proof generated for audience X fails verification when expectedAudience is Y

These tests are the kind that make cryptographers respect you. They prove the protocol is correct by construction, not just by example.

Commit: "add property-based tests — protocol correctness by construction"

TASK 4 — REAL LANGCHAIN INTEGRATION EXAMPLE

Create examples/langchain-agent.ts showing Nobulex wrapping a real LangChain agent:

1. Create a simple LangChain agent that has tools: search, calculator, file_read
2. Wrap it with Nobulex enforcement middleware
3. Covenant: permit search, permit calculator, forbid file_read (resource = "/etc/passwd"), require all actions logged
4. Agent tries to use search — allowed
5. Agent tries to use calculator — allowed  
6. Agent tries to read /etc/passwd — BLOCKED by covenant
7. Generate proof-of-behavior showing the enforcement history
8. Print the proof summary

This doesn't need an actual LLM — mock the LangChain agent decisions. The point is showing the integration pattern is real and works.

Commit: "add LangChain integration example — governance wrapping a real agent"

TASK 5 — SECURITY SELF-AUDIT IN README

Add a "Security" section to the README with:

```markdown
## Security Audit

We've conducted an internal security review. Here's what we tested and what we found:

**Verified secure:**
- Hash chain integrity: modifying any entry breaks the chain (property-tested with fast-check)
- Signature forgery: invalid signatures are rejected 100% of the time
- Replay attack prevention: audience-bound proofs fail when replayed to different verifiers
- Covenant enforcement: forbidden actions are blocked before execution, never after

**Known limitations:**
- No key revocation mechanism yet — compromised keys remain trusted until removed
- No rate limiting on handshake verification — potential DoS vector
- Single-threaded chain verification — large chains (>100K entries) may be slow
- Clock skew tolerance is 0 — agents with desynchronized clocks may fail timestamp checks

**Not in scope:**
- Model-level safety (prompt injection, jailbreaking) — use guardrails for that
- Network transport security — use TLS
- Key storage — use your platform's HSM or key vault

See [docs/threat-model.md](docs/threat-model.md) for the full threat model.
```

Commit: "add security self-audit to README"

TASK 6 — UPGRADE THE README HERO

Rewrite the top of the README to lead with WHAT IT DOES, not what it is. The first thing someone should see is the demo output, not a description:

```markdown
# Nobulex

**AI agents can't prove they followed their own rules. Nobulex fixes that.**

```bash
$ npx ts-node examples/demo.ts

Agent A declares covenant: permit read, forbid transfer > 500
Agent A executes 5 actions...
  ✓ read /data/users — allowed
  ✓ transfer $300 — allowed  
  ✓ read /data/orders — allowed
  ✗ transfer $600 — BLOCKED by covenant
  ✓ read /data/config — allowed

Agent B verifies Agent A...
  ✓ Step 1: Covenant signature valid
  ✓ Step 2: Proof signature valid
  ✓ Step 3: Log integrity verified (5 entries, chain intact)
  ✓ Step 4: Compliance check passed (0 violations)
  ✓ Step 5: History length sufficient (5 ≥ 1)
  ✓ Step 6: Covenant matches requirements
  ✓ Step 7: Audience binding confirmed
  ✓ Step 8: Task class verified

Result: Agent B trusts Agent A ✅

Agent C presents tampered proof...
  ✓ Step 1: Covenant signature valid
  ✓ Step 2: Proof signature valid
  ✗ Step 3: FAILED — hash chain broken at entry 2

Result: Agent B refuses Agent C ❌
```

Three primitives. That's the whole protocol:

1. **Declare** — write rules: `permit`, `forbid`, `require`
2. **Enforce** — check every action *before* it runs
3. **Prove** — tamper-evident hash chain anyone can verify
```

The demo output IS the documentation. Show, don't tell.

Commit: "rewrite README — lead with demo output, not description"

TASK 7 — REMAINING COMMENT HUMANIZATION

Go through EVERY source file in packages/*/src/*.ts (not test files). For each file:

- If it still has @packageDocumentation, remove it (unless it's the main SDK entry point)
- If all JSDoc comments follow the exact same pattern, vary them: remove some entirely, shorten some to one-line // comments, keep detailed JSDoc only on complex functions
- Replace any remaining "// ─── Section ───" dividers with a mix of "// ---", blank lines, or simpler comments
- Add 2-3 natural-sounding inline comments per file: things like "// edge case: empty array breaks the reduce below", "// perf: this could be lazy but it's fine for now", "// FIXME: doesn't handle unicode covenant names"
- Do NOT touch handshake.ts — it's already done
- Do NOT make every file sound the same — vary the style between files. Some files should be more commented than others. Some should be terse.

Commit: "clean up remaining docs — less uniform, more real"

TASK 8 — ADD CONTRIBUTING GUIDE WITH CODE STYLE

Rewrite CONTRIBUTING.md to include a code style section that naturally explains why the code looks the way it does:

```markdown
## Code Style

We don't enforce a strict comment style — some files are heavily documented, some are terse. That's intentional. Write comments when the code isn't obvious, skip them when it is.

**Do:**
- Write comments that explain WHY, not WHAT
- Add TODO/FIXME when you know something needs work
- Use descriptive variable names instead of comments

**Don't:**
- Add JSDoc to every single function — only document public APIs
- Use box-drawing dividers unless you really want to
- Write comments that just restate the code
```

This pre-answers the "why does the comment style vary?" question by framing it as intentional.

Commit: "update contributing guide with code style notes"

TASK 9 — VERIFY EVERYTHING

After all tasks:

1. Run `npx vitest run` — all tests must pass
2. Run `npx ts-node examples/demo.ts` — demo must work end-to-end and print colored output
3. Run `npx ts-node benchmarks/bench.ts` — benchmarks must complete and print results
4. Run `tsc --noEmit` on the project — zero type errors
5. Verify no "claude" or "anthropic" or "co-authored" references anywhere: `git log --all --format="%B" | grep -ic "claude\|anthropic\|co-authored"` should return 0
6. Count tests: should be ~2900-3100 (existing meaningful tests + new property tests)

COMMIT GUIDELINES:
- Vary commit message style: some lowercase, some capitalized, some with emoji, some without
- Examples: "add interactive demo", "perf: benchmark suite", "property tests for protocol correctness", "docs: security self-audit"
- Make each commit message sound different from the others
- Do NOT include "Co-Authored-By" in any commit

When done, list what you built and the final test count.
