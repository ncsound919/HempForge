import React, { useCallback, useRef, useState } from 'react';
import {
  Upload,
  FileText,
  Beaker,
  Network,
  BarChart3,
  Cpu,
  Download,
  Eye,
  CheckCircle2,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import SceneRenderer from '../3d/SceneRenderer';
import { usePipeline } from '../../contexts/PipelineContext';
import {
  createDefaultSceneSpec,
  validateSceneSpec,
} from '../../lib/sceneSpecSchema';
import type { SceneSpec } from '../../lib/sceneSpecSchema';

interface OcrResult {
  text: string;
  documentType: string;
  compounds: string[];
  parameters: Array<{ name: string; value: string; unit: string }>;
}

interface SceneVisualizationTabProps {
  showLabNotification: (msg: string) => void;
}

const SCENE_TYPE_PRESETS: Array<{
  label: string;
  sceneType: SceneSpec['sceneType'];
  icon: React.ReactNode;
  description: string;
}> = [
  {
    label: 'Molecule Viewer',
    sceneType: 'molecule',
    icon: <Beaker size={14} />,
    description: 'Single compound 3D model',
  },
  {
    label: 'Extraction Process',
    sceneType: 'extraction_process',
    icon: <Cpu size={14} />,
    description: 'Process flow visualization',
  },
  {
    label: 'Compound Network',
    sceneType: 'compound_network',
    icon: <Network size={14} />,
    description: 'Node-link relationship graph',
  },
  {
    label: 'Publication Activity',
    sceneType: 'timeline',
    icon: <BarChart3 size={14} />,
    description: 'Publication density heatmap',
  },
];

const DOCUMENT_TYPE_BADGES: Record<string, string> = {
  coa: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  research_paper: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  sop: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  regulatory: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  unknown: 'bg-white/10 text-white/50 border-white/10',
};

export default function SceneVisualizationTab({
  showLabNotification,
}: SceneVisualizationTabProps) {
  const { loadParsedCoa, addPaper } = usePipeline();

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [activeSceneSpec, setActiveSceneSpec] = useState<SceneSpec | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<SceneSpec['sceneType'] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const processImage = useCallback(async (file: File) => {
    setIsProcessing(true);
    setOcrProgress(0);

    try {
      const Tesseract = (await import('tesseract.js')).default;
      const worker = await (Tesseract as any).createWorker("eng");
      try {
        const result = await worker.recognize(file, 'eng', {
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          },
        });

        const text = result.data.text;
        const parsed = parseOcrText(text);
        setOcrResult(parsed);
      } finally {
        await worker.terminate();
      }
    } catch {
      showLabNotification('OCR processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setOcrProgress(0);
    }
  }, [showLabNotification]);

  const processPdf = useCallback(async (file: File) => {
    setIsProcessing(true);
    setOcrProgress(0);

    try {
      setOcrProgress(30);
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/ocr/extract', {
        method: 'POST',
        body: formData,
      });

      setOcrProgress(80);

      if (!response.ok) {
        throw new Error('OCR extraction failed');
      }

      const data = await response.json();
      setOcrResult({
        text: data.text || '',
        documentType: data.documentType || 'unknown',
        compounds: data.compounds || [],
        parameters: data.parameters || [],
      });
    } catch {
      showLabNotification('PDF processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setOcrProgress(0);
    }
  }, [showLabNotification]);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;

      setUploadedFile(file);
      setOcrResult(null);
      setActiveSceneSpec(null);

      if (file.type.startsWith('image/')) {
        processImage(file);
      } else if (file.type === 'application/pdf') {
        processPdf(file);
      } else {
        showLabNotification('Unsupported file type. Upload images or PDFs.');
      }
    },
    [processImage, processPdf, showLabNotification]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadedFile(file);
      setOcrResult(null);
      setActiveSceneSpec(null);

      if (file.type.startsWith('image/')) {
        processImage(file);
      } else if (file.type === 'application/pdf') {
        processPdf(file);
      }
    },
    [processImage, processPdf]
  );

  const handleGenerateScene = useCallback(async () => {
    if (!ocrResult) return;

    setIsProcessing(true);
    try {
      const response = await fetch('/api/scene/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ocrResult.text,
          documentType: ocrResult.documentType,
          compounds: ocrResult.compounds,
          parameters: ocrResult.parameters,
        }),
      });

      if (!response.ok) {
        throw new Error('Scene generation failed');
      }

      const spec: SceneSpec = await response.json();
      if (validateSceneSpec(spec)) {
        setActiveSceneSpec(spec);
        showLabNotification('3D scene generated successfully.');
      } else {
        showLabNotification('Generated scene is invalid. Please try again.');
      }
    } catch {
      showLabNotification('Scene generation failed. Using fallback.');
      const fallbackSpec = createFallbackSpec(ocrResult);
      setActiveSceneSpec(fallbackSpec);
    } finally {
      setIsProcessing(false);
    }
  }, [ocrResult, showLabNotification]);

  const handlePresetSelect = useCallback(
    (sceneType: SceneSpec['sceneType']) => {
      setSelectedPreset(sceneType);
      const spec = createDefaultSceneSpec(
        SCENE_TYPE_PRESETS.find((p) => p.sceneType === sceneType)?.label || 'Scene',
        sceneType
      );
      setActiveSceneSpec(spec);
    },
    []
  );

  const handleExport = useCallback(
    (canvas: HTMLCanvasElement) => {
      const link = document.createElement('a');
      link.download = `hempforge-scene-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showLabNotification('Scene exported as PNG.');
    },
    [showLabNotification]
  );

  const handleAddToPipeline = useCallback(() => {
    if (!ocrResult) return;

    if (
      ocrResult.documentType === 'coa' &&
      ocrResult.parameters.length > 0
    ) {
      const strainParam = ocrResult.parameters.find((p) =>
        p.name.toLowerCase().includes('strain')
      );
      const thcaParam = ocrResult.parameters.find((p) =>
        p.name.toLowerCase().includes('thca')
      );
      const d9thcParam = ocrResult.parameters.find((p) =>
        p.name.toLowerCase().includes('delta-9') || p.name.toLowerCase().includes('d9')
      );
      const moistureParam = ocrResult.parameters.find((p) =>
        p.name.toLowerCase().includes('moisture')
      );

      const patch: Record<string, string | number> = {};
      if (strainParam) patch.pipelineStrain = strainParam.value;
      if (thcaParam) patch.pipelineTHCa = parseFloat(thcaParam.value) || 0;
      if (d9thcParam) patch.pipelineD9THC = parseFloat(d9thcParam.value) || 0;
      if (moistureParam) patch.pipelineMoisture = parseFloat(moistureParam.value) || 0;

      loadParsedCoa(patch as Parameters<typeof loadParsedCoa>[0]);
      showLabNotification('COA data added to pipeline.');
    }

    if (ocrResult.documentType === 'research_paper') {
      addPaper({
        id: `paper-${Date.now()}`,
        name: ocrResult.text.slice(0, 60) || 'Uploaded Paper',
        path: uploadedFile?.name || 'unknown',
        size: uploadedFile ? `${(uploadedFile.size / 1024).toFixed(1)} KB` : '0 KB',
        type: 'pdf',
        uploadDate: new Date().toISOString().split('T')[0],
        title: ocrResult.text.slice(0, 80) || 'Untitled',
        journal: 'Uploaded',
        year: new Date().getFullYear(),
        authors: 'Unknown',
        abstract: ocrResult.text.slice(0, 300),
        compounds: ocrResult.compounds,
        dosage: '',
        outcomes: '',
        isCustom: true,
      });
      showLabNotification('Paper added to library.');
    }
  }, [ocrResult, uploadedFile, loadParsedCoa, addPaper, showLabNotification]);

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px]">
      <div className="w-[40%] border-r border-white/5 flex flex-col bg-[#080C0A]">
        <div className="px-4 py-3 border-b border-white/5">
          <div className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
            <FileText size={12} />
            Document Processing
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div
            className={`border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
              isDragOver
                ? 'border-emerald-500/50 bg-emerald-500/5'
                : 'border-white/10 hover:border-white/20'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Upload
              size={24}
              className={`mx-auto mb-2 ${
                isDragOver ? 'text-emerald-400' : 'text-white/20'
              }`}
            />
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider">
              {uploadedFile
                ? uploadedFile.name
                : 'Drop image or PDF here'}
            </div>
            <div className="text-[7px] font-mono text-white/20 mt-1">
              Supports PNG, JPG, PDF
            </div>
          </div>

          {isProcessing && (
            <div className="bg-[#0D1411] border border-white/10 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Loader2
                  size={12}
                  className="text-emerald-400 animate-spin"
                />
                <span className="text-[8px] font-mono text-white/60 uppercase tracking-wider">
                  {uploadedFile?.type.startsWith('image/')
                    ? 'Running OCR...'
                    : 'Processing PDF...'}
                </span>
              </div>
              <div className="h-1 bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${ocrProgress}%` }}
                />
              </div>
              <div className="text-[7px] font-mono text-white/30 mt-1">
                {ocrProgress}% complete
              </div>
            </div>
          )}

          {ocrResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2
                  size={12}
                  className="text-emerald-400"
                />
                <span className="text-[8px] font-mono text-emerald-400 uppercase tracking-widest">
                  Extraction Complete
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`text-[7px] font-mono px-2 py-0.5 border uppercase tracking-widest ${
                    DOCUMENT_TYPE_BADGES[ocrResult.documentType] ||
                    DOCUMENT_TYPE_BADGES.unknown
                  }`}
                >
                  {ocrResult.documentType.replace('_', ' ')}
                </span>
              </div>

              {ocrResult.compounds.length > 0 && (
                <div>
                  <div className="text-[7px] font-mono text-white/30 uppercase tracking-wider mb-1.5">
                    Detected Compounds
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ocrResult.compounds.map((compound) => (
                      <span
                        key={compound}
                        className="text-[7px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      >
                        {compound}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {ocrResult.parameters.length > 0 && (
                <div>
                  <div className="text-[7px] font-mono text-white/30 uppercase tracking-wider mb-1.5">
                    Parameters
                  </div>
                  <div className="border border-white/10 divide-y divide-white/5">
                    {ocrResult.parameters.map((param) => (
                      <div
                        key={param.name}
                        className="flex justify-between items-center px-2 py-1.5"
                      >
                        <span className="text-[7px] font-mono text-white/50">
                          {param.name}
                        </span>
                        <span className="text-[8px] font-mono text-white/70">
                          {param.value} {param.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border border-white/10 p-2 max-h-[120px] overflow-y-auto">
                <div className="text-[7px] font-mono text-white/30 uppercase tracking-wider mb-1">
                  Extracted Text
                </div>
                <div className="text-[7px] font-mono text-white/40 whitespace-pre-wrap leading-relaxed">
                  {ocrResult.text.slice(0, 500)}
                  {ocrResult.text.length > 500 && '...'}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleGenerateScene}
                  disabled={isProcessing}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/20 border border-emerald-500/30 px-3 py-2 text-[8px] font-mono text-emerald-400 uppercase tracking-widest hover:bg-emerald-500/30 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <Eye size={10} />
                  Generate 3D Scene
                </button>
                <button
                  onClick={handleAddToPipeline}
                  className="flex items-center justify-center gap-1.5 bg-white/5 border border-white/10 px-3 py-2 text-[8px] font-mono text-white/50 uppercase tracking-widest hover:text-white/70 hover:border-white/20 transition-colors cursor-pointer"
                >
                  <ChevronRight size={10} />
                  Add to Pipeline
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="text-[7px] font-mono text-white/30 uppercase tracking-wider mb-2">
              Quick Scene Presets
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SCENE_TYPE_PRESETS.map((preset) => (
                <button
                  key={preset.sceneType}
                  onClick={() => handlePresetSelect(preset.sceneType)}
                  className={`flex items-center gap-1.5 p-2 border text-left transition-colors cursor-pointer ${
                    selectedPreset === preset.sceneType
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/60'
                  }`}
                >
                  {preset.icon}
                  <div>
                    <div className="text-[7px] font-mono uppercase tracking-wider">
                      {preset.label}
                    </div>
                    <div className="text-[6px] font-mono text-white/20 mt-0.5">
                      {preset.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="w-[60%] flex flex-col bg-[#050907]">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
            <Cpu size={12} />
            3D Scene Visualization
          </div>
          {activeSceneSpec && (
            <button
              onClick={() => {
                const canvas = document.querySelector('canvas');
                if (canvas) handleExport(canvas as HTMLCanvasElement);
              }}
              className="flex items-center gap-1 text-[7px] font-mono text-white/30 uppercase tracking-wider hover:text-emerald-400 transition-colors cursor-pointer"
            >
              <Download size={10} />
              Export
            </button>
          )}
        </div>

        <div className="flex-1 relative" ref={canvasContainerRef}>
          {activeSceneSpec ? (
            <SceneRenderer
              spec={activeSceneSpec}
              height="100%"
              onExport={handleExport}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-[240px]">
                <div className="w-12 h-12 mx-auto mb-3 border border-white/10 flex items-center justify-center">
                  <Eye size={20} className="text-white/10" />
                </div>
                <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">
                  No Scene Active
                </div>
                <div className="text-[7px] font-mono text-white/15 leading-relaxed">
                  Upload a document for OCR extraction or select a preset to
                  generate a 3D visualization
                </div>
              </div>
            </div>
          )}
        </div>

        {activeSceneSpec && (
          <div className="px-4 py-3 border-t border-white/5 bg-[#080C0A]">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-[8px] font-mono text-white/50">
                  {activeSceneSpec.title}
                </div>
                <div className="text-[7px] font-mono text-white/25">
                  {activeSceneSpec.entities.length} entities ·{' '}
                  {activeSceneSpec.processes.length} processes ·{' '}
                  {activeSceneSpec.relationships.length} relationships
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[7px] font-mono text-white/20 uppercase tracking-wider">
                  Confidence
                </span>
                <div className="w-16 h-1 bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${activeSceneSpec.confidence * 100}%`,
                    }}
                  />
                </div>
                <span className="text-[7px] font-mono text-emerald-400">
                  {Math.round(activeSceneSpec.confidence * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseOcrText(text: string): OcrResult {
  let documentType = 'unknown';
  const lowerText = text.toLowerCase();
  if (
    lowerText.includes('certificate of analysis') ||
    lowerText.includes('coa') ||
    lowerText.includes('potency analysis')
  ) {
    documentType = 'coa';
  } else if (
    lowerText.includes('abstract') ||
    lowerText.includes('methodology') ||
    lowerText.includes('conclusion')
  ) {
    documentType = 'research_paper';
  } else if (
    lowerText.includes('standard operating') ||
    lowerText.includes('sop')
  ) {
    documentType = 'sop';
  }

  const compoundPatterns = [
    'THCa', 'THC', 'CBDa', 'CBD', 'CBGa', 'CBG', 'CBN', 'CBC',
    'Myrcene', 'Limonene', 'Linalool', 'Pinene', 'Caryophyllene',
  ];
  const compounds = compoundPatterns.filter((c) =>
    lowerText.includes(c.toLowerCase())
  );

  const paramRegex = /(\w[\w\s-]+?):\s*([\d.]+)\s*(%|wt%|mg|ppm|°C|°F|psi)?/gi;
  const parameters: Array<{ name: string; value: string; unit: string }> = [];
  let match;
  while ((match = paramRegex.exec(text)) !== null) {
    parameters.push({
      name: match[1].trim(),
      value: match[2],
      unit: match[3] || '',
    });
  }

  return {
    text,
    documentType,
    compounds,
    parameters,
  };
}

function createFallbackSpec(ocrResult: OcrResult): SceneSpec {
  const spec = createDefaultSceneSpec('Extracted Scene', 'molecule');

  const knownTemplates = ['THCa', 'THC', 'CBD', 'CBG', 'CBN'] as const;
  const matchedTemplate = ocrResult.compounds.find((c) =>
    knownTemplates.includes(c as typeof knownTemplates[number])
  );

  if (matchedTemplate) {
    spec.entities.push({
      id: `entity-${Date.now()}`,
      type: 'compound_class',
      name: matchedTemplate,
      properties: {},
      moleculeTemplate: matchedTemplate as typeof knownTemplates[number],
    });
  }

  spec.confidence = 0.6;
  spec.description = `Auto-generated from ${ocrResult.documentType.replace('_', ' ')} extraction`;

  return spec;
}
