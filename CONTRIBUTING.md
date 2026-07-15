# Contributing to Nobulex

Thanks for your interest. Here's how to get started.

## Setup

```bash
git clone https://github.com/arian-gogani/nobulex.git
cd nobulex/packages/python
pip install cryptography rfc8785
python tests.py  # 13 tests, all should pass
```

## Architecture

- `nobulex/agent.py`  - Agent class, receipt generation
- `nobulex/crypto.py`  - Ed25519 signing, JCS canonicalization (RFC 8785), SHA-256
- `nobulex/receipt.py`  - Receipt data structure, verification, serialization
- `nobulex/chain.py`  - Hash-linked receipt chains, audit trail export
- `nobulex/trust.py`  - trust score scoring
- `nobulex/langchain.py`  - LangChain callback handler
- `nobulex/crewai.py`  - CrewAI tracker integration
- `nobulex/decorator.py`  - `@audited` function decorator
- `fixtures/bilateral-receipt/v0/`  - Cross-validated test vectors

## What we need help with

- **TypeScript/JS SDK**  - port the Python SDK to TypeScript
- **More framework integrations**  - AutoGen, LlamaIndex, Haystack
- **Test vectors**  - additional edge cases for canonicalization
- **Documentation**  - tutorials, guides, examples
- **PyPI publishing**  - help with CI/CD for automated releases

## Code style

- No unnecessary abstractions
- Every function should be testable
- Comments explain why, not what
- Lowercase commit messages, imperative mood

## Test vectors

If you add a new test vector to `fixtures/`, it must include:
- `preimage_fields` with all 4 canonical fields
- `expected_action_ref` (SHA-256 hex)
- Cross-validation against at least one other JCS implementation

## Questions?

Open an issue or reach out on X: [@nobulexlabs](https://x.com/nobulexlabs)
