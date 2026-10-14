// Reference handler: dedupe-by-id-only.
//
// Records every processed event id and skips a repeat of the same id, so it is
// correct under DUPLICATE delivery. But the dedupe is the handler's only guard:
// two DISTINCT events (different ids) in the wrong order both pass it, and each
// writes its own payload status snapshot. A deleted followed by a stale
// updated(active), being two distinct ids, both apply, and the subscription is
// resurrected.
//
// This reproduces the SHAPE of a handler whose idempotency layer is keyed on
// event id alone. Dedupe is not commutativity. Generic illustration, not a copy
// of any specific project's code.

/**
 * @returns {import("../harness.mjs").Adapter}
 */
export function createAdapter() {
  /** @type {{ status: string | null } | null} */
  let row = null;
  /** @type {Set<string>} */
  let processed;

  return {
    reset() {
      row = { status: "active" };
      processed = new Set();
    },
    apply(ev) {
      if (processed.has(ev.id)) return; // dedupe by event id only
      processed.add(ev.id);
      const obj = ev.data.object;
      if (ev.type === "customer.subscription.updated") {
        row.status = obj.status;
      } else if (ev.type === "customer.subscription.deleted") {
        row.status = "canceled";
      }
    },
    read() {
      return row ? { ...row } : null;
    },
  };
}

/** @param {any} state */
export const isActive = (state) => state != null && state.status === "active";
