/**
 * src/notebook/notebookStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Notebook model. A notebook is a curated set of sources with optional scoped
 * subsets (user toggled include/exclude per source) and pinned notes.
 *
 * Sources come from the existing data stores (researchPapers, coas, reports,
 * local-research docs). The notebook aggregates them into one workspace and
 * exposes deterministic synthesis jobs that operate only on the scoped set.
 */

import { TenantRepository } from "../lib/firebaseRepo";
import { extractSpans, type SourceSpan } from "./sourceSpans";

export type SourceKind = "researchPaper" | "coa" | "report" | "auditLog" | "localDoc";

export interface NotebookSource {
  id: string;
  kind: SourceKind;
  title: string;
  authors?: string[];
  abstract?: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  url?: string;
  rawText: string;
  addedAt: string;
  tags: {
    compounds: string[];
    methods: string[];
    regulatory: string[];
  };
}

export interface PinnedNote {
  id: string;
  text: string;
  sourceId?: string;
  spanId?: string;
  pinnedAt: string;
}

export interface Notebook {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  scope: { included: Set<string>; excluded: Set<string> };
  sources: Map<string, NotebookSource>;
  spans: Map<string, SourceSpan[]>;
  pinnedNotes: PinnedNote[];
  createdAt: string;
  updatedAt: string;
}

export interface NotebookSummary {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  sourceCount: number;
  scopedCount: number;
  pinnedCount: number;
  createdAt: string;
  updatedAt: string;
}

const NOTEBOOK_COLLECTION = "notebooks";

const PREFIX = "notebook:";

function makeNotebookId(tenantId: string, slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
  return `${tenantId}--${safe || "default"}`;
}

