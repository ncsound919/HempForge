/**
 * routes/notebook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Notebook API. Source-grounded synthesis engine inspired by NotebookLM.
 *
 *   GET    /api/notebook                    — list notebooks
 *   POST   /api/notebook                    — create
 *   GET    /api/notebook/:id               — load
 *   POST   /api/notebook/:id/sources       — add a source (paper | coa | report | auditLog)
 *   POST   /api/notebook/:id/scope         — toggle include/exclude on a source
 *   POST   /api/notebook/:id/notes         — pin a note
 *   DELETE /api/notebook/:id/notes/:noteId — remove a note
 *   POST   /api/notebook/:id/synthesize   — run a synthesis job (returns artifact)
 *   POST   /api/notebook/:id/figure       — render SVG figure from artifact id
 *   POST   /api/notebook/:id/paper        — deterministic review-paper artifact
 */

import { Router, RequestHandler, Request, Response } from "express";
import {
  addSourceToNotebook,
  createNotebook,
  listNotebooks,
  loadNotebook,
  pinNote,
  removeNote,
  saveNotebook,
  toggleSourceScope,
} from "../notebook/notebookStore";
import { TenantRepository } from "../lib/firebaseRepo";
import { runSynthesisJob, type SynthesisArtifact, type SynthesisJobName } from "../notebook/synthesisJobs";
import {
  citationNetworkSvg,
  compositePanelSvg,
  evidenceMatrixSvg,
  timelineSvg,
  type FigureResult,
} from "../notebook/figureGenerator";

export function notebookRouter(deps: { authMiddleware: RequestHandler }): Router {
  const router = Router();

  router.get("/", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const list = await listNotebooks(tenantId);
    res.json({ notebooks: list });
  });

  router.post("/", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.userId && req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const title = (req.body?.title ?? "Untitled Notebook").toString().slice(0, 120);
    const description = req.body?.description?.toString().slice(0, 600);
    const notebook = await createNotebook(req.authContext!.tenantId!, title, description);
    res.status(201).json({ id: notebook.id, title: notebook.title });
  });

  router.get("/:id", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });
    res.json(serializableNotebook(notebook));
  });

  router.post("/:id/sources", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const { kind, refId } = req.body || {};
    if (!kind || !refId) return res.status(400).json({ error: "kind and refId are required" });

    // Resolve refId from the appropriate collection
    let raw: any = null;
    if (kind === "researchPaper") {
      const repo = new TenantRepository<any>("researchPapers", tenantId);
      raw = await repo.get(refId);
    } else if (kind === "coa") {
      const repo = new TenantRepository<any>("coas", tenantId);
      raw = await repo.get(refId);
    } else if (kind === "report") {
      const repo = new TenantRepository<any>("reports", tenantId);
      const all = await repo.list();
      raw = all.find((r: any) => r.id === refId || r.cycleId === refId);
    } else if (kind === "auditLog") {
      const repo = new TenantRepository<any>("auditLogs", tenantId);
      raw = await repo.get(refId);
    } else {
      return res.status(400).json({ error: "kind must be researchPaper | coa | report | auditLog" });
    }

    if (!raw) return res.status(404).json({ error: `${kind} not found: ${refId}` });
    const source = await addSourceToNotebook(notebook, kind, raw);
    res.status(201).json({
      id: source.id,
      kind: source.kind,
      title: source.title,
      tags: source.tags,
      spanCount: (notebook.spans.get(source.id) ?? []).length,
    });
  });

  router.post("/:id/scope", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });
    const { sourceId, included } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: "sourceId is required" });
    await toggleSourceScope(notebook, sourceId, !!included);
    res.json({ ok: true });
  });

  router.post("/:id/notes", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });
    const { text, sourceId, spanId } = req.body || {};
    if (!text) return res.status(400).json({ error: "text is required" });
    const note = await pinNote(notebook, String(text).slice(0, 2000), sourceId, spanId);
    res.status(201).json(note);
  });

  router.delete("/:id/notes/:noteId", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });
    await removeNote(notebook, req.params.noteId);
    res.json({ ok: true });
  });

  router.post("/:id/synthesize", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });
    const job = (req.body?.job ?? "compare-findings") as SynthesisJobName;
    const artifact = runSynthesisJob(notebook, job);
    // Persist artifact
    const artRepo = new TenantRepository<any>("notebookArtifacts", tenantId);
    await artRepo.save({ id: artifact.id, artifact });
    res.json(artifact);
  });

  router.post("/:id/figure", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const { artifactId, kind } = req.body || {};
    let artifact: SynthesisArtifact | null = null;
    if (artifactId) {
      const repo = new TenantRepository<any>("notebookArtifacts", tenantId);
      const doc = await repo.get(artifactId);
      artifact = doc?.artifact ?? null;
    }
    if (!artifact) {
      // Run a fresh artifact based on the requested kind
      const job: SynthesisJobName = (kind ?? "citation-graph") as SynthesisJobName;
      artifact = runSynthesisJob(notebook, job);
    }

    const figKind = (req.body?.figKind ?? kind ?? "panel") as string;
    const figure: FigureResult = renderFigure(figKind, artifact);
    res.json(figure);
  });

  router.post("/:id/paper", deps.authMiddleware, async (req: Request, res: Response) => {
    const tenantId = req.authContext?.tenantId;
    if (!tenantId) return res.status(401).json({ error: "Unauthorized" });
    const notebook = await loadNotebook(tenantId, req.params.id);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });
    const paper = runSynthesisJob(notebook, "review-paper");
    const repo = new TenantRepository<any>("notebookArtifacts", tenantId);
    await repo.save({ id: paper.id, artifact: paper });
    res.json(paper);
  });

  return router;
}

function renderFigure(kind: string, artifact: SynthesisArtifact): FigureResult {
  switch (kind) {
    case "citation-network":
      return citationNetworkSvg(artifact);
    case "evidence-matrix":
      return evidenceMatrixSvg(artifact);
    case "timeline":
      return timelineSvg(artifact);
    default:
      return compositePanelSvg(artifact);
  }
}

function serializableNotebook(notebook: any): any {
  const sources = [...notebook.sources.values()].map((s: any) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    authors: s.authors,
    abstract: s.abstract,
    year: s.year,
    journal: s.journal,
    doi: s.doi,
    pmid: s.pmid,
    url: s.url,
    tags: s.tags,
    addedAt: s.addedAt,
    rawTextLength: s.rawText?.length ?? 0,
  }));
  return {
    id: notebook.id,
    tenantId: notebook.tenantId,
    title: notebook.title,
    description: notebook.description,
    scope: {
      included: [...notebook.scope.included],
      excluded: [...notebook.scope.excluded],
    },
    sources,
    pinnedNotes: notebook.pinnedNotes,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
  };
}