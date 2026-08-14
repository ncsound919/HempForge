/**
 * src/notebook/figureGenerator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic SVG figure generator. Produces publication-ready vector
 * graphics from notebook artifacts. No external rendering library.
 *
 * Figures:
 *   - citation-network.svg  — node-link diagram of sources & their relations
 *   - evidence-matrix.svg  — heatmap of compound × method coverage
 *   - timeline.svg         — date axis with markers
 *   - panel.svg            — multi-panel figure combining the above
 */

import type { SynthesisArtifact } from "./synthesisJobs";

export interface FigureResult {
  id: string;
  kind: string;
  mimeType: "image/svg+xml";
  svg: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Citation network
// ---------------------------------------------------------------------------

export function citationNetworkSvg(artifact: SynthesisArtifact, opts?: { width?: number; height?: number }): FigureResult {
  const width = opts?.width ?? 900;
  const height = opts?.height ?? 600;
  const graph = artifact.graph;
  if (!graph) {
    return { id: `fig-net-${Date.now()}`, kind: "citation-network", mimeType: "image/svg+xml", svg: emptySvg(width, height, "No graph data"), width, height };
  }

  // simple radial layout
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 80;
  const n = graph.nodes.length;
  const nodePos = new Map<string, { x: number; y: number; w: number; h: number; weight: number }>();
  graph.nodes.forEach((node, i) => {
    const angle = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const w = Math.min(180, 60 + node.label.length * 4);
    const h = 36;
    nodePos.set(node.id, { x, y, w, h, weight: node.weight });
  });

  const edgesSvg = graph.edges.map((e) => {
    const a = nodePos.get(e.source);
    const b = nodePos.get(e.target);
    if (!a || !b) return "";
    const stroke = e.relation === "shared-compound" ? "#10b981"
      : e.relation === "shared-method" ? "#3b82f6"
      : e.relation === "same-journal" ? "#f59e0b"
      : "#6b7280";
    const sw = Math.min(3, 0.6 + e.weight * 0.5);
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${stroke}" stroke-width="${sw.toFixed(1)}" opacity="0.55" />`;
  }).join("");

  const nodesSvg = graph.nodes.map((node) => {
    const p = nodePos.get(node.id)!;
    const x = p.x - p.w / 2;
    const y = p.y - p.h / 2;
    const fill = node.kind === "researchPaper" ? "#065f46"
      : node.kind === "coa" ? "#7c2d12"
      : node.kind === "report" ? "#1e3a8a"
      : "#374151";
    return `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${p.w}" height="${p.h}" rx="6" fill="${fill}" opacity="0.85" />
      <text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" font-size="11" font-family="ui-sans-serif" fill="#fff" text-anchor="middle">${escapeXml(node.label).slice(0, 28)}</text>
      <text x="${p.x.toFixed(1)}" y="${(p.y + 28).toFixed(1)}" font-size="9" font-family="ui-sans-serif" fill="#fff" opacity="0.85" text-anchor="middle">${node.kind} · ${node.weight} spans</text></g>`;
  }).join("");

  const legend = `<g transform="translate(20 ${height - 90})">
    <rect x="0" y="0" width="220" height="80" rx="6" fill="#0f172a" opacity="0.85" />
    <text x="12" y="20" font-size="11" font-family="ui-sans-serif" fill="#fff" font-weight="bold">Citation Network</text>
    <line x1="12" y1="38" x2="32" y2="38" stroke="#10b981" stroke-width="2" />
    <text x="40" y="42" font-size="10" font-family="ui-sans-serif" fill="#fff">shared compound</text>
    <line x1="12" y1="56" x2="32" y2="56" stroke="#3b82f6" stroke-width="2" />
    <text x="40" y="60" font-size="10" font-family="ui-sans-serif" fill="#fff">shared method</text>
    <line x1="12" y1="74" x2="32" y2="74" stroke="#f59e0b" stroke-width="2" />
    <text x="40" y="78" font-size="10" font-family="ui-sans-serif" fill="#fff">same journal/year</text>
  </g>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#020617" />
  <g>${edgesSvg}</g>
  <g>${nodesSvg}</g>
  ${legend}
</svg>`;

  return { id: `fig-net-${Date.now()}`, kind: "citation-network", mimeType: "image/svg+xml", svg, width, height };
}

// ---------------------------------------------------------------------------
// Evidence matrix heatmap
// ---------------------------------------------------------------------------

export function evidenceMatrixSvg(artifact: SynthesisArtifact, opts?: { width?: number; height?: number }): FigureResult {
  const width = opts?.width ?? 800;
  const headerHeight = 100;
  const rowHeight = 24;
  const colWidth = 110;

  const table = artifact.table;
  if (!table) {
    return { id: `fig-mat-${Date.now()}`, kind: "evidence-matrix", mimeType: "image/svg+xml", svg: emptySvg(width, 320, "No matrix data"), width, height: 320 };
  }

  const rows = table.rows;
  const cols = table.headers;
  const colCount = cols.length;
  const rowCount = rows.length;

  const tableWidth = colCount * colWidth;
  const tableHeight = headerHeight + rows.length * rowHeight;
  const totalHeight = tableHeight + 60;
  const totalWidth = Math.max(width, tableWidth + 80);

  // parse counts out of cell text
  const cellCounts: number[][] = rows.map((r) =>
    r.cells.map((c) => {
      const m = c.text.match(/(\d+)\s+span/);
      return m ? parseInt(m[1], 10) : 0;
    })
  );
  const maxCount = Math.max(1, ...cellCounts.flat());

  const cellSvg = rows.map((row, r) => {
    return row.cells.map((cell, c) => {
      if (c === 0) {
        return `<text x="${40 + c * colWidth}" y="${headerHeight + r * rowHeight + 16}" font-size="11" font-family="ui-sans-serif" fill="#fff" font-weight="bold">${escapeXml(cell.text).slice(0, 18)}</text>`;
      }
      const count = cellCounts[r]?.[c] ?? 0;
      const t = count / maxCount;
      const fill = count > 0 ? `rgba(16, 185, 129, ${(0.15 + t * 0.7).toFixed(2)})` : "rgba(75, 85, 99, 0.2)";
      const x = 40 + c * colWidth;
      const y = headerHeight + r * rowHeight;
      return `<rect x="${x}" y="${y}" width="${colWidth - 8}" height="${rowHeight - 6}" rx="3" fill="${fill}" stroke="#1f2937" />
        <text x="${x + (colWidth - 8) / 2}" y="${y + (rowHeight - 6) / 2 + 4}" font-size="10" font-family="ui-sans-serif" fill="${count > 0 ? "#022c22" : "#94a3b8"}" text-anchor="middle">${count}</text>`;
    }).join("");
  }).join("");

  const headerSvg = cols.map((h, c) => {
    const x = 40 + c * colWidth;
    return `<rect x="${x}" y="40" width="${colWidth - 8}" height="${headerHeight - 50}" rx="3" fill="#1f2937" />
      <text x="${x + (colWidth - 8) / 2}" y="${headerHeight - 22}" font-size="10" font-family="ui-sans-serif" fill="#cbd5e1" text-anchor="middle">${escapeXml(h).slice(0, 14)}</text>`;
  }).join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
  <rect width="${totalWidth}" height="${totalHeight}" fill="#020617" />
  <text x="20" y="22" font-size="14" font-family="ui-sans-serif" fill="#fff" font-weight="bold">Evidence Matrix · Compounds × Methods</text>
  <g>${headerSvg}</g>
  <g>${cellSvg}</g>
  <text x="20" y="${totalHeight - 16}" font-size="10" font-family="ui-sans-serif" fill="#94a3b8">HempForge · deterministic synthesis</text>
</svg>`;

  return { id: `fig-mat-${Date.now()}`, kind: "evidence-matrix", mimeType: "image/svg+xml", svg, width: totalWidth, height: totalHeight };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function timelineSvg(artifact: SynthesisArtifact, opts?: { width?: number; height?: number }): FigureResult {
  const width = opts?.width ?? 900;
  const height = opts?.height ?? 280;

  // extract events from section body
  const events: Array<{ date: string; label: string }> = [];
  for (const s of artifact.sections) {
    if (!s.heading.toLowerCase().includes("timeline")) continue;
    for (const line of s.body.split("\n")) {
      const m = line.match(/^(\d{4})\s+—\s+(.+)$/);
      if (m) events.push({ date: m[1], label: m[2] });
    }
  }

  if (events.length === 0) {
    return { id: `fig-tl-${Date.now()}`, kind: "timeline", mimeType: "image/svg+xml", svg: emptySvg(width, height, "No timeline data"), width, height };
  }

  const years = events.map((e) => parseInt(e.date, 10)).sort((a, b) => a - b);
  const min = years[0];
  const max = years[years.length - 1];
  const span = Math.max(1, max - min);
  const pad = 60;
  const axisY = height - 50;

  const markers = events.map((e) => {
    const x = pad + ((parseInt(e.date, 10) - min) / span) * (width - 2 * pad);
    return `<g>
      <circle cx="${x.toFixed(1)}" cy="${axisY}" r="5" fill="#10b981" />
      <line x1="${x.toFixed(1)}" y1="${axisY - 5}" x2="${x.toFixed(1)}" y2="${axisY - 25}" stroke="#10b981" stroke-width="1.5" />
      <text x="${x.toFixed(1)}" y="${axisY - 30}" font-size="10" font-family="ui-sans-serif" fill="#cbd5e1" text-anchor="middle">${e.date}</text>
      <text x="${x.toFixed(1)}" y="${axisY - 60}" font-size="9" font-family="ui-sans-serif" fill="#94a3b8" text-anchor="middle" transform="rotate(-15 ${x.toFixed(1)} ${axisY - 60})">${escapeXml(e.label.slice(0, 36))}</text>
    </g>`;
  }).join("");

  const axis = `<line x1="${pad}" y1="${axisY}" x2="${width - pad}" y2="${axisY}" stroke="#475569" stroke-width="1" />
    <text x="${pad}" y="${axisY + 18}" font-size="10" font-family="ui-sans-serif" fill="#64748b">${min}</text>
    <text x="${width - pad}" y="${axisY + 18}" font-size="10" font-family="ui-sans-serif" fill="#64748b" text-anchor="end">${max}</text>
    <text x="20" y="22" font-size="14" font-family="ui-sans-serif" fill="#fff" font-weight="bold">Timeline · ${events.length} events</text>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#020617" />
  ${axis}
  ${markers}
</svg>`;

  return { id: `fig-tl-${Date.now()}`, kind: "timeline", mimeType: "image/svg+xml", svg, width, height };
}

// ---------------------------------------------------------------------------
// Multi-panel composite
// ---------------------------------------------------------------------------

export function compositePanelSvg(artifact: SynthesisArtifact, opts?: { width?: number; height?: number }): FigureResult {
  const net = citationNetworkSvg(artifact, { width: 600, height: 380 });
  const mat = evidenceMatrixSvg(artifact, { width: 600, height: 320 });
  const tl = timelineSvg(artifact, { width: 900, height: 200 });

  const totalWidth = 1240;
  const totalHeight = 720;

  const panel = (x: number, y: number, w: number, h: number, title: string, body: string) => `
    <g transform="translate(${x} ${y})">
      <rect width="${w}" height="${h}" rx="6" fill="#0b1220" stroke="#1f2937" />
      <text x="14" y="20" font-size="12" font-family="ui-sans-serif" fill="#94a3b8" font-weight="bold">${title}</text>
      <g transform="translate(0 28)">${body}</g>
    </g>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
  <rect width="${totalWidth}" height="${totalHeight}" fill="#020617" />
  <text x="20" y="26" font-size="16" font-family="ui-sans-serif" fill="#fff" font-weight="bold">HempForge Synthesis Panel · ${artifact.scopedSourceCount} sources · ${artifact.scopedSpanCount} spans</text>
  <text x="20" y="44" font-size="11" font-family="ui-sans-serif" fill="#64748b">${artifact.jobName} · ${artifact.generatedAt}</text>
  ${panel(20, 70, 600, 380, "Citation Network", extractInner(net.svg, 600, 380))}
  ${panel(640, 70, 580, 380, "Evidence Matrix", extractInner(mat.svg, 580, 380))}
  ${panel(20, 470, 1200, 230, "Timeline", extractInner(tl.svg, 1200, 230))}
</svg>`;

  return { id: `fig-panel-${Date.now()}`, kind: "panel", mimeType: "image/svg+xml", svg, width: totalWidth, height: totalHeight };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySvg(width: number, height: number, msg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#020617" />
  <text x="${width / 2}" y="${height / 2}" font-size="14" font-family="ui-sans-serif" fill="#94a3b8" text-anchor="middle">${escapeXml(msg)}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract the inner content (everything between the opening and closing
 * <svg> tags) so we can compose multiple SVGs into a single panel.
 */
function extractInner(svg: string, targetWidth: number, targetHeight: number): string {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) return "";
  const inner = m[1];
  // Rewrite the first <rect width="..." height="..."> to use the target dims
  return inner.replace(/<rect width="\d+" height="\d+" fill="[^"]*"\s*\/>/, `<rect width="${targetWidth}" height="${targetHeight}" fill="#0b1220" />`);
}