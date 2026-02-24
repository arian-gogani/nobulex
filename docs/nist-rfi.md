# Response to NIST Request for Information: AI Agent Security

**Docket Number:** NIST-2025-AI-AGENT-SECURITY
**Date:** February 24, 2026

---

## Submitting Organization

Nobulex Labs

## Point of Contact

Arian Gogani, Founder
nobulex.com

## Executive Summary

Nobulex Labs respectfully submits this response to the National Institute of Standards and Technology's Request for Information on AI agent security. Nobulex provides an open-source cryptographic accountability protocol that addresses a structural gap in current AI security frameworks: the absence of verifiable behavioral accountability for autonomous AI agents at runtime.

NIST's AI Risk Management Framework (AI 100-1) and Generative AI Profile (AI 600-1) establish comprehensive guidance for trustworthy AI systems. However, these frameworks primarily address model-level properties such as training data provenance, bias mitigation, and output filtering. As AI agents transition from advisory systems to autonomous actors capable of executing transactions, invoking tools, and operating across organizational boundaries, a new category of security concern emerges: whether an agent's runtime behavior conforms to its stated operational policies, and whether that conformance can be independently verified.

Nobulex is a cryptographic protocol that enables AI agents to declare behavioral commitments in a machine-readable specification language, maintain tamper-evident logs of all actions taken, and submit to deterministic verification of compliance. The protocol is fully implemented as an open-source TypeScript library under the MIT license, with on-chain enforcement contracts deployed on EVM-compatible networks. This response details how the protocol maps to existing NIST frameworks and proposes that behavioral accountability be recognized as a distinct category in AI agent security guidance.

## 1. Identification of the Problem

AI agents are rapidly evolving from passive response systems into autonomous actors. Contemporary agent architectures grant AI systems the ability to execute multi-step plans, invoke external tools and APIs, manage financial transactions, access sensitive data stores, and coordinate with other agents across organizational boundaries. This autonomy introduces security concerns that existing frameworks do not adequately address.

Current AI safety mechanisms operate primarily at the model level. Reinforcement Learning from Human Feedback (RLHF) shapes model tendencies during training. Guardrail systems filter inputs and outputs at inference time. Rate limiting and access controls restrict the volume and scope of agent activity. These mechanisms are valuable but share a common limitation: they are probabilistic. They reduce the likelihood of undesirable behavior without providing cryptographic guarantees that specific behavioral policies have been followed.

The result is an accountability gap. When an AI agent operates on behalf of an organization or individual, there is currently no standard mechanism to answer the following questions with cryptographic certainty:

- What behavioral policies was this agent committed to at the time of operation?
- Did the agent's actions conform to those policies?
- Can a third party independently verify this conformance without access to the agent's internal state?
- What are the consequences if the agent violated its stated policies?

This gap is distinct from model safety. A model may be well-aligned in the RLHF sense and still be deployed in an agent architecture that permits actions inconsistent with the operator's stated policies. Conversely, a model with known limitations can operate safely within a properly constrained agent architecture. Behavioral accountability operates at the agent architecture level, not the model level.

## 2. The Behavioral Accountability Gap

### 2.1 Mapping to NIST AI 100-1 (AI Risk Management Framework)

The AI RMF defines four core functions: Map, Measure, Manage, and Govern. Nobulex's protocol primitives address each function as applied to agent runtime behavior.

**Map Function.** The AI RMF's Map function calls for identifying and documenting context, including the intended purpose and expected behavior of AI systems. Nobulex covenants formalize behavioral expectations as machine-readable specifications. A covenant declares what actions an agent may take, what resources it may access, what rate limits apply, and what audit requirements must be satisfied. This converts implicit behavioral expectations into explicit, verifiable artifacts.

**Measure Function.** The Measure function requires mechanisms to assess AI system behavior against identified metrics. Nobulex action logs provide deterministic measurement of agent behavior. Every action taken by a covenanted agent is recorded in a SHA-256 hash-chained log that is tamper-evident by construction. Compliance is measured not by statistical sampling but by exhaustive comparison of logged actions against covenant constraints.

