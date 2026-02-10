/**
 * @stele/react -- Reactive primitives for building Stele-powered UIs.
 *
 * Provides framework-agnostic reactive state management that can be
 * adapted to React, Vue, Svelte, or vanilla JS. No external dependencies.
 *
 * @packageDocumentation
 */

import type { CovenantDocument, VerificationResult } from '@stele/core';
import type { AgentIdentity } from '@stele/identity';
import type { CovenantStore, StoreFilter, StoreEvent } from '@stele/store';
import type {
  CreateCovenantOptions,
  EvaluationResult,
  CreateIdentityOptions,
  EvolveOptions,
} from '@stele/sdk';
import { SteleClient } from '@stele/sdk';
import type { EvaluationContext } from '@stele/ccl';

// ---------------------------------------------------------------------------
// Observable<T>
// ---------------------------------------------------------------------------

/** Callback type for Observable subscribers. */
export type Subscriber<T> = (value: T) => void;

/**
 * A simple reactive value container with synchronous get/set and
 * subscribe/unsubscribe semantics.
 *
 * Serves as the foundational primitive for all reactive state in this
 * package. Can be composed via {@link Observable.map} to derive new
 * observables that update automatically when the source changes.
 */
export class Observable<T> {
  private _value: T;
  private readonly _subscribers: Set<Subscriber<T>> = new Set();

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  /** Return the current value. */
  get(): T {
    return this._value;
  }

  /**
   * Update the value and notify all subscribers.
   *
   * Subscribers are called synchronously in registration order.
   * If the new value is reference-equal to the old value the
   * notification is still fired (callers may rely on this for
   * forcing a re-render even when the reference is the same).
   */
  set(value: T): void {
    this._value = value;
    for (const subscriber of this._subscribers) {
      subscriber(value);
    }
  }

  /**
   * Register a callback that will be invoked whenever the value
   * changes. Returns a cleanup function that removes the subscription.
   */
  subscribe(callback: Subscriber<T>): () => void {
    this._subscribers.add(callback);
    return () => {
      this._subscribers.delete(callback);
    };
  }

  /**
   * Remove a previously registered callback.
   * No-op if the callback is not currently subscribed.
   */
  unsubscribe(callback: Subscriber<T>): void {
    this._subscribers.delete(callback);
  }

  /**
   * Create a derived Observable whose value is the result of applying
   * `fn` to every value emitted by this Observable.
   *
   * The derived observable is "live" -- it stays in sync with the
   * source automatically as long as the returned observable is not
   * garbage-collected.
   */
  map<U>(fn: (value: T) => U): Observable<U> {
    const derived = new Observable<U>(fn(this._value));
    this.subscribe((value) => {
      derived.set(fn(value));
    });
    return derived;
  }

  /** The number of currently active subscribers. */
  get subscriberCount(): number {
    return this._subscribers.size;
  }
}

// ---------------------------------------------------------------------------
// CovenantState
// ---------------------------------------------------------------------------

/** Status of the covenant lifecycle within {@link CovenantState}. */
export type CovenantStatus =
  | 'idle'
  | 'creating'
  | 'created'
  | 'verifying'
  | 'verified'
  | 'error';

/**
 * Observable state container for the full covenant lifecycle:
 * creation, verification, and action evaluation.
 *
 * Internally delegates to a {@link SteleClient} for all operations.
 */
export class CovenantState {
  readonly status: Observable<CovenantStatus>;
  readonly document: Observable<CovenantDocument | null>;
  readonly error: Observable<Error | null>;
  readonly verificationResult: Observable<VerificationResult | null>;

  private readonly _client: SteleClient;

  constructor(client: SteleClient) {
    this._client = client;
    this.status = new Observable<CovenantStatus>('idle');
    this.document = new Observable<CovenantDocument | null>(null);
    this.error = new Observable<Error | null>(null);
    this.verificationResult = new Observable<VerificationResult | null>(null);
  }

  /**
   * Create a new covenant document.
   *
   * Transitions: idle/error -> creating -> created (or error).
   */
  async create(options: CreateCovenantOptions): Promise<CovenantDocument> {
    this.status.set('creating');
    this.error.set(null);

    try {
      const doc = await this._client.createCovenant(options);
      this.document.set(doc);
      this.status.set('created');
      return doc;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error.set(error);
      this.status.set('error');
      throw error;
    }
  }

  /**
   * Verify the currently held covenant document.
   *
   * Transitions: created -> verifying -> verified (or error).
   *
   * @throws Error if no document has been created yet.
   */
  async verify(): Promise<VerificationResult> {
    const doc = this.document.get();
    if (!doc) {
      const error = new Error('No document to verify. Call create() first.');
      this.error.set(error);
      this.status.set('error');
      throw error;
    }

    this.status.set('verifying');
    this.error.set(null);

    try {
      const result = await this._client.verifyCovenant(doc);
      this.verificationResult.set(result);
      this.status.set('verified');
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error.set(error);
      this.status.set('error');
      throw error;
    }
  }

