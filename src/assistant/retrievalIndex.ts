/**
 * src/assistant/retrievalIndex.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic retrieval index. BM25-lite over local documents:
 *   - research papers (from the ingested literature corpus)
 *   - audit logs (from operational history)
 *   - compliance reports
 *
 * Same query → same ranking, every time. No embeddings. No vector DB.
 *
 * Each entry has a stable id, a source kind, and a content blob. The
 * `score(query)` function returns the top-K entries with their BM25 scores.
 */

import { TenantRepository } from "../lib/firebaseRepo";

export type DocSource = "researchPaper" | "auditLog" | "report" | "knowledgeDoc";

export interface IndexedDoc {
  id: string;
  source: DocSource;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  indexedAt: string;
}

const STOP_WORDS = new Set([
  "the","and","of","to","in","a","for","on","with","is","are","this","that","as","by","an",
  "be","from","at","or","its","we","it","has","have","was","were","been","their","our","you",
  "your","they","them","but","if","so","than","then","when","where","which","while","who",
  "what","how","can","could","should","would","will","may","might","do","does","did",
]);

const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

interface PostingEntry {
  docId: string;
  tf: number;
}

class InvertedIndex {
  private postings = new Map<string, PostingEntry[]>();
  private docLengths = new Map<string, number>();
  private avgDocLength = 0;

  add(doc: IndexedDoc): void {
    const tokens = tokenize(`${doc.title}\n${doc.content}`);
    this.docLengths.set(doc.id, tokens.length);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [term, count] of tf) {
      if (!this.postings.has(term)) this.postings.set(term, []);
      this.postings.get(term)!.push({ docId: doc.id, tf: count });
    }
    this.recomputeAvg();
  }

  private recomputeAvg(): void {
    if (this.docLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    let sum = 0;
    for (const len of this.docLengths.values()) sum += len;
    this.avgDocLength = sum / this.docLengths.size;
  }

  search(query: string, topK = 5): Array<{ docId: string; score: number }> {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const N = this.docLengths.size;
    if (N === 0) return [];
    const scores = new Map<string, number>();

    for (const term of terms) {
      const entries = this.postings.get(term);
      if (!entries || entries.length === 0) continue;
      const df = entries.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const { docId, tf } of entries) {
        const docLen = this.docLengths.get(docId) ?? 0;
        const norm = 1 - B + B * (docLen / Math.max(1, this.avgDocLength));
        const termScore = idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
        scores.set(docId, (scores.get(docId) ?? 0) + termScore);
      }
    }

    return [...scores.entries()]
      .map(([docId, score]) => ({ docId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  size(): number {
    return this.docLengths.size;
  }
}

export class TenantRetrievalIndex {
  private cache = new Map<string, { builtAt: number; index: InvertedIndex; docs: Map<string, IndexedDoc> }>();
  private readonly cacheTtlMs = 30_000;

  async search(tenantId: string, query: string, topK = 5): Promise<Array<{ doc: IndexedDoc; score: number }>> {
    const idx = await this.getOrBuild(tenantId);
    const ranked = idx.index.search(query, topK);
    return ranked
      .map(({ docId, score }) => ({ doc: idx.docs.get(docId)!, score }))
      .filter((r) => r.doc);
  }

  async stats(tenantId: string): Promise<{ documents: number; builtAt: string }> {
    const idx = await this.getOrBuild(tenantId);
    return { documents: idx.index.size(), builtAt: new Date(idx.builtAt).toISOString() };
  }

  private async getOrBuild(tenantId: string): Promise<{ builtAt: number; index: InvertedIndex; docs: Map<string, IndexedDoc> }> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.builtAt < this.cacheTtlMs) return cached;
    const built = await this.build(tenantId);
    this.cache.set(tenantId, built);
    return built;
  }

  private async build(tenantId: string): Promise<{ builtAt: number; index: InvertedIndex; docs: Map<string, IndexedDoc> }> {
    const index = new InvertedIndex();
    const docs = new Map<string, IndexedDoc>();

    const papers = await new TenantRepository<any>("researchPapers", tenantId).list();
    for (const p of papers) {
      const id = `paper:${p.canonicalId || p.id}`;
      const doc: IndexedDoc = {
        id,
        source: "researchPaper",
        title: p.title || "(untitled paper)",
        content: `${p.title}\n${p.abstract || ""}\n${(p.compoundTags || []).join(" ")}\n${(p.keywords || []).join(" ")}`,
        metadata: { pmid: p.pmid, doi: p.doi, source: p.source },
        indexedAt: p.ingestedAt || new Date().toISOString(),
      };
      docs.set(id, doc);
      index.add(doc);
    }

    const reports = await new TenantRepository<any>("reports", tenantId).list();
    for (const r of reports) {
      const id = `report:${r.id || r.cycleId}`;
      const doc: IndexedDoc = {
        id,
        source: "report",
        title: r.title || "(untitled report)",
        content: `${r.title || ""}\n${(r.sections || []).map((s: any) => `${s.heading || ""}\n${s.body || ""}`).join("\n")}`,
        metadata: { cycleId: r.cycleId },
        indexedAt: r.generatedAt || new Date().toISOString(),
      };
      docs.set(id, doc);
      index.add(doc);
    }

    const audits = await new TenantRepository<any>("auditLogs", tenantId).list();
    const recentAudits = audits.slice(-200);
    for (const a of recentAudits) {
      const id = `audit:${a.id}`;
      const doc: IndexedDoc = {
        id,
        source: "auditLog",
        title: `${a.action} — ${a.details?.slice(0, 80) ?? ""}`,
        content: `${a.action}\n${a.details || ""}\n${a.userRole || ""}`,
        metadata: { userId: a.userId, category: a.category },
        indexedAt: a.timestamp || new Date().toISOString(),
      };
      docs.set(id, doc);
      index.add(doc);
    }

    return { builtAt: Date.now(), index, docs };
  }
}

export const tenantRetrievalIndex = new TenantRetrievalIndex();