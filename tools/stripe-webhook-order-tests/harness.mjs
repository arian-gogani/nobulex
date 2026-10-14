// stripe-webhook-order-tests: a dependency-free harness that asserts a Stripe
// webhook handler reaches the CORRECT RESULTING STATE under adversarial event
// delivery (duplicates and reordering), not merely that it returned 2xx.
//
// The developer injects three things through an adapter: a way to reset state
// to a clean baseline, a way to apply one event to their state, and a way to
// read the current resulting state. The developer also states an invariant.
// The harness replays each scenario's orderings, applies the events, reads the
// resulting state, and checks the invariant. It reports which orderings violate
// it, with the exact delivered sequence.
//
// Zero runtime dependencies. Node ESM, runs on any Node >= 18 with no flags and
// no build step. See README.md for the language decision.

/**
 * @typedef {Object} StripeEventLike
 * @property {string} id    a stable event id (Stripe event ids are unique per event)
 * @property {string} type  e.g. "customer.subscription.updated"
 * @property {number} [created]  seconds since epoch; present on real events, optional here
 * @property {{ object: any }} data  the event payload; data.object is the snapshot
 */

/**
 * @typedef {Object} Adapter
 * @property {() => (void | Promise<void>)} [reset]  put the state under test back to a clean baseline before each ordering
 * @property {(event: StripeEventLike) => (void | Promise<void>)} apply  apply one event to the state under test
 * @property {() => (any | Promise<any>)} read  read the current resulting state
 */

/**
 * @typedef {"HELD" | "VIOLATED" | "INDETERMINATE"} InvariantStatus
 */

/**
 * @typedef {Object} InvariantResult
 * @property {InvariantStatus} status
 * @property {string} [reason]
 */

/**
 * @typedef {Object} Invariant
 * @property {string} name
 * @property {(ctx: { finalState: any, deliveredEvents: StripeEventLike[] }) => InvariantResult} check
 */

/**
 * @typedef {Object} Scenario
 * @property {string} name
 * @property {StripeEventLike[][]} orderings  each ordering is one delivery sequence
 */

const MAX_PERMUTATION_EVENTS = 7; // 7! = 5040 orderings; refuse larger to stay fast and honest

// --- event construction ----------------------------------------------------

let _autoId = 0;

/**
 * Build a StripeEventLike. Pass an explicit id when you need determinism or a
 * duplicate (two deliveries of the same event share one id).
 * @param {string} type
 * @param {any} object  the event payload snapshot (becomes data.object)
 * @param {{ id?: string, created?: number }} [meta]
 * @returns {StripeEventLike}
 */
export function event(type, object, meta = {}) {
  const id = meta.id || `evt_auto_${++_autoId}`;
  const created = meta.created == null ? 0 : meta.created;
  return { id, type, created, data: { object } };
}

// --- scenario generators ----------------------------------------------------

/**
 * Permutations of an array. Refuses more than MAX_PERMUTATION_EVENTS elements.
 * @template T
 * @param {T[]} arr
 * @returns {T[][]}
 */
export function permutations(arr) {
  if (arr.length > MAX_PERMUTATION_EVENTS) {
    throw new Error(
      `replayAllOrderings refuses ${arr.length} events (` +
        `${arr.length}! orderings). Keep it to ${MAX_PERMUTATION_EVENTS} or fewer, ` +
        `or pick the specific pairs that matter with staleAfterTerminal / outOfOrder.`
    );
  }
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const tail of permutations(rest)) {
      out.push([arr[i], ...tail]);
    }
  }
  return out;
}

/**
 * Deliver the same event twice. Guards the duplicate-delivery axis Stripe's
 * docs warn about ("might occasionally receive the same event more than once").
 * @param {StripeEventLike} ev
 * @returns {Scenario}
 */
export function duplicateDelivery(ev) {
  return { name: "duplicateDelivery", orderings: [[ev, ev]] };
}

/**
 * Deliver a set of events in every order. For two events this is the classic
 * reordering pair; for more it is every permutation.
 * @param {StripeEventLike[]} events
 * @returns {Scenario}
 */
