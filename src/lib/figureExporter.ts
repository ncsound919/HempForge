export interface FigureExport {
  paperId: string;
  sceneId: string;
  imageUrl: string;
  caption: string;
  resolution: { width: number; height: number };
  exportedAt: string;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export async function captureScene(
  canvas: HTMLCanvasElement,
  options?: { width?: number; height?: number; quality?: number }
): Promise<string> {
  const targetWidth = options?.width ?? canvas.width;
  const targetHeight = options?.height ?? canvas.height;

  if (targetWidth !== canvas.width || targetHeight !== canvas.height) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = targetWidth;
    tempCanvas.height = targetHeight;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context from temporary canvas");
    }
    ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    return tempCanvas.toDataURL("image/png");
  }

  return canvas.toDataURL("image/png");
}

export function generateCaption(
  sceneTitle: string,
  sceneType: string,
  entityNames: string[],
  processNames: string[]
): string {
  const sceneTypeLabel = sceneType.replace(/_/g, " ");
  let caption = `3D visualization of ${sceneTypeLabel}`;

  if (entityNames.length > 0) {
    caption += ` showing ${entityNames.join(", ")}`;
  }

  if (processNames.length > 0) {
    caption += ` with ${processNames.join(", ")}`;
  }

  caption += `. ${sceneTitle}.`;

  return caption;
}

export function formatFigureForExport(figure: FigureExport): {
  filename: string;
  markdownEmbed: string;
  latexEmbed: string;
  htmlEmbed: string;
} {
  const safeFilename = figure.sceneId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeFilename}.png`;

  const markdownEmbed = `![${figure.caption}](${figure.imageUrl})`;

  const escapedCaption = figure.caption
    .replace(/\\/g, "\\\\")
    .replace(/#/g, "\\#")
    .replace(/\$/g, "\\$")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/&/g, "\\&")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\~")
    .replace(/\^/g, "\\^");
  const latexEmbed = `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${filename}}\n  \\caption{${escapedCaption}}\n  \\label{fig:${safeFilename}}\n\\end{figure}`;

  const htmlEmbed = `<figure>\n  <img src="${escapeHtml(figure.imageUrl)}" alt="${escapeHtml(figure.caption)}" width="${figure.resolution.width}" height="${figure.resolution.height}" />\n  <figcaption>${escapeHtml(figure.caption)}</figcaption>\n</figure>`;

  return { filename, markdownEmbed, latexEmbed, htmlEmbed };
}