**Manage Function.** The Manage function addresses risk response, including mechanisms to prevent or mitigate identified risks. Nobulex enforcement middleware evaluates each proposed action against the agent's covenant constraints before execution. Actions that would violate the covenant are blocked. For deployed agents where pre-execution enforcement is not feasible, the staking and slashing mechanism provides economic deterrence against violations.

**Govern Function.** The Govern function addresses organizational accountability structures. Nobulex covenant composability enables hierarchical governance over agent fleets. An organization can define a parent covenant specifying organization-wide constraints, with individual agent covenants inheriting and specializing those constraints. This supports the delegation of authority while maintaining organizational oversight.

### 2.2 Mapping to NIST AI 600-1 (Generative AI Profile)

AI 600-1 identifies risks specific to generative AI systems. Several of these risks are directly addressed by behavioral accountability infrastructure.

**Content Provenance.** AI 600-1 identifies the need to track the provenance of AI-generated content and actions. Nobulex action logs provide a tamper-evident audit trail that records every action an agent takes, including the covenant under which it operated, the timestamp, and the cryptographic hash linking each entry to its predecessor.

**Harmful Content and Action Prevention.** AI 600-1 addresses risks from AI systems generating harmful content or taking harmful actions. Nobulex covenant middleware blocks forbidden actions at the pre-execution layer. Unlike output filters that operate on generated text, covenant middleware evaluates the semantic intent of an action against a formally specified policy before the action is dispatched.

**Third-Party Plugin and Tool Risks.** AI 600-1 identifies risks arising from AI systems interacting with third-party tools and plugins. Nobulex covenants constrain which tools an agent may access, what parameters it may pass, and at what frequency. This provides a declarative security boundary for tool use that is independent of the tool provider's own access controls.

## 3. Proposed Solution: The Covenant Protocol

The Nobulex protocol is built on six core primitives, each addressing a specific aspect of behavioral accountability.

**1. Identity.** Every agent in the Nobulex protocol is assigned a decentralized identifier (DID) conforming to the W3C DID Core specification. This provides a persistent, cryptographically verifiable identity that is not dependent on any single platform or registry. Agent identities support key rotation, lineage tracking, and binding to Trusted Execution Environment attestations.

**2. Covenant.** A covenant is a behavioral specification written in CCL (Covenant Constraint Language), a domain-specific language influenced by the Cedar policy language. Covenants declare permitted and denied actions, resource access patterns with glob-based matching, rate limits, and audit requirements. The language follows a default-deny model: any action not explicitly permitted is forbidden.

**3. Attestation.** An attestation is a cryptographic binding between an agent identity and a covenant. Implemented as a structure analogous to W3C Verifiable Credentials, attestations are signed by the covenant issuer using Ed25519 and include a cryptographic nonce for replay protection. Attestations establish that a specific agent has committed to a specific set of behavioral constraints at a specific point in time.

**4. Action Log.** The action log is a hash-chained, tamper-evident record of every action taken by a covenanted agent. Each entry contains the action description, the resource affected, the timestamp, the result of constraint evaluation, and a SHA-256 hash of the previous entry. This structure ensures that any modification to the log is detectable and that the log can be independently verified.

**5. Verification.** Verification is a deterministic compliance-checking function that evaluates an agent's action log against its covenant constraints. The verification engine performs 11 distinct checks, including document integrity, signature validity, expiration status, constraint parsing, enforcement configuration validity, chain depth, and replay protection. Verification requires only the covenant, the action log, and the issuer's public key. It does not require access to the agent's internal state.

**6. Enforcement.** Enforcement provides consequences for covenant violations through two mechanisms. The on-chain staking mechanism, implemented in Solidity smart contracts (StakeManager, SlashingJudge, CovenantRegistry), requires agents to post collateral against their behavioral commitments. Verified violations trigger proportional slashing with configurable escalation. The middleware mechanism intercepts actions at the pre-execution layer, preventing violations before they occur.

## 4. Two-Tier Security Model

The protocol implements a two-tier security model that maps to different risk levels as contemplated by NIST guidance.