export function outOfOrder(events) {
  return { name: "outOfOrder", orderings: permutations(events) };
}

/**
 * The confirmed defect shape: a terminal event (e.g. customer.subscription.deleted)
 * and a stale update that, if applied after the terminal, resurrects the
 * subscription. Delivers both the defect ordering (terminal first) and the
 * control ordering (stale first). A correct handler holds the invariant in both.
 * @param {StripeEventLike} terminalEvent
 * @param {StripeEventLike} staleUpdate
 * @returns {Scenario}
 */
export function staleAfterTerminal(terminalEvent, staleUpdate) {
  return {
    name: "staleAfterTerminal",
    orderings: [
      [terminalEvent, staleUpdate], // defect ordering: terminal, then stale update
      [staleUpdate, terminalEvent], // control ordering: update, then terminal
    ],
  };
}

/**
 * Try every ordering of the given events.
 * @param {StripeEventLike[]} events
 * @returns {Scenario}
 */
export function replayAllOrderings(events) {
  return { name: "replayAllOrderings", orderings: permutations(events) };
}

// --- invariant helpers ------------------------------------------------------

/**
 * Invariant: once a terminal event (such as customer.subscription.deleted) has
 * been delivered in an ordering, the final resulting state must not read as
 * active. This is exactly the "once canceled, a later stale update must not
 * reactivate" rule. If no terminal event was delivered in an ordering the
 * invariant is vacuously HELD for that ordering.
 * @param {Object} opts
 * @param {string[]} opts.terminalEventTypes  event types that make the subscription terminal
 * @param {(state: any) => boolean} opts.isActive  reads the resulting state, returns whether it is active
 * @param {string} [opts.name]
 * @returns {Invariant}
 */
export function onceTerminalStaysTerminal(opts) {
  const { terminalEventTypes, isActive } = opts;
  const name = opts.name || "onceTerminalStaysTerminal";
  return {
    name,
    check({ finalState, deliveredEvents }) {
      const sawTerminal = deliveredEvents.some((e) =>
        terminalEventTypes.includes(e.type)
      );
      if (!sawTerminal) {
        return { status: "HELD", reason: "no terminal event delivered in this ordering" };
      }
      // The developer's isActive decides what the resulting state means,
      // including what a null or absent row means (a handler that models
      // cancellation by deleting the row will read that as not-active). The
      // harness does not guess. Only an isActive that THROWS, because it needs
      // state the harness could not provide, yields INDETERMINATE here; a
      // read() or apply() that threw is already INDETERMINATE upstream.
      let active;
      try {
        active = isActive(finalState);
      } catch (err) {
        return {
          status: "INDETERMINATE",
          reason: "isActive() threw while reading state: " + (err && err.message),
        };
      }
      if (active) {
        return {
          status: "VIOLATED",
          reason:
            "a terminal event was delivered yet the final state reads as active",
        };
      }
      return {
        status: "HELD",
        reason: "terminal event delivered and the final state does not read as active",
      };
    },
  };
}

// --- running ----------------------------------------------------------------

/**
 * Fold a list of per-ordering statuses into one scenario verdict.
 * Precedence: any VIOLATED -> FAIL; else any INDETERMINATE -> INDETERMINATE;
 * else PASS. Unknown never passes.
 * @param {InvariantStatus[]} statuses
 * @returns {"PASS" | "FAIL" | "INDETERMINATE"}
 */
export function rollup(statuses) {
  if (statuses.some((s) => s === "VIOLATED")) return "FAIL";
  if (statuses.some((s) => s === "INDETERMINATE")) return "INDETERMINATE";
  return "PASS";
}

function evaluateInvariant(invariant, ctx) {
  // MUTATION-SENTINEL: the next line is the load-bearing invariant check. The
  // selftest's mutation test replaces it with a constant HELD and requires the
  // selftest to go red, proving this check actually decides the verdict.
  const invariantResult = invariant.check(ctx);
  return invariantResult;
}

