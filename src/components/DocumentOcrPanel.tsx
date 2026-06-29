import React, { useCallback, useState } from "react";
import { COMPOUND_NAMES } from "../lib/ocrPipeline";
import {
  FileUp,
  FileImage,
  FileText,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ScanLine,
  Loader2,
  X,
} from "lucide-react";

type OcrWord = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

type OcrResult = {
  text: string;
  confidence: number;
  words: OcrWord[];
  pageCount: number;
};

type DocumentSection = {
  type:
    | "abstract"
    | "introduction"
    | "methods"
    | "results"
    | "discussion"
    | "conclusion"
    | "references"
    | "figures"
    | "unknown";
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
};

type DocumentSections = {
  sections: DocumentSection[];
  title?: string;
  authors?: string[];
  doi?: string;
};

type HempEntity = {
  name: string;
  concentration?: number;
  unit?: string;
};

type HempEntities = {
  compounds: HempEntity[];
  strains: string[];
  methods: string[];
  parameters: Array<{ name: string; value: number; unit: string }>;
};

type DocumentType =
  | "coa"
  | "research_paper"
  | "sop"
  | "regulatory"
  | "patent"
  | "notes"
  | "unknown";

export type OcrExtractionResult = {
  ocr: OcrResult;
  sections: DocumentSections;
  entities: HempEntities;
  classification: DocumentType;
};

const SECTION_COLORS: Record<DocumentSection["type"], string> = {
  abstract: "text-sky-400 border-sky-500/30 bg-sky-500/5",
  introduction: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  methods: "text-amber-400 border-amber-500/30 bg-amber-500/5",
  results: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  discussion: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  conclusion: "text-teal-400 border-teal-500/30 bg-teal-500/5",
  references: "text-slate-400 border-slate-500/30 bg-slate-500/5",
  figures: "text-pink-400 border-pink-500/30 bg-pink-500/5",
  unknown: "text-white/60 border-white/10 bg-white/5",
};

const CLASSIFICATION_STYLES: Record<DocumentType, string> = {
  coa: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  research_paper: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  sop: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  regulatory: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  patent: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  notes: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  unknown: "bg-white/10 text-white/40 border-white/10",
};

const CLASSIFICATION_LABELS: Record<DocumentType, string> = {
  coa: "Certificate of Analysis",
  research_paper: "Research Paper",
  sop: "Standard Operating Procedure",
  regulatory: "Regulatory Document",
  patent: "Patent",
  notes: "Notes",
  unknown: "Unknown",
};

function detectSections(text: string): DocumentSections {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lowerText = normalized.toLowerCase();
  const sections: DocumentSection[] = [];

  const titleMatch = normalized.match(/^([^\n]{5,200})/);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  const doiMatch = normalized.match(
    /(?:doi[:\s]*|https?:\/\/doi\.org\/)(10\.\d{4,}\/[^\s,]+)/i
  );
  const doi = doiMatch ? doiMatch[0] : undefined;

  const patterns: Array<{
    type: DocumentSection["type"];
    regex: RegExp;
  }> = [
    { type: "abstract", regex: /^abstract[\s:.—–-]*/im },
    { type: "introduction", regex: /^introduction[\s:.—–-]*/im },
    {
      type: "methods",
      regex: /^(?:methods?|materials?\s+and\s+methods?|methodology|experimental\s+(?:design|procedure))[\s:.—–-]*/im,
    },
    {
      type: "results",
      regex: /^(?:results?(?:\s+and\s+discussion)?|findings?|observations?)[\s:.—–-]*/im,
    },
    { type: "discussion", regex: /^discussion[\s:.—–-]*/im },
    {
      type: "conclusion",
      regex: /^(?:conclusions?|summary|concluding\s+remarks?)[\s:.—–-]*/im,
    },
    {
      type: "references",
      regex: /^(?:references?|bibliography|literature\s+cited|works?\s+cited)[\s:.—–-]*/im,
    },
    { type: "figures", regex: /^(?:figures?|tables?|appendix|appendices)[\s:.—–-]*/im },
  ];

  for (const { type, regex } of patterns) {
    const match = lowerText.match(regex);
    if (match && match.index !== undefined) {
      sections.push({
        type,
        title: match[0].replace(/[\s:.—–-]+$/, "").trim(),
        content: "",
        startIndex: match.index,
        endIndex: normalized.length,
      });
    }
  }

  sections.sort((a, b) => a.startIndex - b.startIndex);

  for (let i = 0; i < sections.length; i++) {
    sections[i].endIndex =
      i < sections.length - 1 ? sections[i + 1].startIndex : normalized.length;
    sections[i].content = normalized
      .slice(sections[i].startIndex, sections[i].endIndex)
      .replace(/\s+/g, " ")
      .trim();
  }

  if (sections.length === 0 && normalized.length > 0) {
    sections.push({
      type: "unknown",
      title: "Full Document",
      content: normalized,
      startIndex: 0,
      endIndex: normalized.length,
    });
  }

  return { sections, title, doi };
}