  /**
   * Evaluate an action/resource pair against the current covenant's
   * CCL constraints.
   *
   * Does not change the lifecycle status -- this is a query operation.
   *
   * @throws Error if no document has been created yet.
   */
  async evaluateAction(
    action: string,
    resource: string,
    context?: EvaluationContext,
  ): Promise<EvaluationResult> {
    const doc = this.document.get();
    if (!doc) {
      throw new Error('No document to evaluate. Call create() first.');
    }

    return this._client.evaluateAction(doc, action, resource, context);
  }
}

// ---------------------------------------------------------------------------
// IdentityState
// ---------------------------------------------------------------------------

/** Status of the identity lifecycle within {@link IdentityState}. */
export type IdentityStatus =
  | 'idle'
  | 'creating'
  | 'created'
  | 'evolving'
  | 'error';

/**
 * Observable state container for the agent identity lifecycle:
 * creation and evolution.
 *
 * Internally delegates to a {@link SteleClient} for all operations.
 */
export class IdentityState {
  readonly identity: Observable<AgentIdentity | null>;
  readonly status: Observable<IdentityStatus>;
  readonly error: Observable<Error | null>;

  private readonly _client: SteleClient;

  constructor(client: SteleClient) {
    this._client = client;
    this.identity = new Observable<AgentIdentity | null>(null);
    this.status = new Observable<IdentityStatus>('idle');
    this.error = new Observable<Error | null>(null);
  }

  /**
   * Create a new agent identity.
   *
   * Transitions: idle/error -> creating -> created (or error).
   */
  async create(options: CreateIdentityOptions): Promise<AgentIdentity> {
    this.status.set('creating');
    this.error.set(null);

    try {
      const identity = await this._client.createIdentity(options);
      this.identity.set(identity);
      this.status.set('created');
      return identity;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error.set(error);
      this.status.set('error');
      throw error;
    }
  }

  /**
   * Evolve the current identity with the given options.
   *
   * Transitions: created -> evolving -> created (or error).
   *
   * @throws Error if no identity has been created yet.
   */
  async evolve(options: EvolveOptions): Promise<AgentIdentity> {
    const current = this.identity.get();
    if (!current) {
      const error = new Error('No identity to evolve. Call create() first.');
      this.error.set(error);
      this.status.set('error');
      throw error;
    }

    this.status.set('evolving');
    this.error.set(null);

    try {
      const evolved = await this._client.evolveIdentity(current, options);
      this.identity.set(evolved);
      this.status.set('created');
      return evolved;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error.set(error);
      this.status.set('error');
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// StoreState
// ---------------------------------------------------------------------------

/**
 * Observable state container for querying a {@link CovenantStore}.
 *
 * Subscribes to the store's event system for automatic refresh when
 * documents are added or removed. Provides filtering capabilities.
 */
export class StoreState {
  readonly documents: Observable<CovenantDocument[]>;
  readonly loading: Observable<boolean>;
  readonly error: Observable<Error | null>;

  private readonly _store: CovenantStore;
  private _filter: StoreFilter | undefined;
  private readonly _storeEventHandler: (event: StoreEvent) => void;

  constructor(store: CovenantStore) {
    this._store = store;
    this.documents = new Observable<CovenantDocument[]>([]);
    this.loading = new Observable<boolean>(false);
    this.error = new Observable<Error | null>(null);

    // Auto-refresh when the store contents change.
    this._storeEventHandler = (_event: StoreEvent) => {
      void this.refresh();
    };
    this._store.onEvent(this._storeEventHandler);
  }

  /**
   * Load (or reload) documents from the store, applying the current
   * filter if one has been set.
   */
  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const docs = await this._store.list(this._filter);
      this.documents.set(docs);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.error.set(error);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Set a filter and immediately refresh the document list.
   */
  async filter(filter: StoreFilter): Promise<void> {
    this._filter = filter;
    await this.refresh();
  }

  /**
   * Remove the store event subscription. Call this when the
   * StoreState is no longer needed to avoid memory leaks.
   */
  destroy(): void {
    this._store.offEvent(this._storeEventHandler);
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Create a new {@link CovenantState} bound to the given client.
 */
export function createCovenantState(client: SteleClient): CovenantState {
  return new CovenantState(client);
}

/**
 * Create a new {@link IdentityState} bound to the given client.
 */
export function createIdentityState(client: SteleClient): IdentityState {
  return new IdentityState(client);
}

/**
 * Create a new {@link StoreState} bound to the given store.
 */
export function createStoreState(store: CovenantStore): StoreState {
  return new StoreState(store);
}

// ---------------------------------------------------------------------------
// React hooks (require React >= 18 as peer dependency)
// ---------------------------------------------------------------------------

export {
  useObservable,
  useCovenant,
  useIdentity,
  useCovenantStore,
  _injectReact,
  _resetReact,
} from './hooks';

export type {
  UseCovenantReturn,
  UseIdentityReturn,
  UseCovenantStoreReturn,
} from './hooks';
