# Kova Improvement Proposals (KIPs)

Structured process for proposing protocol changes. Anyone can submit a KIP.

---

## Process

1. **Draft**  - Create a KIP document (see template below). Open a GitHub Discussion or PR.
2. **Review**  - Community and maintainers review. Feedback period: 2 weeks minimum.
3. **Decision**  - Maintainers accept, reject, or request changes.
4. **Implementation**  - Accepted KIPs move to implementation. Author may implement or others may volunteer.

**Cadence:** Monthly KIP review cycle. KIPs are batched for each cycle.

---

## KIP Template

```markdown
# KIP-XXX: Title

**Status:** Draft | Under Review | Accepted | Rejected
**Author:** [name or GitHub handle]
**Created:** YYYY-MM-DD

## Summary
One paragraph describing the change.

## Motivation
Why is this change needed?

## Specification
Technical details. For protocol changes: exact behavior, API changes, migration path.

## Backward Compatibility
Does this break existing deployments? If yes, migration strategy.

## Alternatives Considered
What other approaches were considered and why rejected?
```

---

## KIP Index

| KIP | Title | Status |
|-----|-------|--------|
|  - | *(none yet)* |  - |

---

## Scope

KIPs cover:
- Protocol changes (CCL, covenant format, verification rules)
- New primitives or extensions
- Governance changes
- Breaking changes with migration path

KIPs do not cover:
- Bug fixes (use GitHub Issues)
- Documentation-only changes (use PRs)
- Package-internal refactors (use PRs)
