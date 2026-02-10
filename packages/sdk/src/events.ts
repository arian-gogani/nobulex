/**
 * Typed event emitter for the Stele SDK lifecycle.
 *
 * Provides a fully typed, zero-dependency event emitter that tracks
 * covenant creation, verification, signing, action evaluation, and errors.
 * All event payloads are strictly typed via {@link SteleEventMap}.
 *
 * @packageDocumentation
 */

// ─── Event map ──────────────────────────────────────────────────────────────────

/**
 * Map of event names to their typed payloads.
 *
 * Each key is a lifecycle event emitted by the SDK; the corresponding
 * value type describes the data delivered to listeners.
 */
export type SteleLifecycleEventMap = {
  /** Emitted when a new covenant document is created. */
  'covenant:created': { documentId: string; issuerId: string };
  /** Emitted when a covenant document has been verified. */
  'covenant:verified': {
    documentId: string;
    valid: boolean;
    checksPassed: number;
    checksFailed: number;
  };
  /** Emitted when a covenant document is signed or countersigned. */
  'covenant:signed': { documentId: string };
  /** Emitted when an action is evaluated against CCL constraints. */
  'action:evaluated': {
    action: string;
    resource: string;
    permitted: boolean;
  };
  /** Emitted when an error occurs within the SDK. */
  'error': { code: string; message: string };
};

// ─── Listener type ──────────────────────────────────────────────────────────────

/** A listener callback for a specific event type. */
type Listener<T> = (data: T) => void;

/** Internal entry that wraps a listener and tracks whether it is a `once` listener. */
interface ListenerEntry<T> {
  fn: Listener<T>;
  once: boolean;
}

// ─── SteleEventEmitter ──────────────────────────────────────────────────────────

/**
 * A strongly-typed event emitter for Stele SDK lifecycle events.
 *
 * This implementation has **no dependency on Node's `events` module** and
 * can run in any JavaScript environment (Node, Deno, browser, edge workers).
 *
 * @example
 * ```typescript
 * const emitter = new SteleEventEmitter();
 *
 * emitter.on('covenant:created', (data) => {
 *   console.log(`Created: ${data.documentId} by ${data.issuerId}`);
 * });
 *
 * emitter.emit('covenant:created', {
 *   documentId: 'cov-123',
 *   issuerId: 'alice',
 * });
 * ```
 */
export class SteleEventEmitter {
  /**
   * Internal map of event names to their ordered listener entries.
   * Uses an array (rather than a Set) to preserve insertion order and
   * to allow the same function reference to be registered more than once.
   */
  private readonly _listeners = new Map<
    keyof SteleLifecycleEventMap,
    ListenerEntry<any>[]
  >();

  // ── on ──────────────────────────────────────────────────────────────────

  /**
   * Register a listener for the given event. The listener will be called
   * every time the event is emitted until it is removed.
   *
   * @param event - The event name to listen for.
   * @param listener - Callback invoked with the event payload.
   * @returns `this` for chaining.
   *
   * @example
   * ```typescript
   * emitter.on('error', (data) => {
   *   console.error(`[${data.code}] ${data.message}`);
   * });
   * ```
   */
  on<K extends keyof SteleLifecycleEventMap>(
    event: K,
    listener: Listener<SteleLifecycleEventMap[K]>,
  ): this {
    let entries = this._listeners.get(event);
    if (!entries) {
      entries = [];
      this._listeners.set(event, entries);
    }
    entries.push({ fn: listener, once: false });
    return this;
  }

  // ── off ─────────────────────────────────────────────────────────────────

