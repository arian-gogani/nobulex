"""Why a fresh key doesn't buy a clean record.

The first question a serious relying party asks about agent trust scores:

    "What stops a bad operator from deleting the key and making a new one?"

It's a good question. A human can't do that with a credit score, because
the SSN is scarce and issued by an authority. An agent key is free and
takes microseconds. If the score lives on the key, the score is theater.

Run this to see the attack, and why it fails:

    python sybil_resistance.py
"""

from nobulex import Agent, OperatorRegistry, VerificationLevel


def rule(title=""):
    print("\n" + "=" * 66)
    if title:
        print(title)
        print("=" * 66)


def main():
    registry = OperatorRegistry()

    # ------------------------------------------------------------------
    rule("THE ATTACK: burn the key, keep the business")
    # ------------------------------------------------------------------

    registry.register("shady-llc", "Shady LLC", VerificationLevel.KYB)

    caught = Agent("shady-agent-v1")
    registry.bind_agent("shady-llc", caught.public_key)

    # This agent got caught doing things it shouldn't. Its score reflects it.
    scores = {caught.public_key: 8.0}

    print(f"\n  agent v1 key       {caught.public_key[:16]}...")
    print(f"  agent v1 score     {scores[caught.public_key]}  (caught misbehaving)")
    print(f"  operator score     {registry.operator_score('shady-llc', scores)}")

    print("\n  > Operator deletes the key and generates a new one.")

    registry.abandon_agent(caught.public_key)
    reborn = Agent("shady-agent-v2")
    registry.bind_agent("shady-llc", reborn.public_key)
    scores[reborn.public_key] = 0.0

    op_score = registry.operator_score("shady-llc", scores)
    report = registry.report("shady-llc", scores)

    print(f"\n  agent v2 key       {reborn.public_key[:16]}...  (brand new)")
    print(f"  agent v2 own score {scores[reborn.public_key]}  <- clean, as expected")
    print("\n  But the file doesn't live on the key:")
    print(f"    operator score       {op_score}  <- the 8.0 survived the burn")
    print(f"    agents ever run      {report['total_agents_ever']}")
    print(f"    abandoned            {report['abandoned_agents']}")
    print(f"    churn ratio          {report['churn_ratio']}  <- the burn is visible")
    print(f"\n  agent v2 STARTS at   {registry.starting_score('shady-llc', op_score)}")
    print("  The new key inherits the operator's record. Nothing was escaped.")

    # ------------------------------------------------------------------
    rule("THE ATTACK, ONE LEVEL UP: fake operators instead of fake keys")
    # ------------------------------------------------------------------

    registry.register("anon", "Anonymous", VerificationLevel.UNVERIFIED)
    ghost = Agent("ghost")
    registry.bind_agent("anon", ghost.public_key)

    print("\n  > If keys don't work, register a fake operator and farm trust there.")
    print(f"\n  claimed operator score   99.0")
    print(f"  inherited by new agent   {registry.starting_score('anon', 99.0)}")
    print("\n  An unverified operator confers nothing. Anyone can claim to be")
    print("  Acme Corp. Only a verified one can vouch for anything.")

    # ------------------------------------------------------------------
    rule("THE HONEST OPERATOR: why anyone would bind keys at all")
    # ------------------------------------------------------------------

    registry.register("acme", "Acme Corporation", VerificationLevel.KYB)
    a1, a2 = Agent("acme-payments"), Agent("acme-support")
    registry.bind_agent("acme", a1.public_key)
    registry.bind_agent("acme", a2.public_key)

    good = {a1.public_key: 88.0, a2.public_key: 92.0}
    acme_score = registry.operator_score("acme", good)
    acme_report = registry.report("acme", good)

    print(f"\n  operator score     {acme_score}")
    print(f"  churn ratio        {acme_report['churn_ratio']}  (nothing to hide)")
    print(f"  verification       {acme_report['verification']}")
    print(f"\n  Acme's NEXT agent starts at {registry.starting_score('acme', acme_score)}, not 0.")
    print("  Same as a corporate card: the limit comes from the company,")
    print("  not from the plastic. That's the reason to bind keys instead")
    print("  of staying anonymous.")

    # ------------------------------------------------------------------
    rule("WHAT A RELYING PARTY ACTUALLY ASKS")
    # ------------------------------------------------------------------

    print("\n  Not 'does this key have receipts' but 'is anyone answerable'.\n")

    for label, key in [
        ("Acme agent   ", a1.public_key),
        ("Shady agent  ", reborn.public_key),
        ("Anon agent   ", ghost.public_key),
        ("Unbound key  ", Agent("nobody").public_key),
    ]:
        ok = registry.is_accountable(key, VerificationLevel.KYB)
        op = registry.operator_for(key)
        who = op.legal_name if op else "nobody"
        print(f"  {label}  KYB-accountable: {str(ok):5}  ->  {who}")

    print("\n  The Shady agent passes the accountability check, and that's")
    print("  correct: someone IS answerable for it. The check answers 'who',")
    print("  not 'are they any good'. The score answers the second question.")
    print()


if __name__ == "__main__":
    main()
