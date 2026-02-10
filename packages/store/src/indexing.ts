/**
 * In-memory indexing system for fast filtered queries on CovenantDocuments.
 *
 * Uses inverted index maps for exact-match fields (issuerId, beneficiaryId, tags)
 * and a sorted array for range queries on createdAt.
 *
 * @packageDocumentation
 */

import type { CovenantDocument } from '@stele/core';

import type { StoreFilter } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Fields that can be indexed for fast lookup. */
export type IndexField = 'issuerId' | 'beneficiaryId' | 'createdAt' | 'tags';

/** Entry in the sorted createdAt index. */
interface TimeEntry {
  time: number;
  id: string;
}

// ─── StoreIndex ─────────────────────────────────────────────────────────────────

/**
 * In-memory index that accelerates filtered queries over covenant documents.
 *
 * Maintains inverted index maps for exact-match fields and a sorted array
 * for range queries on `createdAt`. When a filter references indexed fields,
 * candidate document IDs are returned via set intersection; when no index
 * covers the filter, `null` is returned to signal that a full scan is needed.
 */
export class StoreIndex {
  private readonly fields: Set<IndexField>;

  /** issuerId -> Set<docId> */
  private readonly issuerIndex = new Map<string, Set<string>>();

  /** beneficiaryId -> Set<docId> */
  private readonly beneficiaryIndex = new Map<string, Set<string>>();

  /** tag -> Set<docId> */
  private readonly tagIndex = new Map<string, Set<string>>();

  /** Sorted by time ascending. */
  private timeIndex: TimeEntry[] = [];

  /** All document IDs known to the index (for tracking count). */
  private readonly allIds = new Set<string>();

  /** Map from docId to its cached metadata for removal. */
  private readonly docMeta = new Map<
    string,
    { issuerId: string; beneficiaryId: string; tags: string[]; time: number }
  >();

  /**
   * Build indexes for the given fields.
   * @param fields - The fields to index.
   */
  constructor(fields: IndexField[]) {
    this.fields = new Set(fields);
  }

  // ── Mutation ──────────────────────────────────────────────────────────────

  /** Add a document to all indexes. */
  add(doc: CovenantDocument): void {
    // If the document already exists, remove it first to avoid stale entries.
    if (this.allIds.has(doc.id)) {
      this.remove(doc.id);
    }

    this.allIds.add(doc.id);

    const issuerId = doc.issuer.id;
    const beneficiaryId = doc.beneficiary.id;
    const tags = doc.metadata?.tags ?? [];
    const time = new Date(doc.createdAt).getTime();

    // Cache metadata for removal.
    this.docMeta.set(doc.id, { issuerId, beneficiaryId, tags, time });

    if (this.fields.has('issuerId')) {
      let set = this.issuerIndex.get(issuerId);
      if (!set) {
        set = new Set();
        this.issuerIndex.set(issuerId, set);
      }
      set.add(doc.id);
    }

    if (this.fields.has('beneficiaryId')) {
      let set = this.beneficiaryIndex.get(beneficiaryId);
      if (!set) {
        set = new Set();
        this.beneficiaryIndex.set(beneficiaryId, set);
      }
      set.add(doc.id);
    }

    if (this.fields.has('tags')) {
      for (const tag of tags) {
        let set = this.tagIndex.get(tag);
        if (!set) {
          set = new Set();
          this.tagIndex.set(tag, set);
        }
        set.add(doc.id);
      }
    }

    if (this.fields.has('createdAt')) {
      // Insert into the sorted array maintaining order.
      const entry: TimeEntry = { time, id: doc.id };
      const insertPos = this.binarySearchInsertPos(time);
      this.timeIndex.splice(insertPos, 0, entry);
    }
  }

  /** Remove a document from all indexes. */
  remove(id: string): void {
    if (!this.allIds.has(id)) {
      return;
    }

    const meta = this.docMeta.get(id);
    if (!meta) {
      this.allIds.delete(id);
      return;
    }

    this.allIds.delete(id);
    this.docMeta.delete(id);

    if (this.fields.has('issuerId')) {
      const set = this.issuerIndex.get(meta.issuerId);
      if (set) {
        set.delete(id);
        if (set.size === 0) {
          this.issuerIndex.delete(meta.issuerId);
        }
      }
    }

    if (this.fields.has('beneficiaryId')) {
      const set = this.beneficiaryIndex.get(meta.beneficiaryId);
      if (set) {
        set.delete(id);
        if (set.size === 0) {
          this.beneficiaryIndex.delete(meta.beneficiaryId);
        }
      }
    }

    if (this.fields.has('tags')) {
      for (const tag of meta.tags) {
        const set = this.tagIndex.get(tag);
        if (set) {
          set.delete(id);
          if (set.size === 0) {
            this.tagIndex.delete(tag);
          }
        }
      }
    }

    if (this.fields.has('createdAt')) {
      this.timeIndex = this.timeIndex.filter((e) => e.id !== id);
    }
  }