export async function createNotebook(
  tenantId: string,
  title: string,
  description?: string
): Promise<Notebook> {
  const id = makeNotebookId(tenantId, title);
  const notebook: Notebook = {
    id,
    tenantId,
    title,
    description,
    scope: { included: new Set(), excluded: new Set() },
    sources: new Map(),
    spans: new Map(),
    pinnedNotes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const repo = new TenantRepository<any>(NOTEBOOK_COLLECTION, tenantId);
  await repo.save({ id, notebookMeta: serialize(notebook) });
  return notebook;
}

export async function loadNotebook(tenantId: string, id: string): Promise<Notebook | null> {
  const repo = new TenantRepository<any>(NOTEBOOK_COLLECTION, tenantId);
  const doc = await repo.get(id);
  if (!doc) return null;
  const meta = (doc as any).notebookMeta;
  if (!meta) return null;
  return hydrate(meta);
}

export async function saveNotebook(notebook: Notebook): Promise<void> {
  const repo = new TenantRepository<any>(NOTEBOOK_COLLECTION, notebook.tenantId);
  notebook.updatedAt = new Date().toISOString();
  await repo.save({ id: notebook.id, notebookMeta: serialize(notebook) });
}

export async function listNotebooks(tenantId: string): Promise<NotebookSummary[]> {
  const repo = new TenantRepository<any>(NOTEBOOK_COLLECTION, tenantId);
  const all = await repo.list();
  return all
    .map((d: any) => d.notebookMeta)
    .filter(Boolean)
    .map((m: any) => ({
      id: m.id,
      tenantId: m.tenantId,
      title: m.title,
      description: m.description,
      sourceCount: (m.sources ?? []).length,
      scopedCount: ((m.sources ?? []).filter((s: any) => !m.scope?.excluded?.includes(s.id))).length,
      pinnedCount: (m.pinnedNotes ?? []).length,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }))
    .sort((a: any, b: any) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

// ---------------------------------------------------------------------------
// Source ingestion
// ---------------------------------------------------------------------------

function extractText(source: { kind: SourceKind; raw: any }): { rawText: string; title: string; abstract?: string; authors?: string[]; year?: number; journal?: string; doi?: string; pmid?: string; url?: string } {
  if (source.kind === "researchPaper") {
    const p = source.raw;
    return {
      rawText: `${p.title || ""}\n\n${p.abstract || ""}\n\n${(p.fullText || "").slice(0, 8000)}`,
      title: p.title || "(untitled paper)",
      abstract: p.abstract,
      authors: p.authors,
      year: p.publishedDate ? new Date(p.publishedDate).getFullYear() : undefined,
      journal: p.journal,
      doi: p.doi,
      pmid: p.pmid,
      url: p.url,
    };
  }
  if (source.kind === "coa") {
    const c = source.raw;
    return {
      rawText: c.rawText || `${c.strain || ""}\nTHCa ${c.thca}%\nΔ9-THC ${c.d9thc}%\nTotal THC ${c.totalThc}%`,
      title: `COA ${c.batchId || c.id || ""}`,
      year: c.uploadDate ? new Date(c.uploadDate).getFullYear() : undefined,
    };
  }
  if (source.kind === "report") {
    const r = source.raw;
    return {
      rawText: `${r.title || ""}\n\n${(r.sections || []).map((s: any) => `${s.heading}\n${s.body}`).join("\n\n")}`,
      title: r.title || "(report)",
    };
  }
  if (source.kind === "auditLog") {
    const a = source.raw;
    return {
      rawText: `${a.action}\n${a.details || ""}\n${a.userRole || ""}`,
      title: `Audit ${a.id} — ${a.action}`,
    };
  }
  return { rawText: JSON.stringify(source.raw, null, 2).slice(0, 8000), title: source.raw.title || "(local doc)" };
}

export async function addSourceToNotebook(
  notebook: Notebook,
  kind: SourceKind,
  raw: any
): Promise<NotebookSource> {
  const meta = extractText({ kind, raw });
  const id = `${kind}:${raw.id || raw.canonicalId || raw.batchId || raw.pmid || raw.doi || `${PREFIX}${notebook.sources.size + 1}`}`;
  const spans = extractSpans(id, meta.rawText);

  const compoundSet = new Set<string>();
  const methodSet = new Set<string>();
  const regSet = new Set<string>();
  for (const s of spans) {
    for (const c of s.tags.compounds) compoundSet.add(c);
    for (const m of s.tags.methods) methodSet.add(m);
    for (const r of s.tags.regulatory) regSet.add(r);
  }

  const source: NotebookSource = {
    id,
    kind,
    title: meta.title,
    authors: meta.authors,
    abstract: meta.abstract,
    year: meta.year,
    journal: meta.journal,
    doi: meta.doi,
    pmid: meta.pmid,
    url: meta.url,
    rawText: meta.rawText,
    addedAt: new Date().toISOString(),
    tags: {
      compounds: [...compoundSet],
      methods: [...methodSet],
      regulatory: [...regSet],
    },
  };

  notebook.sources.set(id, source);
  notebook.spans.set(id, spans);
  notebook.scope.included.add(id);
  await saveNotebook(notebook);
  return source;
}

// ---------------------------------------------------------------------------
// Scoping helpers
// ---------------------------------------------------------------------------

export function getScopedSources(notebook: Notebook): NotebookSource[] {
  const result: NotebookSource[] = [];
  for (const [id, src] of notebook.sources) {
    if (notebook.scope.excluded.has(id)) continue;
    result.push(src);
  }
  return result;
}

export function getScopedSpans(notebook: Notebook): SourceSpan[] {
  const out: SourceSpan[] = [];
  for (const src of getScopedSources(notebook)) {
    out.push(...(notebook.spans.get(src.id) ?? []));
  }
  return out;
}

export async function toggleSourceScope(notebook: Notebook, sourceId: string, included: boolean): Promise<void> {
  if (included) {
    notebook.scope.excluded.delete(sourceId);
    notebook.scope.included.add(sourceId);
  } else {
    notebook.scope.included.delete(sourceId);
    notebook.scope.excluded.add(sourceId);
  }
  await saveNotebook(notebook);
}

// ---------------------------------------------------------------------------
// Pinned notes
// ---------------------------------------------------------------------------

export async function pinNote(
  notebook: Notebook,
  text: string,
  sourceId?: string,
  spanId?: string
): Promise<PinnedNote> {
  const note: PinnedNote = {
    id: `${PREFIX}note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    sourceId,
    spanId,
    pinnedAt: new Date().toISOString(),
  };
  notebook.pinnedNotes.unshift(note);
  await saveNotebook(notebook);
  return note;
}

export async function removeNote(notebook: Notebook, noteId: string): Promise<void> {
  notebook.pinnedNotes = notebook.pinnedNotes.filter((n) => n.id !== noteId);
  await saveNotebook(notebook);
}

// ---------------------------------------------------------------------------
// (De)serialization — Maps don't survive JSON natively
// ---------------------------------------------------------------------------

function serialize(notebook: Notebook): any {
  return {
    id: notebook.id,
    tenantId: notebook.tenantId,
    title: notebook.title,
    description: notebook.description,
    scope: {
      included: [...notebook.scope.included],
      excluded: [...notebook.scope.excluded],
    },
    sources: [...notebook.sources.values()],
    spans: [...notebook.spans.entries()].map(([k, v]) => [k, v]),
    pinnedNotes: notebook.pinnedNotes,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
  };
}

function hydrate(meta: any): Notebook {
  return {
    id: meta.id,
    tenantId: meta.tenantId,
    title: meta.title,
    description: meta.description,
    scope: {
      included: new Set(meta.scope?.included ?? []),
      excluded: new Set(meta.scope?.excluded ?? []),
    },
    sources: new Map((meta.sources ?? []).map((s: any) => [s.id, s])),
    spans: new Map((meta.spans ?? []).map(([k, v]: [string, any]) => [k, v])),
    pinnedNotes: meta.pinnedNotes ?? [],
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}