function extractHempEntities(text: string): HempEntities {
  const lowerText = text.toLowerCase();
  const compounds: HempEntity[] = [];

  for (const name of COMPOUND_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `${escaped}[:\\s]*(\\d+(?:\\.\\d+)?)\\s*(%|mg\\/g|mg\\/kg|ppm|mg|g)?`,
      "gi"
    );
    const match = regex.exec(text);
    if (match) {
      compounds.push({
        name,
        concentration: parseFloat(match[1]),
        unit: match[2] || "%",
      });
    } else if (lowerText.includes(name.toLowerCase())) {
      compounds.push({ name });
    }
  }

  const strainSet = new Set<string>();
  const strainRegex =
    /strain[:\s]+([A-Z][a-zA-Z0-9\s\-]+(?:flower|bud|kush|haze|diesel|glue|cake|pie|dream|wine|gold|lemon|berry|punch| OG)?)/gi;
  let strainMatch: RegExpExecArray | null;
  while ((strainMatch = strainRegex.exec(text)) !== null) {
    const strain = strainMatch[1].trim();
    if (strain.length >= 2 && strain.length <= 60) {
      strainSet.add(strain);
    }
  }

  const methodsSet = new Set<string>();
  const extractionMethods = [
    "CO2", "supercritical CO2", "ethanol", "hydrocarbon",
    "butane", "propane", "BHO", "live resin", "distillate",
    "isolate", "full spectrum", "broad spectrum", "solventless",
    "rosin", "bubble hash", "dry sift",
  ];
  for (const method of extractionMethods) {
    if (lowerText.includes(method.toLowerCase())) {
      methodsSet.add(method);
    }
  }

  const parameters: HempEntities["parameters"] = [];
  const paramPatterns: Array<{ name: string; regex: RegExp }> = [
    { name: "Temperature", regex: /(?:temperature|temp)[:\s]+(\d+(?:\.\d+)?)\s*(°?[CcFf])/gi },
    { name: "Duration", regex: /(?:duration|time|incubation)[:\s]+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|hrs?|hours?)/gi },
    { name: "Pressure", regex: /(?:pressure)[:\s]+(\d+(?:\.\d+)?)\s*(psi|bar|atm)/gi },
    { name: "pH", regex: /pH[:\s]+(\d+(?:\.\d+)?)/gi },
  ];

  for (const { name, regex } of paramPatterns) {
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = regex.exec(text)) !== null) {
      const value = parseFloat(paramMatch[1]);
      const unit = paramMatch[2] || "";
      parameters.push({ name, value, unit });
    }
  }

  return {
    compounds,
    strains: Array.from(strainSet),
    methods: Array.from(methodsSet),
    parameters,
  };
}

