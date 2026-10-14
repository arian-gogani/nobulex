# stripe-webhook-order-tests

A dependency-free test harness that asserts your Stripe webhook handler reaches
the CORRECT RESULTING STATE under adversarial event delivery (duplicates and
reordering), not merely that it returned a 2xx.

You inject three things through an adapter: how to reset your state to a clean
baseline, how to apply one event to your state, and how to read the current
resulting state. You also state an invariant, the rule that must hold no matter
what order events arrive in. The harness replays each scenario's orderings,
applies the events, reads the resulting state, and checks your invariant. It
reports which orderings violate it, with the exact delivered sequence.

## Why resulting state, and not delivery

Stripe's own documentation is explicit that delivery is adversarial:

- "Webhook endpoints might occasionally receive the same event more than once."
- "Stripe doesn't guarantee the delivery of events in the order that they're
  generated." and "Make sure that your event destination isn't dependent on
  receiving events in a specific order."
- A failed delivery is retried for up to three days with the original payload
  snapshot, so a stale `customer.subscription.updated(active)` can land after a
  `customer.subscription.deleted` for the same subscription.

A handler that returns 200 to all of those can still end in the wrong state: a
canceled subscription written back to active by a late, stale update. This
harness exists to catch that class.

## What it does NOT do

- It does not run your database, your ORM, or your framework. You inject state
  access; the harness never touches your infrastructure.
- It does not prove Stripe's delivery behavior. That behavior is documented
  (quoted above); the harness assumes it and tests YOUR handler against it.
- It does not certify your handler. A PASS means your handler held the invariant
  YOU stated across the orderings the harness tried. It is not a proof that the
  handler is correct in every other respect, nor that every possible ordering
  was tried (permutation count grows as n factorial and is capped at 7 events).
- It does not choose your invariant for you. If you state a weak invariant, a
  PASS means only that the weak invariant held.
- A scenario is INDETERMINATE, never PASS, when the harness could not decide:
  `apply()` or `read()` threw, or your `isActive`/predicate threw because it
  needed state the harness could not provide. Unknown never passes.

## Prior art, named honestly

- `stripe trigger`, `stripe events resend`, `stripe listen` (Stripe CLI): fire,
  redeliver, or forward events. They exercise DELIVERY and your parsing. They do
  not assert what your application state became, and `trigger` cannot deliver a
  controlled duplicate or a controlled ordering.
- `stripe-mock`: a stateless mock of the Stripe API. It does not deliver
  webhooks at all.
- `standardwebhooks`, `stripe-event-types`: signature verification and TypeScript
  typings. The signing and parsing layers, not the resulting-state layer.
- github.com/Zenn1t/stripe-webhooks-out-of-order: the closest prior art and worth
  reading. It replays every permutation and single-event duplicate of a
  subscription lifecycle against ITS OWN reference handlers (a NestJS+Prisma and
  a FastAPI implementation) and asserts final state, framing the problem the same
  way ("idempotence is not commutativity").

What this adds: it is a reusable harness you point at YOUR handler and YOUR
invariant, not a reference implementation with its own bundled handlers. You
bring the apply/read/reset adapter and the rule; it brings the scenario
generators, the ordering replay, the verdict discipline, and a self-proving
control.

## Verdicts

Per ordering the invariant returns `HELD`, `VIOLATED`, or `INDETERMINATE`. A
scenario folds those to one verdict:

- `PASS` the invariant HELD across all orderings tried.
- `FAIL` at least one ordering VIOLATED it; the violating sequence is printed.
- `INDETERMINATE` no VIOLATED, but at least one ordering could not be decided.

Precedence is VIOLATED over INDETERMINATE over HELD. One violating ordering is
not averaged away by many clean ones, and an undecidable ordering never counts
as a pass.

## Core API

```
import {
  event,
  duplicateDelivery,
  outOfOrder,
  staleAfterTerminal,
  replayAllOrderings,
  onceTerminalStaysTerminal,
  runScenario,
  runSuite,
  formatScenarioResult,
} from "./harness.mjs";
```

Build events:

- `event(type, object, { id, created })` returns a `StripeEventLike`
  `{ id, type, created, data: { object } }`. Pass a shared `id` for a duplicate.

Scenario generators (each returns `{ name, orderings }`):

- `duplicateDelivery(ev)` delivers the same event twice.
- `outOfOrder([e1, e2, ...])` delivers the set in every order.
- `staleAfterTerminal(terminalEvent, staleUpdate)` the confirmed defect shape:
  delivers the defect ordering (terminal first) and the control ordering (stale
  first).