**Tier 1: Physical Impossibility.** For high-risk agent deployments, covenant enforcement middleware executes within a Trusted Execution Environment (TEE). The protocol supports Intel SGX, Intel TDX, and AMD SEV-SNP attestation. TEE-enforced middleware provides hardware-attested guarantees that the enforcement code has not been tampered with and that covenant constraints are evaluated faithfully. In this tier, covenant violations are not merely detectable but are rendered physically impossible by the hardware isolation boundary. The agent's DID is cryptographically bound to the enclave measurement, ensuring that attestation of the enforcement environment can be independently verified.

**Tier 2: Economic Deterrence.** For lower-risk deployments where TEE enforcement is not practical, economic deterrence is achieved through on-chain staking and slashing. Agents post collateral proportional to the risk level of their operations. Verified covenant violations trigger automatic slashing with escalation for repeat offenses, as implemented in the SlashingJudge contract. This tier does not prevent violations but ensures that violations carry quantifiable economic consequences.

This two-tier structure maps naturally to risk-based approaches in NIST guidance. Organizations can select the appropriate enforcement tier based on the sensitivity and potential impact of the agent's operations.

## 5. Alignment with NIST Frameworks

### 5.1 AI Risk Management Framework (AI RMF 1.0)

| AI RMF Function | AI RMF Category | Nobulex Primitive | Implementation |
|---|---|---|---|
| Map | Context identification | Covenant | Behavioral expectations formalized as CCL specifications |
| Map | Risk framing | Covenant composability | Hierarchical constraints model organizational risk tolerance |
| Measure | Assessment | Action log + Verification | Deterministic compliance measurement via 11-check engine |
| Measure | Monitoring | Enforcement middleware | Continuous real-time evaluation of agent actions |
| Manage | Response | Slashing | Proportional economic consequences for verified violations |
| Manage | Prevention | TEE middleware | Pre-execution blocking of covenant-violating actions |
| Govern | Accountability | DID + Attestation | Cryptographic binding of agent identity to behavioral commitments |
| Govern | Oversight | Covenant hierarchy | Organizational governance over agent fleets |

### 5.2 Cybersecurity Framework (CSF 2.0)

The Nobulex protocol maps to the five core functions of the NIST Cybersecurity Framework 2.0.

**Identify.** DID-based agent identity provides persistent, verifiable identification of every autonomous agent in an organizational ecosystem. Covenant specifications serve as asset inventories for behavioral expectations.

**Protect.** Covenant middleware enforcement provides access control at the behavioral level. Covenants specify not only what resources an agent may access but what actions it may take on those resources, at what frequency, and under what conditions. TEE attestation provides hardware-backed assurance that protective controls have not been circumvented.

**Detect.** The verification engine provides deterministic detection of covenant violations. Unlike anomaly-based detection systems, covenant verification evaluates compliance against a formally specified policy, producing a binary determination with cryptographic evidence.

**Respond.** The slashing mechanism provides an automated response to detected violations. Escalation parameters ensure that repeated violations produce proportionally greater consequences. The on-chain nature of the slashing mechanism ensures that response actions are transparent and auditable.

**Recover.** Covenant composability and trust topology analysis enable organizations to assess the impact of agent misbehavior on dependent systems and to adjust behavioral constraints accordingly. The attestation revocation mechanism allows compromised agent identities to be invalidated across the trust network.

### 5.3 Secure Software Development Framework (SSDF)

The protocol aligns with NIST's Secure Software Development Framework (SP 800-218) in the following respects.

**Security Requirements.** Covenants serve as machine-readable security requirements for agent behavior. Unlike natural-language policy documents, covenants are parsed and enforced programmatically, eliminating ambiguity in requirement interpretation.

**Audit Evidence.** Hash-chained action logs provide audit evidence that satisfies chain-of-custody requirements. Each log entry is cryptographically linked to its predecessor, and the complete log can be verified against the covenant specification without access to the agent's runtime environment.

**Continuous Monitoring.** The enforcement middleware provides continuous monitoring of agent behavior against covenant constraints. Every action is evaluated before execution, and all evaluation results are recorded in the action log.

## 6. Standards Alignment

The Nobulex protocol is designed for interoperability with existing and emerging standards.

