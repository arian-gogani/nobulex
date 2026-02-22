# Incident Analysis Template

Use this template when documenting an AI agent incident. Kova capabilities that would have prevented or detected the issue are highlighted.

---

## 1. Incident Summary

| Field | Value |
|-------|-------|
| **Date** | |
| **Agent/System** | |
| **Severity** | Critical / High / Medium / Low |
| **Impact** | Users affected, data exposed, financial loss, etc. |

**One-line summary:**

---

## 2. Timeline

| Time (UTC) | Event |
|------------|-------|
| | |
| | |
| | |

---

## 3. Root Cause

**What happened?**

**Why did it happen?** (e.g., missing constraint, model drift, prompt injection, tool misuse)

**What was the failure mode?** (e.g., agent performed action it should not have; agent failed to perform required action; agent produced harmful output)

---

## 4. Kova Capabilities That Would Have Helped

| Capability | How it would have prevented/detected |
|------------|-------------------------------------|
| **Covenant constraints** | CCL `deny` or `permit` with conditions would have blocked the action |
| **Runtime enforcement** | Enforcement monitor gates tool/API access; violation is computationally impossible |
| **Canary tests** | Synthetic challenge would have caught the edge case before production |
| **External attestation** | Counterparty would have a signed record; agent couldn't lie about what happened |
| **Audit trail** | Hash-chained log would show exactly what was authorized and what was executed |
| **Breach detection** | Breach attestation would have triggered immediately |
| **Legal identity package** | Evidentiary export for regulators, courts, insurers |

---

## 5. Recommended Kova Deployment

| Step | Action |
|------|--------|
| 1 | Create covenant with constraints covering the failure mode |
| 2 | Run canary tests for the specific scenario |
| 3 | Enable enforcement monitor |
| 4 | Set up attestation with counterparties |
| 5 | Export LegalIdentityPackage for compliance |

---

## 6. Follow-up

- [ ] Covenant updated
- [ ] Canary tests added
- [ ] Compliance export generated
- [ ] Stakeholders notified
