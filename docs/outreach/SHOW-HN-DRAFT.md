# Show HN: Nobulex - credit scores for AI agents (pip install nobulex)

**Title:** Show HN: Credit scores for AI agents - every action builds a verifiable track record

---

## Body

You wouldn't give someone a credit card without checking their credit
score. We give AI agents access to databases, bank accounts, and APIs
without checking theirs.

Nobulex is credit scores for machines. An agent commits to its rulebook
before it acts, every action leaves a signed receipt, and the verified
track record becomes portable trust. The credit history follows the
agent and determines what it's allowed to do.

```python
from nobulex import track

@track(agent_id="my-agent")
def send_payment(amount, to):
    return stripe.charges.create(amount=amount, currency="usd")

send_payment(500, "vendor")
print(send_payment.receipts)     # signed, tamper-evident
print(send_payment.trust_score)  # builds over time
```

Each receipt is Ed25519-signed over RFC 8785 canonical JSON. An auditor
verifies offline with only the public key. No operator trust required.

**What's built:**
- Python SDK: `pip install nobulex` (~13,700 receipts/sec Ed25519)
- TypeScript SDK: `npm install @nobulex/core`
- Hosted verification API with trust scoring and compliance reports
- Six framework integrations (LangChain, CrewAI, PydanticAI, ADK, Haystack, LlamaIndex)
- Dify plugin merged into official marketplace (90K+ star ecosystem)
- OWASP AST09: the action_ref reference implementation of the bilateral receipt pattern that is normative guidance
- x402 payment spec: referenced in an unmerged community PR (#2666), not a spec citation
- IETF conformance suite: 4/4 vectors pass

**Business model:** Credit-bureau economics. The SDK is free and open
source (MIT). The paid product is the hosted verification layer: managed
keys, compliance reports, the audit infrastructure enterprises can't
self-host. Everyone has to check the score. We hold the record.

**Why now:** EU AI Act Article 12 requires tamper-evident automatic
logging for high-risk AI systems (enforcement December 2, 2027). Nobody
in the agent stack ships this yet.

Try to break an agent protected by Nobulex receipts at
nobulex.com/arena. $7,400 bounty if you beat level 5. Nobody has.

Repo: github.com/arian-gogani/nobulex
Pricing: nobulex.com/pricing
Methodology: nobulex.com/methodology

I'm 16 and built this solo. Happy to answer questions on the scoring,
the crypto, or the compliance angle.

---

## Timing

Post Tuesday or Wednesday 9-10am ET.

Title options:
1. "Show HN: Credit scores for AI agents (pip install nobulex)"
2. "Show HN: Nobulex - every AI agent action builds a verifiable track record"
3. "Show HN: I'm 16. I built credit scores for machines."

Option 3 is the most clickable on HN. The age + "credit scores for
machines" combo is the hook. Use it if you want maximum engagement.
Option 1 is the safest. Lead with option 3 if you're feeling bold.
