// Reference handler: create-path-hardcodes-active.
//
// Stores subscriptions as rows keyed by id. A deleted event removes the row.
// An update for a subscription id that is not currently stored (which is
// exactly the state after a deleted event has been processed) is routed into a
// create path, and that create path hardcodes active = true, never reading the
// payload status at all. So a deleted followed by ANY stale update, even one
// whose own payload says past_due, re-creates the subscription as active.
//
// This is the worst shape of the family: the resurrected row is active not
// because the stale payload said so, but because the create path cannot say
// anything else. Generic illustration, not a copy of any specific project's code.

/**
 * @returns {import("../harness.mjs").Adapter}
 */
export function createAdapter() {
  /** @type {Map<string, { id: string, active: boolean, plan: string | null }>} */
  let rows;

  return {
    reset() {
      rows = new Map([["sub_1", { id: "sub_1", active: true, plan: "pro" }]]);
    },
    apply(ev) {
      const obj = ev.data.object;
      if (ev.type === "customer.subscription.updated") {
        if (!rows.has(obj.id)) {
          // create path: active is hardcoded true, obj.status is never read
          rows.set(obj.id, { id: obj.id, active: true, plan: obj.plan });
        } else {
          rows.get(obj.id).active = obj.status === "active";
        }
      } else if (ev.type === "customer.subscription.deleted") {
        rows.delete(obj.id);
      }
    },
    read() {
      return rows.has("sub_1") ? { ...rows.get("sub_1") } : null;
    },
  };
}

/** @param {any} state */
export const isActive = (state) => state != null && state.active === true;