- `replayAllOrderings(events)` every permutation (capped at 7 events).

Invariant helper:

- `onceTerminalStaysTerminal({ terminalEventTypes, isActive, name })` builds the
  "once canceled, a later stale update must not reactivate" rule. `isActive`
  reads YOUR resulting state and returns whether it is active; it decides what a
  null or absent row means, so a handler that cancels by deleting the row reads
  that as not-active.

You can also pass any `{ name, check({ finalState, deliveredEvents }) }` object
as the invariant; `check` returns `{ status, reason }`.

Adapter you provide:

- `reset()` optional, restores a clean baseline before each ordering.
- `apply(event)` applies one event to your state.
- `read()` returns the current resulting state.

Running:

- `runScenario(adapter, { ...generator, invariant })` runs one scenario.
- `runSuite(adapter, [scenario, ...])` rolls several up to one verdict.
- `formatScenarioResult(result)` renders printable text; only non-HELD orderings
  are printed, each with its exact sequence and the resulting state read.

### Smallest real use

```
import { staleAfterTerminal, onceTerminalStaysTerminal, runScenario, event, formatScenarioResult } from "./harness.mjs";

const scenario = {
  ...staleAfterTerminal(
    event("customer.subscription.deleted", { id: "sub_1", status: "canceled" }, { id: "evt_del", created: 200 }),
    event("customer.subscription.updated", { id: "sub_1", status: "active" },   { id: "evt_upd", created: 100 })
  ),
  invariant: onceTerminalStaysTerminal({
    terminalEventTypes: ["customer.subscription.deleted"],
    isActive: (state) => state != null && state.status === "active",
  }),
};

const adapter = {
  reset() { /* put your test row back to a clean baseline */ },
  async apply(ev) { /* call your real handler, or an adapter around it, with ev */ },
  async read() { /* return the subscription row your handler writes */ },
};

const result = await runScenario(adapter, scenario);
console.log(formatScenarioResult(result));
```

## Run the control

```
node selftest.mjs
```

or `npm test`. No install step; there are no dependencies to install.

The selftest points the harness at three broken reference handlers in
`examples/` and asserts each FAILS, then at a correct one and asserts it PASSES,
then mutates the harness and requires the selftest to go red. The three broken
shapes are:

- `naive-last-write-wins`: writes the payload status snapshot with no ordering
  guard; the last write wins.
- `dedupe-by-id-only`: correct under duplicates, but its only guard is an
  event-id dedupe, so two distinct events in the wrong order both apply.
- `create-path-hardcodes-active`: an update for a subscription that is not
  currently stored (the state after a deletion) is routed into a create path
  that hardcodes active, ignoring the payload status entirely.

The correct handler, `correct-refetch-precedence`, treats a deletion as terminal
and final and drops updates older than the newest applied event. A production
handler reaches the terminal rule by re-fetching the subscription from Stripe's
API before writing (the docs-sanctioned pattern); the example uses an in-memory
terminal lock so it has no dependencies. The broken/correct pair is the control:
it proves the harness is neither pass-everything nor refuse-everything.

The violating ordering each broken handler is flagged on is not hardcoded in the
selftest; it is asserted to be, in content, an ordering where the terminal event
precedes the stale update, and the `replayAllOrderings` section computes the
expected set of violating orderings independently and asserts the harness
reports exactly that set.

### Selftest output (verbatim)

