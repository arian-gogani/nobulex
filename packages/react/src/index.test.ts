import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPair } from '@stele/crypto';
import type { KeyPair } from '@stele/crypto';
import type { CovenantDocument, Issuer, Beneficiary } from '@stele/core';
import { MemoryStore } from '@stele/store';
import { SteleClient } from '@stele/sdk';
import type { CreateCovenantOptions, CreateIdentityOptions } from '@stele/sdk';

import {
  Observable,
  CovenantState,
  IdentityState,
  StoreState,
  createCovenantState,
  createIdentityState,
  createStoreState,
} from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeParties(): Promise<{
  issuerKeyPair: KeyPair;
  beneficiaryKeyPair: KeyPair;
  issuer: Issuer;
  beneficiary: Beneficiary;
}> {
  const issuerKeyPair = await generateKeyPair();
  const beneficiaryKeyPair = await generateKeyPair();

  const issuer: Issuer = {
    id: 'issuer-1',
    publicKey: issuerKeyPair.publicKeyHex,
    role: 'issuer',
  };

  const beneficiary: Beneficiary = {
    id: 'beneficiary-1',
    publicKey: beneficiaryKeyPair.publicKeyHex,
    role: 'beneficiary',
  };

  return { issuerKeyPair, beneficiaryKeyPair, issuer, beneficiary };
}

function makeCovenantOptions(
  issuer: Issuer,
  beneficiary: Beneficiary,
  privateKey: Uint8Array,
): CreateCovenantOptions {
  return {
    issuer,
    beneficiary,
    constraints: "permit read on '**'",
    privateKey,
  };
}