  /**
   * Query using indexes. Returns candidate document IDs, or `null` if no
   * index covers any field in the filter (meaning a full scan is needed).
   */
  query(filter: StoreFilter): Set<string> | null {
    const candidateSets: Set<string>[] = [];

    // issuerId filter
    if (filter.issuerId !== undefined) {
      if (this.fields.has('issuerId')) {
        const set = this.issuerIndex.get(filter.issuerId);
        candidateSets.push(set ? new Set(set) : new Set());
      }
    }

    // beneficiaryId filter
    if (filter.beneficiaryId !== undefined) {
      if (this.fields.has('beneficiaryId')) {
        const set = this.beneficiaryIndex.get(filter.beneficiaryId);
        candidateSets.push(set ? new Set(set) : new Set());
      }
    }

    // tags filter (AND semantics: document must have ALL tags)
    if (filter.tags !== undefined && filter.tags.length > 0) {
      if (this.fields.has('tags')) {
        // For each tag, get the set of doc IDs, then intersect them all.
        let tagCandidates: Set<string> | null = null;
        for (const tag of filter.tags) {
          const set = this.tagIndex.get(tag);
          if (!set || set.size === 0) {
            // If any required tag has no documents, result is empty.
            tagCandidates = new Set();
            break;
          }
          if (tagCandidates === null) {
            tagCandidates = new Set(set);
          } else {
            tagCandidates = intersect(tagCandidates, set);
          }
        }
        candidateSets.push(tagCandidates ?? new Set());
      }
    }

    // createdAfter / createdBefore range filter
    if (filter.createdAfter !== undefined || filter.createdBefore !== undefined) {
      if (this.fields.has('createdAt')) {
        const after = filter.createdAfter
          ? new Date(filter.createdAfter).getTime()
          : -Infinity;
        const before = filter.createdBefore
          ? new Date(filter.createdBefore).getTime()
          : Infinity;

        const rangeIds = new Set<string>();
        // Binary search for the start position.
        const startIdx = this.binarySearchFirstGte(after);
        for (let i = startIdx; i < this.timeIndex.length; i++) {
          const entry = this.timeIndex[i]!;
          if (entry.time > before) {
            break;
          }
          rangeIds.add(entry.id);
        }
        candidateSets.push(rangeIds);
      }
    }

    // If no indexed field was used, return null to signal a full scan.
    if (candidateSets.length === 0) {
      return null;
    }

    // Intersect all candidate sets.
    let result = candidateSets[0]!;
    for (let i = 1; i < candidateSets.length; i++) {
      result = intersect(result, candidateSets[i]!);
    }

    return result;
  }

  /** Rebuild all indexes from a document array. */
  rebuild(docs: CovenantDocument[]): void {
    // Clear everything.
    this.issuerIndex.clear();
    this.beneficiaryIndex.clear();
    this.tagIndex.clear();
    this.timeIndex = [];
    this.allIds.clear();
    this.docMeta.clear();

    // Re-add all documents.
    for (const doc of docs) {
      this.add(doc);
    }
  }

  /** Return index statistics. */
  stats(): {
    fields: IndexField[];
    documentCount: number;
    indexSizes: Record<string, number>;
  } {
    const indexSizes: Record<string, number> = {};

    if (this.fields.has('issuerId')) {
      indexSizes['issuerId'] = this.issuerIndex.size;
    }
    if (this.fields.has('beneficiaryId')) {
      indexSizes['beneficiaryId'] = this.beneficiaryIndex.size;
    }
    if (this.fields.has('tags')) {
      indexSizes['tags'] = this.tagIndex.size;
    }
    if (this.fields.has('createdAt')) {
      indexSizes['createdAt'] = this.timeIndex.length;
    }

    return {
      fields: Array.from(this.fields),
      documentCount: this.allIds.size,
      indexSizes,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Binary search for the insertion position to maintain sorted order.
   * Returns the index at which `time` should be inserted.
   */
  private binarySearchInsertPos(time: number): number {
    let lo = 0;
    let hi = this.timeIndex.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timeIndex[mid]!.time <= time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Binary search for the first entry with time >= target.
   */
  private binarySearchFirstGte(target: number): number {
    let lo = 0;
    let hi = this.timeIndex.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timeIndex[mid]!.time < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────────

/** Intersect two sets, returning a new set. */
function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  // Iterate over the smaller set for efficiency.
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) {
      result.add(item);
    }
  }
  return result;
}
