/**
 * React hooks for Stele.
 *
 * Provides idiomatic React hooks for subscribing to Stele observables,
 * managing covenant state, identity state, and store queries.
 *
 * Requires React >= 18 as a peer dependency.
 *
 * @packageDocumentation
 */

import type { CovenantDocument, VerificationResult } from '@stele/core';
import type { AgentIdentity } from '@stele/identity';
import type { CovenantStore, StoreFilter } from '@stele/store';
import type { SteleClient, CreateCovenantOptions, EvaluationResult, CreateIdentityOptions, EvolveOptions } from '@stele/sdk';
import type { EvaluationContext } from '@stele/ccl';
import { Observable, CovenantState, IdentityState, StoreState } from './index';

// ─── Minimal React type interface ──────────────────────────────────────────────
// Defined here so the package compiles without @types/react installed.
// At runtime, the actual React module provides these functions.

interface ReactModule {
  useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  useRef<T>(initial: T): { current: T };
  useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
  useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T): T;
}

// Lazily resolved React module. Throws a clear error at hook call time
// if React is not installed.
let _react: ReactModule | undefined;

function getReact(): ReactModule {
  if (!_react) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _react = require('react') as ReactModule;
    } catch {
      throw new Error(
        '@stele/react hooks require React >= 18 as a peer dependency. ' +
        'Install it with: npm install react',
      );
    }
  }
  return _react;
}

/**
 * Inject a React module for testing or SSR environments.
 * @internal
 */
export function _injectReact(mod: ReactModule): void {
  _react = mod;
}

/**
 * Reset the injected React module.
 * @internal
 */
export function _resetReact(): void {
  _react = undefined;
}

// ─── useObservable ─────────────────────────────────────────────────────────────

/**
 * Subscribe to a Stele {@link Observable} and re-render when it changes.
 *
 * Uses `useSyncExternalStore` for tear-free reads that are compatible
 * with React concurrent features.
 *
 * @param observable - The observable to subscribe to.
 * @returns The current value of the observable.
 *
 * @example
 * ```tsx
 * function StatusBadge({ status }: { status: Observable<string> }) {
 *   const value = useObservable(status);
 *   return <span>{value}</span>;
 * }
 * ```
 */
export function useObservable<T>(observable: Observable<T>): T {
  const { useSyncExternalStore } = getReact();
  return useSyncExternalStore(
    (callback: () => void) => observable.subscribe(callback),
    () => observable.get(),
  );
}

// ─── useCovenant ────────────────────────────────────────────────────────────────

/** Return type for the {@link useCovenant} hook. */
export interface UseCovenantReturn {
  /** Current lifecycle status. */
  status: string;
  /** The covenant document, or null if not yet created. */
  document: CovenantDocument | null;
  /** The most recent error, or null. */
  error: Error | null;
  /** Verification result, or null if not yet verified. */
  verificationResult: VerificationResult | null;
  /** Create a new covenant. */
  create: (options: CreateCovenantOptions) => Promise<CovenantDocument>;
  /** Verify the current covenant. */
  verify: () => Promise<VerificationResult>;
  /** Evaluate an action against the covenant. */
  evaluateAction: (action: string, resource: string, context?: EvaluationContext) => Promise<EvaluationResult>;
}

/**
 * Manage the full covenant lifecycle (create, verify, evaluate) with
 * reactive state updates.
 *
 * @param client - A configured {@link SteleClient} instance.
 * @returns Reactive covenant state and action methods.
 *
 * @example
 * ```tsx
 * function CovenantPanel({ client }: { client: SteleClient }) {
 *   const { status, document, create, verify } = useCovenant(client);
 *   // ...
 * }
 * ```
 */
export function useCovenant(client: SteleClient): UseCovenantReturn {
  const react = getReact();
  const stateRef = react.useRef<CovenantState | null>(null);

  if (!stateRef.current) {
    stateRef.current = new CovenantState(client);
  }

  const state = stateRef.current;

  const status = useObservable(state.status);
  const document = useObservable(state.document);
  const error = useObservable(state.error);
  const verificationResult = useObservable(state.verificationResult);

  const create = react.useCallback(
    (options: CreateCovenantOptions) => state.create(options),
    [state],
  );
  const verify = react.useCallback(() => state.verify(), [state]);
  const evaluateAction = react.useCallback(
    (action: string, resource: string, context?: EvaluationContext) =>
      state.evaluateAction(action, resource, context),
    [state],
  );

  return { status, document, error, verificationResult, create, verify, evaluateAction };
}

// ─── useIdentity ────────────────────────────────────────────────────────────────

/** Return type for the {@link useIdentity} hook. */
export interface UseIdentityReturn {
  /** Current lifecycle status. */
  status: string;
  /** The agent identity, or null if not yet created. */
  identity: AgentIdentity | null;
  /** The most recent error, or null. */
  error: Error | null;
  /** Create a new identity. */
  create: (options: CreateIdentityOptions) => Promise<AgentIdentity>;
  /** Evolve the current identity. */
  evolve: (options: EvolveOptions) => Promise<AgentIdentity>;
}

/**
 * Manage the agent identity lifecycle (create, evolve) with reactive
 * state updates.
 *
 * @param client - A configured {@link SteleClient} instance.
 * @returns Reactive identity state and action methods.
 */
export function useIdentity(client: SteleClient): UseIdentityReturn {
  const react = getReact();
  const stateRef = react.useRef<IdentityState | null>(null);

  if (!stateRef.current) {
    stateRef.current = new IdentityState(client);
  }

  const state = stateRef.current;

  const status = useObservable(state.status);
  const identity = useObservable(state.identity);
  const error = useObservable(state.error);

  const create = react.useCallback(
    (options: CreateIdentityOptions) => state.create(options),
    [state],
  );
  const evolve = react.useCallback(
    (options: EvolveOptions) => state.evolve(options),
    [state],
  );

  return { status, identity, error, create, evolve };
}

// ─── useCovenantStore ──────────────────────────────────────────────────────────

/** Return type for the {@link useCovenantStore} hook. */
export interface UseCovenantStoreReturn {
  /** List of covenant documents matching the current filter. */
  documents: CovenantDocument[];
  /** Whether a refresh is in progress. */
  loading: boolean;
  /** The most recent error, or null. */
  error: Error | null;
  /** Trigger a manual refresh. */
  refresh: () => Promise<void>;
  /** Set a filter and refresh. */
  filter: (filter: StoreFilter) => Promise<void>;
}

/**
 * Subscribe to a covenant store with automatic refresh on changes.
 *
 * @param store - The {@link CovenantStore} to subscribe to.
 * @returns Reactive store state and query methods.
 */
export function useCovenantStore(store: CovenantStore): UseCovenantStoreReturn {
  const react = getReact();
  const stateRef = react.useRef<StoreState | null>(null);

  if (!stateRef.current) {
    stateRef.current = new StoreState(store);
  }

  const state = stateRef.current;

  // Clean up on unmount
  react.useEffect(() => {
    return () => {
      state.destroy();
    };
  }, [state]);

  const documents = useObservable(state.documents);
  const loading = useObservable(state.loading);
  const error = useObservable(state.error);

  const refresh = react.useCallback(() => state.refresh(), [state]);
  const filter = react.useCallback(
    (f: StoreFilter) => state.filter(f),
    [state],
  );

  return { documents, loading, error, refresh, filter };
}
