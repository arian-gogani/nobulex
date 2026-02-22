/**
 * Example 05: Store and Query
 *
 * Demonstrates the @nobulex/store package for persisting and querying
 * covenant documents:
 * - Creating a MemoryStore
 * - Storing 5 covenants from different issuers
 * - Querying by issuerId, by date range, by tags
 * - Batch get/put/delete operations
 * - Event handling (listen for put/delete events)
 *
 * Run: npx tsx examples/05-store-and-query.ts
 */

import { MemoryStore, type StoreEvent } from '@nobulex/store';
import {
  buildCovenant,
  type CovenantDocument,
  type Issuer,
  type Beneficiary,
} from '@nobulex/core';
import { generateKeyPair, type KeyPair } from '@nobulex/crypto';

async function createTestCovenant(
  issuerName: string,
  issuerKeys: KeyPair,
  beneficiaryName: string,
  beneficiaryKeys: KeyPair,
  constraints: string,
  tags: string[],
): Promise<CovenantDocument> {
  const issuer: Issuer = {
    id: `org:${issuerName.toLowerCase().replace(/\s+/g, '-')}`,
    publicKey: issuerKeys.publicKeyHex,
    role: 'issuer',
    name: issuerName,
  };

  const beneficiary: Beneficiary = {
    id: `agent:${beneficiaryName.toLowerCase().replace(/\s+/g, '-')}`,
    publicKey: beneficiaryKeys.publicKeyHex,
    role: 'beneficiary',
    name: beneficiaryName,
  };

  return buildCovenant({
    issuer,
    beneficiary,
    constraints,
    privateKey: issuerKeys.privateKey,
    metadata: {
      name: `${issuerName} Policy`,
      tags,
    },
  });
}