/**
 * Run one scenario against an adapter and a stated invariant.
 * @param {Adapter} adapter
 * @param {Scenario & { invariant: Invariant }} scenario
 * @returns {Promise<{ name: string, invariantName: string, orderingsTested: number, results: Array<{ ordering: StripeEventLike[], finalState: any, status: InvariantStatus, reason?: string }>, verdict: "PASS" | "FAIL" | "INDETERMINATE" }>}
 */
export async function runScenario(adapter, scenario) {
  if (!scenario || !scenario.invariant) {
    throw new Error("runScenario requires scenario.invariant (the rule you are asserting)");
  }
  const results = [];
  for (const ordering of scenario.orderings) {
    if (adapter.reset) await adapter.reset();
    let applyError = null;
    for (const ev of ordering) {
      try {
        await adapter.apply(ev);
      } catch (err) {
        applyError = err;
        break;
      }
    }
    let finalState;
    let readError = null;
    try {
      finalState = await adapter.read();
    } catch (err) {
      readError = err;
    }

    let result;
    if (applyError) {
      result = {
        status: "INDETERMINATE",
        reason:
          "apply() threw, so this ordering could not be delivered in full: " +
          (applyError && applyError.message),
      };
    } else if (readError) {
      result = {
        status: "INDETERMINATE",
        reason: "read() threw: " + (readError && readError.message),
      };
    } else {
      result = evaluateInvariant(scenario.invariant, {
        finalState,
        deliveredEvents: ordering,
      });
    }
    results.push({ ordering, finalState, ...result });
  }
  return {
    name: scenario.name,
    invariantName: scenario.invariant.name,
    orderingsTested: results.length,
    results,
    verdict: rollup(results.map((r) => r.status)),
  };
}

/**
 * Run several scenarios and roll their verdicts up to one suite verdict.
 * @param {Adapter} adapter
 * @param {Array<Scenario & { invariant: Invariant }>} scenarios
 */
export async function runSuite(adapter, scenarios) {
  const scenarioResults = [];
  for (const s of scenarios) {
    scenarioResults.push(await runScenario(adapter, s));
  }
  const verdicts = scenarioResults.map((r) => r.verdict);
  let overall = "PASS";
  if (verdicts.some((v) => v === "FAIL")) overall = "FAIL";
  else if (verdicts.some((v) => v === "INDETERMINATE")) overall = "INDETERMINATE";
  return { scenarios: scenarioResults, overall };
}

// --- formatting -------------------------------------------------------------

/**
 * One-line human description of an event, including a status snapshot if the
 * payload carries one.
 * @param {StripeEventLike} ev
 */
export function describeEvent(ev) {
  const obj = ev && ev.data && ev.data.object;
  const status =
    obj && typeof obj === "object" && "status" in obj ? `,status=${obj.status}` : "";
  return `${ev.type}(${ev.id}${status})`;
}

/**
 * Describe one ordering as "[a, b, c]".
 * @param {StripeEventLike[]} ordering
 */
export function describeOrdering(ordering) {
  return "[" + ordering.map(describeEvent).join(", ") + "]";
}

/**
 * Render a scenario result as printable text. Every violating and indeterminate
 * ordering is printed with its exact sequence and the resulting state read.
 * @param {Awaited<ReturnType<typeof runScenario>>} r
 */
export function formatScenarioResult(r) {
  const lines = [];
  lines.push(
    `SCENARIO ${r.name}  invariant=${r.invariantName}  orderings=${r.orderingsTested}  VERDICT=${r.verdict}`
  );
  for (let i = 0; i < r.results.length; i++) {
    const res = r.results[i];
    if (res.status === "HELD") continue; // print only what is not clean
    lines.push(
      `  ${res.status} on ordering #${i + 1}: ${describeOrdering(res.ordering)}`
    );
    lines.push(`    reason: ${res.reason}`);
    lines.push(`    final state: ${JSON.stringify(res.finalState)}`);
  }
  if (r.results.every((res) => res.status === "HELD")) {
    lines.push("  all orderings HELD the invariant");
  }
  return lines.join("\n");
}