function classifyDocument(text: string, sections: DocumentSections): DocumentType {
  const lowerText = text.toLowerCase();
  const sectionTypes = new Set(sections.sections.map((s) => s.type));

  const scoreKeywords = (keywords: string[]): number => {
    let score = 0;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) score += 2;
    }
    return score;
  };

  const scores: Array<{ type: DocumentType; score: number }> = [
    {
      type: "coa",
      score: scoreKeywords([
        "certificate of analysis", "potency", "compliant",
        "lab result", "batch id", "moisture",
      ]),
    },
    {
      type: "research_paper",
      score: scoreKeywords([
        "abstract", "methods", "results", "discussion",
        "conclusion", "references", "doi", "journal",
      ]),
    },
    {
      type: "sop",
      score: scoreKeywords([
        "procedure", "step", "protocol",
        "standard operating procedure", "sop",
      ]),
    },
    {
      type: "regulatory",
      score: scoreKeywords([
        "regulation", "usda", "fda", "compliance",
        "licensing", "inspection", "ncda",
      ]),
    },
    {
      type: "patent",
      score: scoreKeywords([
        "patent", "claims", "invention", "prior art",
        "embodiment", "wherein",
      ]),
    },
  ];

  if (sectionTypes.has("abstract") && sectionTypes.has("methods")) {
    scores.find((s) => s.type === "research_paper")!.score += 6;
  }
  if (sectionTypes.has("references")) {
    scores.find((s) => s.type === "research_paper")!.score += 3;
  }

  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score < 4) {
    return text.length < 500 ? "notes" : "unknown";
  }

  return scores[0].type;
}

async function processWithTesseract(
  file: File,
  onProgress?: (step: string) => void
): Promise<OcrExtractionResult> {
  onProgress?.("Initializing Tesseract.js worker...");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");

  try {
    onProgress?.("Reading document binary...");
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer], { type: file.type });
    
    onProgress?.("Running Optical Character Recognition (OCR)...");
    const { data } = await worker.recognize(blob);

    onProgress?.("Structuring OCR token boundaries...");
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const word of line.words ?? []) {
            words.push({
              text: word.text,
              bbox: {
                x0: word.bbox.x0,
                y0: word.bbox.y0,
                x1: word.bbox.x1,
                y1: word.bbox.y1,
              },
              confidence: word.confidence,
            });
          }
        }
      }
    }

    const ocrResult: OcrResult = {
      text: data.text,
      confidence: data.confidence,
      words,
      pageCount: 1,
    };

    onProgress?.("Segmenting document sections...");
    const sections = detectSections(ocrResult.text);
    
    onProgress?.("Extracting chemical structures & cannabinoids...");
    const entities = extractHempEntities(ocrResult.text);
    
    onProgress?.("Performing GxP document classification...");
    const classification = classifyDocument(ocrResult.text, sections);

    onProgress?.("Complete");
    return { ocr: ocrResult, sections, entities, classification };
  } finally {
    await worker.terminate();
  }
}

interface DocumentOcrPanelProps {
  onExtracted?: (result: OcrExtractionResult) => void;
  onGenerateScene?: (result: OcrExtractionResult) => void;
}

