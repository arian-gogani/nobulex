# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@stelelabs.com** with:

- Description of the vulnerability
- Steps to reproduce
- Affected packages and versions
- Severity assessment (your best judgment)
- Any suggested fix, if you have one

## Response Timeline

| Action | Timeframe |
|---|---|
| Acknowledgment of report | 48 hours |
| Initial assessment | 7 days |
| Fix development and review | Best effort, typically 30 days |
| Coordinated disclosure | 90 days from report |

We follow a **90-day disclosure window**. If a fix is not released within 90 days of the initial report, the reporter may disclose publicly. We will work with reporters to coordinate disclosure timing when possible.

## Scope

The following are in scope:

- All `@stele/*` packages published to npm
- The Stele protocol implementation (cryptographic operations, proof generation, verification)
- Covenant parsing and CCL evaluation
- Merkle tree construction and proof verification
- Key management and signature operations
- ZK circuit compilation and proof generation

The following are out of scope:

- Vulnerabilities in third-party dependencies (report these upstream, but do let us know)
- Social engineering attacks
- Denial of service without a novel vector

## Safe Harbor

We will not pursue legal action against researchers who:

- Report vulnerabilities through the process described above
- Avoid accessing or modifying data belonging to others
- Do not exploit vulnerabilities beyond what is necessary to demonstrate the issue
- Allow reasonable time for remediation before disclosure

## Recognition

We maintain a security acknowledgments page for researchers who report valid vulnerabilities. Let us know in your report if you'd like to be credited and how.
