// Reference handler: naive last-write-wins.
//
// Writes the status snapshot carried in the event payload straight to the
// subscription row, with no ordering guard, no re-fetch from the API, and no
// state precedence. Whatever event is applied last decides the stored status.
// A stale customer.subscription.updated(active) applied after a
// customer.subscription.deleted therefore resurrects the canceled row.
//
// This reproduces the SHAPE of a last-write-wins webhook handler. It is a
// generic illustration, not a copy of any specific project's code.

/**
 * @returns {import("../harness.mjs").Adapter}
 */
export function createAdapter() {
  /** @type {{ subscriptionId: string | null, status: string | null, plan: string | null } | null} */
  let row = null;

  return {
    reset() {
      row = { subscriptionId: "sub_1", status: "active", plan: "pro" };
    },
    apply(ev) {
      const obj = ev.data.object;
      if (ev.type === "customer.subscription.updated") {
        // last write wins: the payload snapshot is trusted unconditionally
        row.status = obj.status;
        row.subscriptionId = obj.id;
        row.plan = obj.plan;
      } else if (ev.type === "customer.subscription.deleted") {
        row.status = "canceled";
        row.subscriptionId = null;
        row.plan = null;
      }
    },
    read() {
      return row ? { ...row } : null;
    },
  };
}

/** @param {any} state */
export const isActive = (state) => state != null && state.status === "active";