  /**
   * Remove a previously registered listener for the given event.
   *
   * Only the **first** matching reference is removed, so if the same
   * function was registered multiple times, the remaining registrations
   * stay active.
   *
   * @param event - The event name.
   * @param listener - The exact function reference to remove.
   * @returns `this` for chaining.
   *
   * @example
   * ```typescript
   * const handler = (data) => console.log(data);
   * emitter.on('covenant:signed', handler);
   * emitter.off('covenant:signed', handler);
   * ```
   */
  off<K extends keyof SteleLifecycleEventMap>(
    event: K,
    listener: Listener<SteleLifecycleEventMap[K]>,
  ): this {
    const entries = this._listeners.get(event);
    if (!entries) return this;

    const idx = entries.findIndex((e) => e.fn === listener);
    if (idx !== -1) {
      entries.splice(idx, 1);
    }
    // Clean up empty arrays to avoid memory leaks
    if (entries.length === 0) {
      this._listeners.delete(event);
    }
    return this;
  }

  // ── once ────────────────────────────────────────────────────────────────

  /**
   * Register a listener that will be invoked **at most once**. After the
   * first emission of the event the listener is automatically removed.
   *
   * @param event - The event name to listen for.
   * @param listener - Callback invoked with the event payload (once).
   * @returns `this` for chaining.
   *
   * @example
   * ```typescript
   * emitter.once('covenant:verified', (data) => {
   *   console.log(`First verification: valid=${data.valid}`);
   * });
   * ```
   */
  once<K extends keyof SteleLifecycleEventMap>(
    event: K,
    listener: Listener<SteleLifecycleEventMap[K]>,
  ): this {
    let entries = this._listeners.get(event);
    if (!entries) {
      entries = [];
      this._listeners.set(event, entries);
    }
    entries.push({ fn: listener, once: true });
    return this;
  }

  // ── emit ────────────────────────────────────────────────────────────────

  /**
   * Emit an event, synchronously invoking all registered listeners in
   * registration order.
   *
   * Listeners registered via {@link once} are removed after being called.
   *
   * @param event - The event name to emit.
   * @param data - The payload to deliver to each listener.
   * @returns `true` if at least one listener was invoked, `false` otherwise.
   *
   * @example
   * ```typescript
   * const hadListeners = emitter.emit('action:evaluated', {
   *   action: 'read',
   *   resource: '/data/users',
   *   permitted: true,
   * });
   * ```
   */
  emit<K extends keyof SteleLifecycleEventMap>(
    event: K,
    data: SteleLifecycleEventMap[K],
  ): boolean {
    const entries = this._listeners.get(event);
    if (!entries || entries.length === 0) return false;

    // Snapshot the array so that listener mutations during iteration
    // (e.g. a `once` handler removing itself) do not skip entries.
    const snapshot = [...entries];

    for (const entry of snapshot) {
      if (entry.once) {
        // Remove the once-listener before invoking (prevents double-fire
        // if the listener itself triggers another emit of the same event).
        const idx = entries.indexOf(entry);
        if (idx !== -1) {
          entries.splice(idx, 1);
        }
      }
      entry.fn(data);
    }

    // Clean up empty arrays
    if (entries.length === 0) {
      this._listeners.delete(event);
    }

    return true;
  }

  // ── listenerCount ───────────────────────────────────────────────────────

  /**
   * Return the number of listeners currently registered for the given event.
   *
   * @param event - The event name to query.
   * @returns The number of registered listeners (0 if none).
   *
   * @example
   * ```typescript
   * console.log(emitter.listenerCount('error')); // 0
   * emitter.on('error', () => {});
   * console.log(emitter.listenerCount('error')); // 1
   * ```
   */
  listenerCount(event: keyof SteleLifecycleEventMap): number {
    const entries = this._listeners.get(event);
    return entries ? entries.length : 0;
  }

  // ── removeAllListeners ──────────────────────────────────────────────────

  /**
   * Remove all listeners for a specific event, or **all** listeners for
   * **every** event if no event name is provided.
   *
   * @param event - Optional event name. When omitted, all listeners on
   *   all events are removed.
   * @returns `this` for chaining.
   *
   * @example
   * ```typescript
   * emitter.removeAllListeners('error');       // clear error listeners
   * emitter.removeAllListeners();              // clear everything
   * ```
   */
  removeAllListeners(event?: keyof SteleLifecycleEventMap): this {
    if (event !== undefined) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }
}