```
== INNER ASSERTIONS ==

[broken] naive-last-write-wins
SCENARIO staleAfterTerminal  invariant=onceTerminalStaysTerminal  orderings=2  VERDICT=FAIL
  VIOLATED on ordering #1: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_stale_update,status=active)]
    reason: a terminal event was delivered yet the final state reads as active
    final state: {"subscriptionId":"sub_1","status":"active","plan":"pro"}
  ok: naive-last-write-wins verdict is FAIL (got FAIL)
  ok: naive-last-write-wins flags at least one violating ordering
  ok: naive-last-write-wins violating ordering has deleted BEFORE the stale update: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_stale_update,status=active)]
  ok: naive-last-write-wins HOLDS the control ordering (update then deleted)

[broken] dedupe-by-id-only
SCENARIO staleAfterTerminal  invariant=onceTerminalStaysTerminal  orderings=2  VERDICT=FAIL
  VIOLATED on ordering #1: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_stale_update,status=active)]
    reason: a terminal event was delivered yet the final state reads as active
    final state: {"status":"active"}
  ok: dedupe-by-id-only verdict is FAIL (got FAIL)
  ok: dedupe-by-id-only flags at least one violating ordering
  ok: dedupe-by-id-only violating ordering has deleted BEFORE the stale update: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_stale_update,status=active)]
  ok: dedupe-by-id-only HOLDS the control ordering (update then deleted)

[broken] create-path-hardcodes-active
SCENARIO staleAfterTerminal  invariant=onceTerminalStaysTerminal  orderings=2  VERDICT=FAIL
  VIOLATED on ordering #1: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_stale_update,status=past_due)]
    reason: a terminal event was delivered yet the final state reads as active
    final state: {"id":"sub_1","active":true,"plan":"pro"}
  ok: create-path-hardcodes-active verdict is FAIL (got FAIL)
  ok: create-path-hardcodes-active flags at least one violating ordering
  ok: create-path-hardcodes-active violating ordering has deleted BEFORE the stale update: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_stale_update,status=past_due)]
  ok: create-path-hardcodes-active HOLDS the control ordering (update then deleted)

[correct] correct-refetch-precedence
SCENARIO staleAfterTerminal  invariant=onceTerminalStaysTerminal  orderings=2  VERDICT=PASS
  all orderings HELD the invariant
  ok: correct-refetch-precedence verdict is PASS (got PASS)
  ok: correct-refetch-precedence HOLDS the invariant on every ordering

[replay] naive last-write-wins over 3 orderable events
SCENARIO replayAllOrderings  invariant=onceTerminalStaysTerminal  orderings=6  VERDICT=FAIL
  VIOLATED on ordering #4: [customer.subscription.updated(evt_pastdue,status=past_due), customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_active,status=active)]
    reason: a terminal event was delivered yet the final state reads as active
    final state: {"subscriptionId":"sub_1","status":"active","plan":"pro"}
  VIOLATED on ordering #6: [customer.subscription.deleted(evt_deleted,status=canceled), customer.subscription.updated(evt_pastdue,status=past_due), customer.subscription.updated(evt_active,status=active)]
    reason: a terminal event was delivered yet the final state reads as active
    final state: {"subscriptionId":"sub_1","status":"active","plan":"pro"}
  computed expected violating ordering indices: [3, 5]
  harness-reported violating ordering indices:  [3, 5]
  ok: replay verdict is FAIL (got FAIL)
  ok: harness violating-ordering set equals the independently computed set

== INNER RESULT: GREEN (0 failed assertion(s)) ==

== MUTATION TEST ==
disabling the load-bearing invariant check in a temp copy; the inner selftest MUST go red there
  mutated inner tail:
      computed expected violating ordering indices: [3, 5]
      harness-reported violating ordering indices:  []
      FAIL: replay verdict is FAIL (got PASS)
      FAIL: harness violating-ordering set equals the independently computed set

    == INNER RESULT: RED (8 failed assertion(s)) ==
  mutated inner exit code: 1
  ok: mutated inner selftest goes RED (nonzero exit), proving the invariant check is load-bearing

== SELFTEST: GREEN (0 failed assertion(s) total) ==
```

## Language and build decision

Plain Node ESM (`.mjs`) with JSDoc types, zero runtime dependencies, no build
step. The targets are TypeScript/Node, and Node 25 can strip types from `.ts`
files, but running a `.ts` entry still emits an experimental-feature warning on
current Node and native stripping rejects type syntax that needs real
transformation. A `.mjs` file with JSDoc runs on any Node 18 or newer with no
flags, no toolchain, and no warning, and editors still surface the JSDoc types
on hover and under `tsc --checkJs`. For a tool whose entire pitch is "a
maintainer can drop this in and run it," a zero-install, zero-build artifact is
the honest form. The `typedef`s in `harness.mjs` give a TypeScript consumer the
shapes without forcing a build on anyone.

## Known limits of this version

- Permutation count is n factorial; `replayAllOrderings` is capped at 7 events
  (5040 orderings) and throws above that. Pick the pairs that matter with
  `staleAfterTerminal` or `outOfOrder` for larger lifecycles.
- The harness tests the invariant you state against the resulting state you
  expose. It cannot test a property your `read()` does not reveal.
- Scenario generators cover duplication and reordering. They do not model
  partial failure and retry interleavings beyond what you encode as events, nor
  concurrency within a single `apply`.
- The example handlers reproduce defect SHAPES for the control. They are generic
  illustrations, not any specific project's code.