async function main() {
  console.log('========================================');
  console.log('  Example 05: Store and Query');
  console.log('========================================\n');

  // ── Step 1: Create a MemoryStore ────────────────────────────────────────

  console.log('--- Step 1: Create MemoryStore ---\n');

  const store = new MemoryStore();
  console.log('MemoryStore created. Size:', store.size);

  // ── Step 2: Set up event listeners ──────────────────────────────────────
  // Listen for put and delete events to track store activity.

  console.log('\n--- Step 2: Set Up Event Listeners ---\n');

  const events: StoreEvent[] = [];

  const eventHandler = (event: StoreEvent) => {
    events.push(event);
    const docId = event.documentId.slice(0, 16) + '...';
    console.log(`  [EVENT] ${event.type}: ${docId}`);
  };

  store.onEvent(eventHandler);
  console.log('Event listener registered.');

  // ── Step 3: Store 5 covenants from different issuers ────────────────────

  console.log('\n--- Step 3: Store 5 Covenants ---\n');

  // Generate keys for 3 issuers and 3 beneficiaries
  const acmeKeys = await generateKeyPair();
  const globexKeys = await generateKeyPair();
  const initechKeys = await generateKeyPair();
  const agent1Keys = await generateKeyPair();
  const agent2Keys = await generateKeyPair();
  const agent3Keys = await generateKeyPair();

  const covenant1 = await createTestCovenant(
    'Acme Corp', acmeKeys,
    'Data Analyst', agent1Keys,
    "permit read on '/data/**'\ndeny write on '**'",
    ['data-access', 'read-only', 'production'],
  );

  const covenant2 = await createTestCovenant(
    'Acme Corp', acmeKeys,
    'Code Reviewer', agent2Keys,
    "permit read on '/code/**'\npermit write on '/reviews/**'",
    ['code-review', 'development'],
  );

  const covenant3 = await createTestCovenant(
    'Globex Inc', globexKeys,
    'ETL Processor', agent1Keys,
    "permit read on '**'\npermit write on '/data/staging/**'\nlimit api.call 5000 per 1 hours",
    ['etl', 'data-pipeline', 'production'],
  );

  const covenant4 = await createTestCovenant(
    'Globex Inc', globexKeys,
    'Report Generator', agent3Keys,
    "permit read on '/data/**'\npermit write on '/reports/**'",
    ['reporting', 'production'],
  );

  const covenant5 = await createTestCovenant(
    'Initech', initechKeys,
    'Security Scanner', agent2Keys,
    "permit read on '**'\ndeny write on '**'\ndeny delete on '**'",
    ['security', 'audit', 'read-only'],
  );

  // Store all covenants
  console.log('Storing covenants:');
  await store.put(covenant1);
  await store.put(covenant2);
  await store.put(covenant3);
  await store.put(covenant4);
  await store.put(covenant5);

  console.log('\nStore size:', store.size);

  // ── Step 4: Query by issuerId ───────────────────────────────────────────

  console.log('\n--- Step 4: Query by Issuer ---\n');

  const acmeCovenants = await store.list({ issuerId: 'org:acme-corp' });
  console.log(`Acme Corp covenants: ${acmeCovenants.length}`);
  for (const doc of acmeCovenants) {
    console.log(`  - ${doc.metadata?.name} (beneficiary: ${doc.beneficiary.name})`);
  }

  const globexCovenants = await store.list({ issuerId: 'org:globex-inc' });
  console.log(`\nGlobex Inc covenants: ${globexCovenants.length}`);
  for (const doc of globexCovenants) {
    console.log(`  - ${doc.metadata?.name} (beneficiary: ${doc.beneficiary.name})`);
  }

  const initechCovenants = await store.list({ issuerId: 'org:initech' });
  console.log(`\nInitech covenants: ${initechCovenants.length}`);
  for (const doc of initechCovenants) {
    console.log(`  - ${doc.metadata?.name} (beneficiary: ${doc.beneficiary.name})`);
  }

  // ── Step 5: Query by date range ─────────────────────────────────────────

  console.log('\n--- Step 5: Query by Date Range ---\n');

  // All documents were created "now", so query for documents created
  // after 1 hour ago and before 1 hour from now
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const oneHourFromNow = new Date(Date.now() + 3600 * 1000).toISOString();

  const recentCovenants = await store.list({
    createdAfter: oneHourAgo,
    createdBefore: oneHourFromNow,
  });
  console.log(`Covenants created in the last hour: ${recentCovenants.length}`);

  // Query for documents that can't exist (created before epoch)
  const oldCovenants = await store.list({
    createdBefore: '2000-01-01T00:00:00.000Z',
  });
  console.log(`Covenants before year 2000: ${oldCovenants.length}`);

  // ── Step 6: Query by tags ───────────────────────────────────────────────

  console.log('\n--- Step 6: Query by Tags ---\n');

  const productionCovenants = await store.list({ tags: ['production'] });
  console.log(`Production covenants: ${productionCovenants.length}`);
  for (const doc of productionCovenants) {
    console.log(`  - ${doc.metadata?.name} [${doc.metadata?.tags?.join(', ')}]`);
  }

  const readOnlyCovenants = await store.list({ tags: ['read-only'] });
  console.log(`\nRead-only covenants: ${readOnlyCovenants.length}`);
  for (const doc of readOnlyCovenants) {
    console.log(`  - ${doc.metadata?.name} [${doc.metadata?.tags?.join(', ')}]`);
  }

  // Count with filter
  const securityCount = await store.count({ tags: ['security'] });
  console.log(`\nSecurity-tagged covenants: ${securityCount}`);

  // ── Step 7: Batch operations ────────────────────────────────────────────

  console.log('\n--- Step 7: Batch Operations ---\n');

  // Batch get
  const ids = [covenant1.id, covenant3.id, covenant5.id];
  const batchResults = await store.getBatch(ids);
  console.log(`Batch get (3 IDs): ${batchResults.filter(Boolean).length} found`);
  for (const doc of batchResults) {
    if (doc) {
      console.log(`  - ${doc.metadata?.name} (${doc.id.slice(0, 16)}...)`);
    }
  }

  // Batch delete
  console.log(`\nStore size before delete: ${store.size}`);
  const deleteIds = [covenant2.id, covenant4.id];
  const deletedCount = await store.deleteBatch(deleteIds);
  console.log(`Batch deleted: ${deletedCount} documents`);
  console.log(`Store size after delete: ${store.size}`);

  // Verify deleted documents are gone
  const stillExists = await store.has(covenant2.id);
  console.log(`Covenant 2 still exists: ${stillExists}`);

  // Batch put (re-add the deleted ones)
  await store.putBatch([covenant2, covenant4]);
  console.log(`\nBatch put: re-added 2 documents`);
  console.log(`Store size after re-add: ${store.size}`);

  // ── Step 8: Review events ───────────────────────────────────────────────

  console.log('\n--- Step 8: Event Summary ---\n');

  const putEvents = events.filter((e) => e.type === 'put');
  const deleteEvents = events.filter((e) => e.type === 'delete');

  console.log(`Total events captured: ${events.length}`);
  console.log(`  Put events:    ${putEvents.length}`);
  console.log(`  Delete events: ${deleteEvents.length}`);

  // Clean up: remove event listener
  store.offEvent(eventHandler);
  console.log('\nEvent listener removed.');

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n--- Summary ---\n');
  console.log('Covenants stored:  5');
  console.log('Issuers:           3 (Acme Corp, Globex Inc, Initech)');
  console.log('Queries run:       issuer, date range, tags');
  console.log('Batch ops:         get, delete, put');
  console.log('Events tracked:   ', events.length);
  console.log('Final store size: ', store.size);

  console.log('\n========================================');
  console.log('  Example complete!');
  console.log('========================================');
}

main().catch(console.error);
