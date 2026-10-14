// Reference handler: correct, with state precedence and a terminal lock.
//
// This is the control that proves the harness is not a refuse-everything tool.
// It holds the invariant across every ordering because it encodes two rules the
// broken handlers omit:
//
//   1. A deletion is terminal and final. Once a customer.subscription.deleted
//      has been applied, the subscription stays canceled; later updates for it
//      are ignored. (Stripe never un-deletes a subscription, so a later
//      updated(active) for a deleted subscription can only be a stale delivery.)
//   2. State precedence by event.created. An update older than the newest event
//      already applied is treated as stale and dropped, so two updates delivered
//      out of order still converge on the newest one.
//
// A production handler would reach rule 1 by re-fetching the subscription from
// Stripe's API before writing (the docs-sanctioned pattern) rather than trusting
// the payload; the terminal lock here is the in-memory equivalent for a
// dependency-free example. Generic illustration, not a copy of any project's code.

/**
 * @returns {import("../harness.mjs").Adapter}
 */
export function createAdapter() {
  /** @type {{ status: string | null } | null} */
  let row = null;
  let lastApplied = -Infinity; // highest event.created applied so far
  let terminal = false;

  return {
    reset() {
      row = { status: "active" };
      lastApplied = -Infinity;
      terminal = false;
    },
    apply(ev) {
      if (terminal) return; // deletion is final; never resurrect
      const created = typeof ev.created === "number" ? ev.created : 0;
      if (ev.type === "customer.subscription.deleted") {
        row.status = "canceled";
        terminal = true;
        lastApplied = Math.max(lastApplied, created);
        return;
      }
      if (ev.type === "customer.subscription.updated") {
        if (created < lastApplied) return; // stale: older than the newest applied event
        lastApplied = created;
        row.status = ev.data.object.status;
      }
    },
    read() {
      return row ? { ...row } : null;
    },
  };
}

/** @param {any} state */
export const isActive = (state) => state != null && state.status === "active";