export default function DocumentOcrPanel({
  onExtracted,
  onGenerateScene,
}: DocumentOcrPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrExtractionResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleExtract = useCallback(async () => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingStep("Starting pipeline...");
    setError(null);
    setResult(null);

    try {
      const extraction = await processWithTesseract(file, (step) => {
        setProcessingStep(step);
      });
      setResult(extraction);
      onExtracted?.(extraction);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "OCR processing failed"
      );
    } finally {
      setIsProcessing(false);
      setProcessingStep(null);
    }
  }, [file, onExtracted]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) {
        setFile(dropped);
        setResult(null);
        setError(null);
      }
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) {
        setFile(selected);
        setResult(null);
        setError(null);
      }
    },
    []
  );

  const handleClear = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  const isImage = file?.type.startsWith("image/") ?? false;
  const isPdf = file?.type === "application/pdf";

  return (
    <div className="space-y-6">
      <div className="border-b border-white/10 pb-4">
        <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
          <ScanLine size={16} />
          Document OCR &amp; Entity Extraction
        </h3>
        <p className="text-[10px] text-white/40 font-mono mt-1">
          Upload images or PDFs. Extracts text, hemp compounds, and classifies document type.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div
            className={`border border-dashed p-8 flex flex-col items-center justify-center text-center transition-colors ${
              isDragOver
                ? "border-emerald-500 bg-white/5"
                : "border-white/10 bg-[#0D1411] hover:bg-white/5"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {file ? (
              <div className="space-y-3">
                <div className="bg-emerald-500/20 p-3 text-emerald-400 inline-block">
                  {isImage ? (
                    <FileImage size={24} />
                  ) : (
                    <FileText size={24} />
                  )}
                </div>
                <div>
                  <p className="text-xs font-bold text-white">{file.name}</p>
                  <p className="text-[10px] text-white/40 font-mono mt-1">
                    {(file.size / 1024).toFixed(1)} KB &middot; {file.type}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleExtract}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-emerald-500 text-[#0A0F0D] font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <ScanLine size={12} />
                        Extract Text
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleClear}
                    disabled={isProcessing}
                    className="px-3 py-2 bg-white/5 text-white/60 text-[10px] uppercase tracking-widest hover:bg-white/10 hover:text-white disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    <X size={12} />
                    Clear
                  </button>
                </div>
                {!isImage && !isPdf && (
                  <p className="text-[10px] text-amber-400/60 font-mono">
                    Best results with PNG, JPEG, or PDF files
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-emerald-500/20 p-3 text-emerald-400 inline-block">
                  <FileUp size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">
                    Drag &amp; drop a document
                  </p>
                  <p className="text-[10px] text-white/40 font-mono mt-1">
                    Images (PNG, JPEG) or PDFs
                  </p>
                </div>
                <label className="inline-block px-4 py-2 bg-white/5 text-white/60 text-[10px] uppercase tracking-widest font-bold cursor-pointer hover:bg-white/10 hover:text-white transition-colors">
                  Browse Files
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                  />
                </label>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 flex items-start gap-2">
              <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 border ${CLASSIFICATION_STYLES[result.classification]}`}
                >
                  {CLASSIFICATION_LABELS[result.classification]}
                </span>
                <span className="text-[10px] text-white/30 font-mono">
                  {result.ocr.confidence.toFixed(1)}% confidence &middot;{" "}
                  {result.ocr.pageCount} page
                  {result.ocr.pageCount !== 1 ? "s" : ""}
                </span>
              </div>

              {result.entities.compounds.length > 0 && (
                <div className="bg-[#0D1411] border border-white/10 p-4">
                  <h4 className="text-[10px] font-bold text-emerald-400 font-mono uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <CheckCircle2 size={12} />
                    Detected Compounds
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {result.entities.compounds.map((c, i) => (
                      <div
                        key={`${c.name}-${i}`}
                        className="p-2 bg-[#1A221E] border border-white/5"
                      >
                        <div className="text-[10px] font-bold text-white">
                          {c.name}
                        </div>
                        {c.concentration !== undefined && (
                          <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                            {c.concentration}
                            {c.unit}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(result.entities.strains.length > 0 ||
                result.entities.methods.length > 0) && (
                <div className="bg-[#0D1411] border border-white/10 p-4">
                  <h4 className="text-[10px] font-bold text-emerald-400 font-mono uppercase tracking-widest mb-3">
                    Extracted Entities
                  </h4>
                  <div className="space-y-2">
                    {result.entities.strains.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">
                          Strains:
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {result.entities.strains.map((s) => (
                            <span
                              key={s}
                              className="text-[10px] text-white/70 bg-white/5 px-1.5 py-0.5 border border-white/10"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {result.entities.methods.length > 0 && (
                      <div>
                        <span className="text-[10px] text-white/40 font-mono uppercase">
                          Methods:
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {result.entities.methods.map((m) => (
                            <span
                              key={m}
                              className="text-[10px] text-amber-400/70 bg-amber-500/5 px-1.5 py-0.5 border border-amber-500/20"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {result && result.sections.sections.length > 0 && (
            <div className="bg-[#0D1411] border border-white/10 p-4 max-h-[300px] overflow-y-auto">
              <h4 className="text-[10px] font-bold text-emerald-400 font-mono uppercase tracking-widest mb-3">
                Sections
              </h4>
              <div className="space-y-2">
                {result.sections.sections.map((s, i) => (
                  <div
                    key={`${s.type}-${i}`}
                    className={`p-2 border ${SECTION_COLORS[s.type]}`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      {s.title}
                    </span>
                    <p className="text-[10px] text-white/40 mt-1 line-clamp-3">
                      {s.content.slice(0, 200)}
                      {s.content.length > 200 ? "..." : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="bg-[#0D1411] border border-white/10 p-4 max-h-[300px] overflow-y-auto">
              <h4 className="text-[10px] font-bold text-emerald-400 font-mono uppercase tracking-widest mb-3">
                Extracted Text
              </h4>
              <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap break-words leading-relaxed">
                {result.ocr.text.slice(0, 3000)}
                {result.ocr.text.length > 3000 ? "\n\n[truncated...]" : ""}
              </pre>
            </div>
          )}

          {result && onGenerateScene && (
            <button
              onClick={() => onGenerateScene(result)}
              className="w-full px-4 py-3 bg-emerald-500 text-[#0A0F0D] font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles size={14} />
              Generate 3D Scene
            </button>
          )}

          {isProcessing && (
            <div className="bg-[#0D1411] border border-white/10 p-6 space-y-6">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="text-emerald-400 animate-spin" />
                <h4 className="text-xs font-bold text-emerald-400 font-mono uppercase tracking-widest">
                  Live Extraction Pipeline
                </h4>
              </div>

              <div className="space-y-4">
                <PipelineStep 
                  label="Initializing Tesseract worker" 
                  active={!!processingStep?.includes("Tesseract")} 
                  done={!processingStep?.includes("Initializing") && !processingStep?.includes("Starting") && processingStep !== null}
                />
                <PipelineStep 
                  label="Reading Document Binary" 
                  active={!!processingStep?.includes("binary")} 
                  done={!processingStep?.includes("Initializing") && !processingStep?.includes("binary") && !processingStep?.includes("Starting") && processingStep !== null}
                />
                <PipelineStep 
                  label="Running OCR Text Scanning" 
                  active={!!(processingStep?.includes("Character") || processingStep?.includes("OCR"))} 
                  done={!!(processingStep?.includes("Structuring") || processingStep?.includes("Segmenting") || processingStep?.includes("Extracting") || processingStep?.includes("classification") || processingStep?.includes("Complete"))}
                />
                <PipelineStep 
                  label="Structuring Token Boundaries" 
                  active={!!processingStep?.includes("boundaries")} 
                  done={!!(processingStep?.includes("Segmenting") || processingStep?.includes("Extracting") || processingStep?.includes("classification") || processingStep?.includes("Complete"))}
                />
                <PipelineStep 
                  label="Segmenting Document Sections" 
                  active={!!processingStep?.includes("sections")} 
                  done={!!(processingStep?.includes("Extracting") || processingStep?.includes("classification") || processingStep?.includes("Complete"))}
                />
                <PipelineStep 
                  label="Extracting Chemical Compounds" 
                  active={!!(processingStep?.includes("chemical") || processingStep?.includes("cannabinoids"))} 
                  done={!!(processingStep?.includes("classification") || processingStep?.includes("Complete"))}
                />
                <PipelineStep 
                  label="Performing GxP Classification" 
                  active={!!processingStep?.includes("classification")} 
                  done={!!processingStep?.includes("Complete")}
                />
              </div>

              <div className="bg-black/20 p-3 border border-white/5 font-mono text-[9px] text-white/50">
                <span className="text-emerald-400 font-bold">LOG:</span> {processingStep}
              </div>
            </div>
          )}

          {!result && !isProcessing && (
            <div className="bg-[#0D1411] border border-white/10 p-8 flex flex-col items-center justify-center text-center min-h-[200px]">
              <ScanLine size={32} className="text-white/10 mb-3" />
              <p className="text-xs text-white/30 font-mono">
                Upload a document to begin extraction
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineStep({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-[10px] font-mono border-b border-white/5 pb-1">
      <span className={active ? "text-emerald-400 font-bold" : done ? "text-white/60" : "text-white/30"}>
        {label}
      </span>
      <span className={active ? "text-emerald-400 animate-pulse font-bold" : done ? "text-emerald-500 font-bold" : "text-white/20"}>
        {active ? "●" : done ? "✓" : "○"}
      </span>
    </div>
  );
}