- **W3C DID Core (Decentralized Identifiers v1.0).** Agent identities conform to the DID specification, enabling resolution across decentralized identity networks.
- **W3C Verifiable Credentials Data Model.** Attestation structures follow the Verifiable Credentials pattern, enabling interoperability with existing credential verification infrastructure.
- **TEE Attestation Standards.** The protocol supports Intel SGX (DCAP attestation), Intel TDX, and AMD SEV-SNP remote attestation, with verification of platform endorsements and TCB (Trusted Computing Base) status.
- **EVM/Solidity.** On-chain enforcement contracts (CovenantRegistry, StakeManager, SlashingJudge) are implemented in Solidity 0.8.20 for deployment on EVM-compatible networks.
- **Cedar Policy Language.** The Covenant Constraint Language (CCL) draws design principles from the Cedar policy language, including default-deny semantics, resource glob matching, and deterministic evaluation.

## 7. Implementation Readiness

The Nobulex protocol is not a theoretical proposal. It is a fully implemented, tested, and open-source system.

- **License:** MIT (permissive open source)
- **Language:** TypeScript (strict mode)
- **Package Count:** 54 packages organized in a monorepo architecture across foundation, enforcement, protocol, and platform layers
- **Test Coverage:** Over 5,000 passing tests across 92 test suites
- **On-Chain Contracts:** 3 compiled Solidity contracts (CovenantRegistry, StakeManager, SlashingJudge)
- **Framework Integration:** ElizaOS plugin demonstrating integration with existing agent frameworks
- **CLI Tooling:** Command-line interface for covenant creation, verification, and management
- **TEE Support:** Attestation primitives for Intel SGX, Intel TDX, and AMD SEV-SNP with DID binding
- **MCP Integration:** Model Context Protocol middleware guard for tool-call enforcement

The implementation is available for review, testing, and evaluation at the repository referenced on nobulex.com.

## 8. Recommendations to NIST

Based on our experience designing and implementing behavioral accountability infrastructure for AI agents, we respectfully offer the following recommendations.

**1. Establish behavioral accountability as a distinct category in AI agent security guidance.** Model safety and behavioral accountability address different threat surfaces. An agent's runtime behavior may diverge from its model's training-time properties due to architectural decisions, tool access patterns, and multi-agent coordination dynamics. NIST guidance should recognize this distinction and provide specific controls for each.

**2. Define standards for agent behavioral specification.** Model cards document model-level properties. An analogous standard for agent-level behavioral specifications would enable interoperability, auditing, and regulatory compliance. Such a standard should support machine-readable constraint languages with deterministic evaluation semantics.

**3. Require tamper-evident action logging for high-risk AI agent deployments.** Agents operating in high-risk domains (financial services, healthcare, critical infrastructure) should maintain hash-chained action logs that can be independently verified. This is analogous to audit logging requirements in existing IT security frameworks but adapted for the specific characteristics of autonomous agent operations.

**4. Recognize TEE attestation as a hardware security control for agent middleware.** Trusted Execution Environments provide hardware-backed guarantees that enforcement middleware has not been modified. NIST guidance should recognize TEE attestation (SGX, TDX, SEV-SNP) as a valid security control for agent behavioral enforcement, distinct from software-only enforcement mechanisms.

**5. Include cryptographic verification of agent behavior in compliance frameworks.** Compliance assessment for AI agent deployments should include the ability to cryptographically verify that an agent's actions conformed to its stated behavioral policies. This moves compliance from attestation-based (the operator claims the agent behaved correctly) to evidence-based (the action log proves the agent behaved correctly).

## 9. Conclusion

The deployment of autonomous AI agents at scale introduces a category of security concern that existing frameworks address incompletely. Model-level safety properties, while necessary, are not sufficient to ensure that agent runtime behavior conforms to organizational policies and regulatory requirements. Behavioral accountability infrastructure, consisting of formal behavioral specifications, tamper-evident action logging, deterministic verification, and enforceable consequences for violations, provides the missing layer.

Nobulex offers a concrete, implemented solution that maps directly to the NIST AI Risk Management Framework, Cybersecurity Framework 2.0, Generative AI Profile, and Secure Software Development Framework. The protocol is open-source, standards-aligned, and ready for evaluation and standardization discussion.

We welcome the opportunity to engage with NIST in developing guidance that addresses behavioral accountability for autonomous AI agents and to provide technical demonstrations of the protocol's capabilities.

---

*Submitted by Nobulex Labs. This document is approved for public distribution.*