function makeIdentityOptions(kp: KeyPair): CreateIdentityOptions {
  return {
    operatorKeyPair: kp,
    model: {
      provider: 'test-provider',
      modelId: 'test-model',
      modelVersion: '1.0',
    },
    capabilities: ['read', 'write', 'execute'],
    deployment: {
      runtime: 'process',
      region: 'us-east-1',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@stele/react', () => {
  // ========================================================================
  // Observable
  // ========================================================================

  describe('Observable', () => {
    it('initialises with the provided value', () => {
      const obs = new Observable(42);
      expect(obs.get()).toBe(42);
    });

    it('updates value with set()', () => {
      const obs = new Observable('hello');
      obs.set('world');
      expect(obs.get()).toBe('world');
    });

    it('notifies subscribers on set()', () => {
      const obs = new Observable(0);
      const values: number[] = [];
      obs.subscribe((v) => values.push(v));
      obs.set(1);
      obs.set(2);
      obs.set(3);
      expect(values).toEqual([1, 2, 3]);
    });

    it('supports multiple subscribers', () => {
      const obs = new Observable('a');
      const log1: string[] = [];
      const log2: string[] = [];
      obs.subscribe((v) => log1.push(v));
      obs.subscribe((v) => log2.push(v));
      obs.set('b');
      expect(log1).toEqual(['b']);
      expect(log2).toEqual(['b']);
    });

    it('unsubscribe stops notifications', () => {
      const obs = new Observable(0);
      const values: number[] = [];
      const cb = (v: number) => values.push(v);
      obs.subscribe(cb);
      obs.set(1);
      obs.unsubscribe(cb);
      obs.set(2);
      expect(values).toEqual([1]);
    });

    it('subscribe returns a cleanup function', () => {
      const obs = new Observable(0);
      const values: number[] = [];
      const cleanup = obs.subscribe((v) => values.push(v));
      obs.set(1);
      cleanup();
      obs.set(2);
      expect(values).toEqual([1]);
    });

    it('unsubscribe is a no-op for unknown callback', () => {
      const obs = new Observable(0);
      const unknownCb = (_v: number) => {};
      // Should not throw
      obs.unsubscribe(unknownCb);
      expect(obs.subscriberCount).toBe(0);
    });

    it('map creates a derived observable with the initial value', () => {
      const obs = new Observable(5);
      const doubled = obs.map((v) => v * 2);
      expect(doubled.get()).toBe(10);
    });

    it('map derived observable updates when source changes', () => {
      const obs = new Observable(3);
      const squared = obs.map((v) => v * v);
      obs.set(4);
      expect(squared.get()).toBe(16);
      obs.set(5);
      expect(squared.get()).toBe(25);
    });

    it('map can chain multiple transforms', () => {
      const obs = new Observable(2);
      const result = obs.map((v) => v + 1).map((v) => v * 10);
      expect(result.get()).toBe(30); // (2+1)*10
      obs.set(5);
      expect(result.get()).toBe(60); // (5+1)*10
    });

    it('map derived observable notifies its own subscribers', () => {
      const obs = new Observable(1);
      const mapped = obs.map((v) => v.toString());
      const values: string[] = [];
      mapped.subscribe((v) => values.push(v));
      obs.set(2);
      obs.set(3);
      expect(values).toEqual(['2', '3']);
    });

    it('subscriberCount tracks active subscriptions', () => {
      const obs = new Observable(0);
      expect(obs.subscriberCount).toBe(0);
      const cb1 = () => {};
      const cb2 = () => {};
      obs.subscribe(cb1);
      expect(obs.subscriberCount).toBe(1);
      obs.subscribe(cb2);
      expect(obs.subscriberCount).toBe(2);
      obs.unsubscribe(cb1);
      expect(obs.subscriberCount).toBe(1);
    });

    it('notifies even when setting the same reference', () => {
      const obs = new Observable('same');
      const calls: string[] = [];
      obs.subscribe((v) => calls.push(v));
      obs.set('same');
      expect(calls).toEqual(['same']);
    });

    it('handles null and undefined values', () => {
      const obs = new Observable<string | null>('initial');
      obs.set(null);
      expect(obs.get()).toBeNull();
      const obs2 = new Observable<number | undefined>(1);
      obs2.set(undefined);
      expect(obs2.get()).toBeUndefined();
    });

    it('works with complex object values', () => {
      const obs = new Observable<{ name: string; count: number }>({
        name: 'test',
        count: 0,
      });
      const snapshots: Array<{ name: string; count: number }> = [];
      obs.subscribe((v) => snapshots.push({ ...v }));
      obs.set({ name: 'test', count: 1 });
      obs.set({ name: 'changed', count: 2 });
      expect(snapshots).toEqual([
        { name: 'test', count: 1 },
        { name: 'changed', count: 2 },
      ]);
    });
  });

  // ========================================================================
  // CovenantState
  // ========================================================================

  describe('CovenantState', () => {
    let client: SteleClient;
    let issuerKeyPair: KeyPair;
    let beneficiaryKeyPair: KeyPair;
    let issuer: Issuer;
    let beneficiary: Beneficiary;

    beforeEach(async () => {
      const parties = await makeParties();
      issuerKeyPair = parties.issuerKeyPair;
      beneficiaryKeyPair = parties.beneficiaryKeyPair;
      issuer = parties.issuer;
      beneficiary = parties.beneficiary;
      client = new SteleClient({ keyPair: issuerKeyPair });
    });

    it('starts in idle state with null values', () => {
      const state = new CovenantState(client);
      expect(state.status.get()).toBe('idle');
      expect(state.document.get()).toBeNull();
      expect(state.error.get()).toBeNull();
      expect(state.verificationResult.get()).toBeNull();
    });

    it('create() transitions through creating -> created', async () => {
      const state = new CovenantState(client);
      const statuses: string[] = [];
      state.status.subscribe((s) => statuses.push(s));

      const options = makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey);
      const doc = await state.create(options);

      expect(doc).toBeDefined();
      expect(doc.id).toBeTruthy();
      expect(state.status.get()).toBe('created');
      expect(state.document.get()).toBe(doc);
      expect(state.error.get()).toBeNull();
      expect(statuses).toContain('creating');
      expect(statuses).toContain('created');
    });

    it('create() sets error state on failure', async () => {
      const state = new CovenantState(client);
      const badOptions: CreateCovenantOptions = {
        issuer,
        beneficiary,
        constraints: '',
        privateKey: issuerKeyPair.privateKey,
      };

      await expect(state.create(badOptions)).rejects.toThrow();
      expect(state.status.get()).toBe('error');
      expect(state.error.get()).toBeInstanceOf(Error);
      expect(state.document.get()).toBeNull();
    });

    it('verify() transitions through verifying -> verified', async () => {
      const state = new CovenantState(client);
      const options = makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey);
      await state.create(options);

      const statuses: string[] = [];
      state.status.subscribe((s) => statuses.push(s));

      const result = await state.verify();
      expect(result.valid).toBe(true);
      expect(state.status.get()).toBe('verified');
      expect(state.verificationResult.get()).toBe(result);
      expect(statuses).toContain('verifying');
      expect(statuses).toContain('verified');
    });

    it('verify() throws if no document exists', async () => {
      const state = new CovenantState(client);
      await expect(state.verify()).rejects.toThrow('No document to verify');
      expect(state.status.get()).toBe('error');
      expect(state.error.get()).toBeTruthy();
    });

    it('evaluateAction() delegates to client', async () => {
      const state = new CovenantState(client);
      const options = makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey);
      await state.create(options);

      const result = await state.evaluateAction('read', '/data');
      expect(result.permitted).toBe(true);
    });

    it('evaluateAction() throws if no document exists', async () => {
      const state = new CovenantState(client);
      await expect(state.evaluateAction('read', '/data')).rejects.toThrow(
        'No document to evaluate',
      );
    });

    it('evaluateAction() does not change status', async () => {
      const state = new CovenantState(client);
      const options = makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey);
      await state.create(options);
      expect(state.status.get()).toBe('created');

      await state.evaluateAction('read', '/data');
      expect(state.status.get()).toBe('created');
    });

    it('create() clears previous error', async () => {
      const state = new CovenantState(client);

      // Force an error
      await expect(
        state.create({
          issuer,
          beneficiary,
          constraints: '',
          privateKey: issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow();
      expect(state.error.get()).not.toBeNull();

      // Successful create should clear the error
      const options = makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey);
      await state.create(options);
      expect(state.error.get()).toBeNull();
      expect(state.status.get()).toBe('created');
    });

    it('subscribers are notified of document changes', async () => {
      const state = new CovenantState(client);
      const docs: Array<CovenantDocument | null> = [];
      state.document.subscribe((d) => docs.push(d));

      const options = makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey);
      await state.create(options);
      expect(docs.length).toBe(1);
      expect(docs[0]).toBeTruthy();
    });

    it('evaluateAction() with deny constraint returns not permitted', async () => {
      const state = new CovenantState(client);
      const options: CreateCovenantOptions = {
        issuer,
        beneficiary,
        constraints: "deny write on '/secrets'",
        privateKey: issuerKeyPair.privateKey,
      };
      await state.create(options);

      const result = await state.evaluateAction('write', '/secrets');
      expect(result.permitted).toBe(false);
    });
  });

  // ========================================================================
  // IdentityState
  // ========================================================================

  describe('IdentityState', () => {
    let client: SteleClient;
    let keyPair: KeyPair;

    beforeEach(async () => {
      keyPair = await generateKeyPair();
      client = new SteleClient({ keyPair });
    });

    it('starts in idle state with null identity', () => {
      const state = new IdentityState(client);
      expect(state.status.get()).toBe('idle');
      expect(state.identity.get()).toBeNull();
      expect(state.error.get()).toBeNull();
    });

    it('create() transitions through creating -> created', async () => {
      const state = new IdentityState(client);
      const statuses: string[] = [];
      state.status.subscribe((s) => statuses.push(s));

      const options = makeIdentityOptions(keyPair);
      const identity = await state.create(options);

      expect(identity).toBeDefined();
      expect(identity.id).toBeTruthy();
      expect(state.status.get()).toBe('created');
      expect(state.identity.get()).toBe(identity);
      expect(state.error.get()).toBeNull();
      expect(statuses).toContain('creating');
      expect(statuses).toContain('created');
    });

    it('create() stores the identity in the observable', async () => {
      const state = new IdentityState(client);
      const options = makeIdentityOptions(keyPair);
      const identity = await state.create(options);

      expect(state.identity.get()).toBe(identity);
      expect(state.identity.get()!.operatorPublicKey).toBe(keyPair.publicKeyHex);
    });

    it('evolve() transitions through evolving -> created', async () => {
      const state = new IdentityState(client);
      await state.create(makeIdentityOptions(keyPair));

      const statuses: string[] = [];
      state.status.subscribe((s) => statuses.push(s));

      const evolved = await state.evolve({
        operatorKeyPair: keyPair,
        changeType: 'capability_change',
        description: 'Adding analyze capability',
        updates: {
          capabilities: ['read', 'write', 'execute', 'analyze'],
        },
      });

      expect(evolved).toBeDefined();
      expect(evolved.version).toBe(2);
      expect(state.status.get()).toBe('created');
      expect(state.identity.get()).toBe(evolved);
      expect(statuses).toContain('evolving');
      expect(statuses).toContain('created');
    });

    it('evolve() throws if no identity exists', async () => {
      const state = new IdentityState(client);
      await expect(
        state.evolve({
          operatorKeyPair: keyPair,
          changeType: 'capability_change',
          description: 'test',
          updates: { capabilities: ['a'] },
        }),
      ).rejects.toThrow('No identity to evolve');
      expect(state.status.get()).toBe('error');
      expect(state.error.get()).toBeTruthy();
    });

    it('evolve() updates identity observable', async () => {
      const state = new IdentityState(client);
      await state.create(makeIdentityOptions(keyPair));
      const firstIdentity = state.identity.get();

      await state.evolve({
        operatorKeyPair: keyPair,
        changeType: 'model_update',
        description: 'Version bump',
        updates: {
          model: {
            provider: 'test-provider',
            modelId: 'test-model',
            modelVersion: '2.0',
          },
        },
      });

      const secondIdentity = state.identity.get();
      expect(secondIdentity).not.toBe(firstIdentity);
      expect(secondIdentity!.version).toBe(2);
    });

    it('subscribers are notified of identity changes', async () => {
      const state = new IdentityState(client);
      const snapshots: Array<unknown> = [];
      state.identity.subscribe((id) => snapshots.push(id));

      await state.create(makeIdentityOptions(keyPair));
      expect(snapshots.length).toBe(1);
      expect(snapshots[0]).toBeTruthy();

      await state.evolve({
        operatorKeyPair: keyPair,
        changeType: 'capability_change',
        description: 'test',
        updates: { capabilities: ['read'] },
      });
      expect(snapshots.length).toBe(2);
    });

    it('create() clears previous error state', async () => {
      const state = new IdentityState(client);
      // Force error
      await expect(
        state.evolve({
          operatorKeyPair: keyPair,
          changeType: 'capability_change',
          description: 'test',
          updates: { capabilities: ['a'] },
        }),
      ).rejects.toThrow();
      expect(state.error.get()).not.toBeNull();

      // Successful create should clear
      await state.create(makeIdentityOptions(keyPair));
      expect(state.error.get()).toBeNull();
      expect(state.status.get()).toBe('created');
    });
  });

  // ========================================================================
  // StoreState
  // ========================================================================

  describe('StoreState', () => {
    let store: MemoryStore;
    let client: SteleClient;
    let issuerKeyPair: KeyPair;
    let issuer: Issuer;
    let beneficiary: Beneficiary;

    beforeEach(async () => {
      store = new MemoryStore();
      const parties = await makeParties();
      issuerKeyPair = parties.issuerKeyPair;
      issuer = parties.issuer;
      beneficiary = parties.beneficiary;
      client = new SteleClient({ keyPair: issuerKeyPair });
    });

    it('starts with empty documents and loading=false', () => {
      const state = new StoreState(store);
      expect(state.documents.get()).toEqual([]);
      expect(state.loading.get()).toBe(false);
      expect(state.error.get()).toBeNull();
      state.destroy();
    });

    it('refresh() loads documents from store', async () => {
      const doc = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );
      await store.put(doc);

      const state = new StoreState(store);
      await state.refresh();
      expect(state.documents.get().length).toBe(1);
      expect(state.documents.get()[0]!.id).toBe(doc.id);
      state.destroy();
    });

    it('refresh() sets loading=true then loading=false', async () => {
      const state = new StoreState(store);
      const loadingStates: boolean[] = [];
      state.loading.subscribe((l) => loadingStates.push(l));

      await state.refresh();

      // Should have gone true -> false
      expect(loadingStates).toContain(true);
      expect(loadingStates[loadingStates.length - 1]).toBe(false);
      state.destroy();
    });

    it('filter() sets filter and refreshes', async () => {
      const doc1 = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "permit read on '**'",
        privateKey: issuerKeyPair.privateKey,
      });
      const otherKeyPair = await generateKeyPair();
      const otherIssuer: Issuer = {
        id: 'issuer-2',
        publicKey: otherKeyPair.publicKeyHex,
        role: 'issuer',
      };
      const doc2 = await client.createCovenant({
        issuer: otherIssuer,
        beneficiary,
        constraints: "permit write on '**'",
        privateKey: otherKeyPair.privateKey,
      });

      await store.put(doc1);
      await store.put(doc2);

      const state = new StoreState(store);
      await state.filter({ issuerId: 'issuer-1' });
      expect(state.documents.get().length).toBe(1);
      expect(state.documents.get()[0]!.issuer.id).toBe('issuer-1');
      state.destroy();
    });

    it('auto-refreshes when a document is put into the store', async () => {
      const state = new StoreState(store);
      await state.refresh();
      expect(state.documents.get().length).toBe(0);

      const doc = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );

      // The put triggers an auto-refresh via the store event
      await store.put(doc);

      // Wait for the async refresh to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(state.documents.get().length).toBe(1);
      state.destroy();
    });

    it('auto-refreshes when a document is deleted from the store', async () => {
      const doc = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );
      await store.put(doc);

      const state = new StoreState(store);
      await state.refresh();
      expect(state.documents.get().length).toBe(1);

      await store.delete(doc.id);
      // Wait for the async refresh to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(state.documents.get().length).toBe(0);
      state.destroy();
    });

    it('destroy() stops auto-refresh', async () => {
      const state = new StoreState(store);
      await state.refresh();
      state.destroy();

      const doc = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );
      await store.put(doc);
      // Wait a bit -- should NOT have refreshed
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(state.documents.get().length).toBe(0);
    });

    it('documents observable notifies subscribers', async () => {
      const state = new StoreState(store);
      const counts: number[] = [];
      state.documents.subscribe((docs) => counts.push(docs.length));

      const doc = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );
      await store.put(doc);
      await state.refresh();

      expect(counts.length).toBeGreaterThanOrEqual(1);
      expect(counts[counts.length - 1]).toBe(1);
      state.destroy();
    });

    it('refresh() with multiple documents returns all', async () => {
      const doc1 = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );
      const doc2 = await client.createCovenant({
        issuer,
        beneficiary,
        constraints: "deny write on '/system/**'",
        privateKey: issuerKeyPair.privateKey,
      });
      await store.put(doc1);
      await store.put(doc2);

      const state = new StoreState(store);
      await state.refresh();
      expect(state.documents.get().length).toBe(2);
      state.destroy();
    });

    it('filter() with beneficiaryId works', async () => {
      const otherBenKeyPair = await generateKeyPair();
      const otherBeneficiary: Beneficiary = {
        id: 'beneficiary-other',
        publicKey: otherBenKeyPair.publicKeyHex,
        role: 'beneficiary',
      };

      const doc1 = await client.createCovenant(
        makeCovenantOptions(issuer, beneficiary, issuerKeyPair.privateKey),
      );
      const doc2 = await client.createCovenant({
        issuer,
        beneficiary: otherBeneficiary,
        constraints: "permit read on '**'",
        privateKey: issuerKeyPair.privateKey,
      });

      await store.put(doc1);
      await store.put(doc2);

      const state = new StoreState(store);
      await state.filter({ beneficiaryId: 'beneficiary-other' });
      expect(state.documents.get().length).toBe(1);
      expect(state.documents.get()[0]!.beneficiary.id).toBe('beneficiary-other');
      state.destroy();
    });
  });

  // ========================================================================
  // Factory functions
  // ========================================================================

  describe('factory functions', () => {
    let client: SteleClient;
    let store: MemoryStore;

    beforeEach(async () => {
      const kp = await generateKeyPair();
      client = new SteleClient({ keyPair: kp });
      store = new MemoryStore();
    });

    it('createCovenantState returns a CovenantState', () => {
      const state = createCovenantState(client);
      expect(state).toBeInstanceOf(CovenantState);
      expect(state.status.get()).toBe('idle');
    });

    it('createIdentityState returns an IdentityState', () => {
      const state = createIdentityState(client);
      expect(state).toBeInstanceOf(IdentityState);
      expect(state.status.get()).toBe('idle');
    });

    it('createStoreState returns a StoreState', () => {
      const state = createStoreState(store);
      expect(state).toBeInstanceOf(StoreState);
      expect(state.documents.get()).toEqual([]);
      state.destroy();
    });

    it('createCovenantState is usable for full lifecycle', async () => {
      const parties = await makeParties();
      const covenantClient = new SteleClient({
        keyPair: parties.issuerKeyPair,
      });
      const state = createCovenantState(covenantClient);

      const doc = await state.create(
        makeCovenantOptions(
          parties.issuer,
          parties.beneficiary,
          parties.issuerKeyPair.privateKey,
        ),
      );
      expect(state.status.get()).toBe('created');

      const result = await state.verify();
      expect(result.valid).toBe(true);
      expect(state.status.get()).toBe('verified');
    });

    it('createIdentityState is usable for full lifecycle', async () => {
      const kp = await generateKeyPair();
      const identityClient = new SteleClient({ keyPair: kp });
      const state = createIdentityState(identityClient);

      const identity = await state.create(makeIdentityOptions(kp));
      expect(state.status.get()).toBe('created');
      expect(identity.version).toBe(1);

      const evolved = await state.evolve({
        operatorKeyPair: kp,
        changeType: 'capability_change',
        description: 'test evolve',
        updates: { capabilities: ['a', 'b'] },
      });
      expect(evolved.version).toBe(2);
      expect(state.status.get()).toBe('created');
    });

    it('createStoreState is usable for refresh and filter', async () => {
      const parties = await makeParties();
      const storeClient = new SteleClient({
        keyPair: parties.issuerKeyPair,
      });
      const doc = await storeClient.createCovenant(
        makeCovenantOptions(
          parties.issuer,
          parties.beneficiary,
          parties.issuerKeyPair.privateKey,
        ),
      );
      await store.put(doc);

      const state = createStoreState(store);
      await state.refresh();
      expect(state.documents.get().length).toBe(1);
      state.destroy();
    });
  });

  // ========================================================================
  // Integration / composition tests
  // ========================================================================

  describe('integration', () => {
    it('Observable.map with CovenantState status', async () => {
      const parties = await makeParties();
      const client = new SteleClient({ keyPair: parties.issuerKeyPair });
      const state = new CovenantState(client);

      const isReady = state.status.map(
        (s) => s === 'created' || s === 'verified',
      );
      expect(isReady.get()).toBe(false);

      await state.create(
        makeCovenantOptions(
          parties.issuer,
          parties.beneficiary,
          parties.issuerKeyPair.privateKey,
        ),
      );
      expect(isReady.get()).toBe(true);
    });

    it('Observable.map with IdentityState', async () => {
      const kp = await generateKeyPair();
      const client = new SteleClient({ keyPair: kp });
      const state = new IdentityState(client);

      const hasIdentity = state.identity.map((id) => id !== null);
      expect(hasIdentity.get()).toBe(false);

      await state.create(makeIdentityOptions(kp));
      expect(hasIdentity.get()).toBe(true);
    });

    it('Observable.map with StoreState document count', async () => {
      const store = new MemoryStore();
      const state = new StoreState(store);
      const count = state.documents.map((docs) => docs.length);
      expect(count.get()).toBe(0);

      const parties = await makeParties();
      const client = new SteleClient({ keyPair: parties.issuerKeyPair });
      const doc = await client.createCovenant(
        makeCovenantOptions(
          parties.issuer,
          parties.beneficiary,
          parties.issuerKeyPair.privateKey,
        ),
      );
      await store.put(doc);
      await state.refresh();
      expect(count.get()).toBe(1);
      state.destroy();
    });

    it('error observable works with map', async () => {
      const parties = await makeParties();
      const client = new SteleClient({ keyPair: parties.issuerKeyPair });
      const state = new CovenantState(client);

      const errorMessage = state.error.map((e) => e?.message ?? '');
      expect(errorMessage.get()).toBe('');

      await expect(
        state.create({
          issuer: parties.issuer,
          beneficiary: parties.beneficiary,
          constraints: '',
          privateKey: parties.issuerKeyPair.privateKey,
        }),
      ).rejects.toThrow();

      expect(errorMessage.get()).toBeTruthy();
      expect(errorMessage.get().length).toBeGreaterThan(0);
    });
  });
});
