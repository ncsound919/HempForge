import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Image as ImageIcon, 
  Sparkles, 
  Copy, 
  Download, 
  Palette, 
  Sliders, 
  Eye, 
  Check, 
  CheckCircle2,
  Cpu,
  Loader2
} from 'lucide-react';
import { DocumentEntry } from './DocumentLibrary';
import { authFetch } from '../lib/firebase';

interface FlyerCreatorProps {
  papers?: DocumentEntry[];
  selectedPaperId?: string;
}

// Utility to wrap text for SVG rendering since SVG doesn't support automatic text wrapping
const wrapText = (text: string, maxChars: number, maxLines: number): string[] => {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + word).length > maxChars) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = word + ' ';
      if (lines.length === maxLines) return lines; // Stop if we hit the line limit
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine.trim() && lines.length < maxLines) lines.push(currentLine.trim());
  return lines;
};

export default function FlyerCreator({ papers = [], selectedPaperId }: FlyerCreatorProps) {
  const [activePaperId, setActivePaperId] = useState<string>(selectedPaperId || papers[0]?.id || '');

  // Keep synced with external selection
  useEffect(() => {
    if (selectedPaperId) setActivePaperId(selectedPaperId);
  }, [selectedPaperId]);

  // Design Settings
  const [theme, setTheme] = useState<'swiss' | 'shield' | 'neon' | 'vintage'>('swiss');
  const [colorAccent, setColorAccent] = useState<string>('#10b981'); // Emerald default
  const [gradientBg, setGradientBg] = useState<string>('from-slate-950 via-slate-900 to-[#0A0F0D]');
  const [includeDisclaimers, setIncludeDisclaimers] = useState<boolean>(true);
  const [customHeading, setCustomHeading] = useState<string>('');
  const [customBadgeLabel, setCustomBadgeLabel] = useState<string>('ISO 17025 VERIFIED');

  // Feedback states
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);
  const [downloadFeedback, setDownloadFeedback] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // AI content generation state
  const [aiHeadline, setAiHeadline] = useState<string>('');
  const [aiBody, setAiBody] = useState<string>('');
  const [aiCTA, setAiCTA] = useState<string>('');
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [aiGenerated, setAiGenerated] = useState<boolean>(false);

  const svgRef = useRef<SVGSVGElement>(null);

  const handleGenerateAIContent = async () => {
    if (!activePaper || isGeneratingAI) return;
    setIsGeneratingAI(true);
    try {
      const response = await authFetch('/api/ollama/flyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper: activePaper }),
      });
      if (response.ok) {
        const data = await response.json();
        setAiHeadline(data.headline || '');
        setAiBody(data.body || '');
        setAiCTA(data.callToAction || '');
        setAiGenerated(true);
        setCustomHeading(data.headline || '');
      }
    } catch (err) {
      console.error("AI flyer generation failed:", err);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Active paper resolution
  const activePaper = useMemo(() => {
    return papers.find(p => p.id === activePaperId) || papers[0] || null;
  }, [papers, activePaperId]);

  // Pre-calculate wrapped text to keep JSX clean
  const titleLines = useMemo(() => {
    const titleToDraw = customHeading || activePaper?.title || "SYNERGISTIC ASSAY REPORT";
    return wrapText(titleToDraw.toUpperCase(), 21, 3);
  }, [customHeading, activePaper?.title]);

  const outcomeLines = useMemo(() => {
    const desc = aiBody || activePaper?.outcomes || "No empirical outcomes recorded for this sample.";
    return wrapText(desc, 46, 3);
  }, [aiBody, activePaper?.outcomes]);

  const handleCopyClipboard = async () => {
    if (!navigator.clipboard || !activePaper) return;
    
    try {
      await navigator.clipboard.writeText(`[RESEARCH CREDENTIAL BRIEF]
------------------------------------------------------
TITLE: ${customHeading || activePaper.title}
CITATION: ${activePaper.journal || 'Internal'} (${activePaper.year || new Date().getFullYear()})
TARGET PATHWAYS: ${activePaper.compounds?.join(' + ') || 'N/A'}
REGULATORY STATUS: ${customBadgeLabel}

Verify full HPLC chromatograms and ALCOA++ audit trails on HempForge.
#EntourageSynergy #HempForgeScience #CannabinoidResearch`);
      
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  // Upgraded to export a real 1080x1080 Social Media PNG
  const handleDownloadImage = () => {
    if (!svgRef.current || isExporting) return;
    setIsExporting(true);

    try {
      const svgElement = svgRef.current;
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const canvas = document.createElement("canvas");
      
      // Standard high-res social media size (1080x1080)
      const EXPORT_SIZE = 1080;
      canvas.width = EXPORT_SIZE;
      canvas.height = EXPORT_SIZE;
      
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get 2d context");

      const img = new Image();
      // Use btoa and encodeURIComponent to safely handle SVG special characters
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));

      img.onload = () => {
        ctx.drawImage(img, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
        const pngFile = canvas.toDataURL("image/png");
        
        const link = document.createElement("a");
        link.download = `hempforge_research_${theme}.png`;
        link.href = pngFile;
        link.click();
        
        setDownloadFeedback(true);
        setTimeout(() => setDownloadFeedback(false), 2000);
        setIsExporting(false);
      };
      
      img.onerror = () => setIsExporting(false);
    } catch (error) {
      console.error("Export failed", error);
      setIsExporting(false);
    }
  };

  if (!papers.length) {
    return (
      <div className="bg-[#0D1411] border border-white/10 p-6 text-center text-white/50 text-sm font-mono">
        No verified research documents available for export.
      </div>
    );
  }

  return (
    <div className="bg-[#0D1411] border border-white/10 p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
            <ImageIcon size={16} />
            Social Media Graphic Export
          </h3>
          <p className="text-xs text-white/50 mt-1">
            Generate verifiable, high-resolution credential infographics for LinkedIn and Instagram.
          </p>
        </div>
        
        <div className="flex gap-2">
          <select
            value={activePaperId}
            onChange={(e) => setActivePaperId(e.target.value)}
            className="bg-[#1A221E] border border-white/10 px-3 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-emerald-500 rounded-none cursor-pointer"
          >
            {papers.map(p => (
              <option key={p.id} value={p.id}>{p.title || p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* DESIGN PANEL CONTROLS - 5 Cols */}
        <div className="lg:col-span-5 space-y-5">
          
          <div className="bg-[#1A221E] p-4 border border-white/5 space-y-4">
            <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
              <Palette size={13} /> Layout Architecture
            </h4>

            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'swiss', label: 'Swiss Clean', bg: 'from-slate-950 via-slate-900 to-[#0A0F0D]' },
                { id: 'shield', label: 'Audit Shield', bg: 'from-emerald-950 via-[#0D1411] to-slate-950' },
                { id: 'neon', label: 'Synth Neon', bg: 'from-purple-950 via-[#0A0F0D] to-[#010604]' },
                { id: 'vintage', label: 'Archival', bg: 'from-amber-950/20 via-[#1A1E1C] to-[#0A0F0D]' }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id as any);
                    setGradientBg(t.bg);
                  }}
                  className={`p-3 font-mono text-[10px] uppercase border text-center transition-all ${
                    theme === t.id 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40' 
                      : 'bg-transparent text-slate-400 border-white/5 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#1A221E] p-4 border border-white/5 space-y-4">
            <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
              <Sliders size={13} /> Context Overrides
            </h4>

            <div className="space-y-2 font-mono text-[10px]">
              <label className="text-white/50 block uppercase">Brand Hex Accent</label>
              <div className="flex gap-2">
                <input 
                  type="color" 
                  value={colorAccent} 
                  onChange={e => setColorAccent(e.target.value)} 
                  className="w-10 h-8 bg-transparent cursor-pointer border border-white/10"
                />
                <input 
                  type="text" 
                  value={colorAccent} 
                  onChange={e => setColorAccent(e.target.value)}
                  className="bg-[#0A0F0D] text-emerald-400 border border-white/10 px-2 text-xs flex-1 focus:outline-none uppercase"
                />
              </div>
            </div>

            <button
              onClick={handleGenerateAIContent}
              disabled={isGeneratingAI || !activePaper}
              className={`w-full flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-widest py-2.5 border transition-all ${
                isGeneratingAI
                  ? 'bg-purple-500/10 border-purple-500/30 text-purple-300 cursor-wait'
                  : aiGenerated
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-[#1A221E] border-white/10 text-slate-300 hover:bg-purple-500/10 hover:border-purple-500/30 hover:text-purple-300'
              }`}
            >
              {isGeneratingAI ? (
                <><Loader2 size={12} className="animate-spin" /> Generating via Ollama...</>
              ) : aiGenerated ? (
                <><Check size={12} /> AI Content Loaded</>
              ) : (
                <><Cpu size={12} /> AI Generate Headline</>
              )}
            </button>

            <div className="space-y-2 font-mono text-[10px]">
              <label className="text-white/50 block uppercase">Headline Override</label>
              <input 
                type="text" 
                value={customHeading} 
                onChange={e => setCustomHeading(e.target.value)}
                placeholder="Leave blank for base title"
                className="w-full bg-[#0A0F0D] border border-white/10 p-2 text-xs text-white focus:outline-none focus:border-emerald-500 placeholder-white/20"
              />
            </div>

            <div className="space-y-2 font-mono text-[10px]">
              <label className="text-white/50 block uppercase">Verification Stamp</label>
              <input 
                type="text" 
                value={customBadgeLabel} 
                onChange={e => setCustomBadgeLabel(e.target.value)}
                placeholder="e.g. ISO 17025 VERIFIED"
                className="w-full bg-[#0A0F0D] border border-white/10 p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input 
                type="checkbox" 
                id="disclaim-check"
                checked={includeDisclaimers} 
                onChange={e => setIncludeDisclaimers(e.target.checked)}
                className="accent-emerald-500 cursor-pointer"
              />
              <label htmlFor="disclaim-check" className="text-[10px] font-mono text-slate-300 uppercase select-none cursor-pointer">
                Render Protocol Footnotes
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopyClipboard}
              className="bg-[#121915] hover:bg-emerald-500/10 border border-white/10 hover:border-emerald-500/30 text-emerald-400 font-mono text-xs uppercase tracking-widest py-3 flex items-center justify-center gap-1.5 transition-colors"
            >
              {copyFeedback ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Social Text</>}
            </button>
            <button
              onClick={handleDownloadImage}
              disabled={isExporting}
              className={`${isExporting ? 'bg-emerald-700 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-400'} text-[#0A0F0D] font-mono text-xs font-bold uppercase tracking-widest py-3 flex items-center justify-center gap-1.5 transition-all`}
            >
              {downloadFeedback ? <><CheckCircle2 size={14} /> Saved!</> : <><Download size={14} /> Export PNG</>}
            </button>
          </div>
        </div>

        {/* 1:1 SOCIAL INFOGRAPHIC SIMULATOR SCREEN - 7 Cols */}
        <div className="lg:col-span-7 flex flex-col justify-center items-center bg-[#070B09] border border-white/5 p-4 rounded-none min-h-[460px] relative overflow-hidden">
          <div className="absolute top-3 left-3 flex items-center gap-1">
            <Eye size={10} className="text-emerald-500" />
            <span className="text-[8px] font-mono text-white/30 uppercase tracking-widest">1:1 HIGH-RES CANVAS</span>
          </div>

          <div className="w-full max-w-[340px] aspect-square shadow-2xl overflow-hidden relative border border-white/10">
            <svg 
              ref={svgRef}
              viewBox="0 0 300 300" 
              className={`w-full h-full bg-gradient-to-b ${gradientBg}`}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Outer Decorative Tech Lines */}
              {theme === 'shield' && (
                <>
                  <rect x="8" y="8" width="284" height="284" fill="none" stroke={colorAccent} strokeWidth="1" strokeOpacity="0.3" />
                  <rect x="12" y="12" width="276" height="276" fill="none" stroke={colorAccent} strokeWidth="1.5" strokeOpacity="0.8" />
                  <line x1="12" y1="24" x2="12" y2="12" stroke={colorAccent} strokeWidth="3" />
                  <line x1="12" y1="12" x2="24" y2="12" stroke={colorAccent} strokeWidth="3" />
                  <line x1="288" y1="24" x2="288" y2="12" stroke={colorAccent} strokeWidth="3" />
                  <line x1="288" y1="12" x2="276" y2="12" stroke={colorAccent} strokeWidth="3" />
                </>
              )}

              {theme === 'swiss' && (
                <>
                  <line x1="15" y1="0" x2="15" y2="300" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                  <line x1="150" y1="0" x2="150" y2="300" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                  <line x1="285" y1="0" x2="285" y2="300" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                  <line x1="0" y1="40" x2="300" y2="40" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                  <line x1="0" y1="240" x2="300" y2="240" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                </>
              )}

              <g transform="translate(16, 28)">
                <circle cx="6" cy="6" r="4" fill={colorAccent} />
                <text x="14" y="9" fill="white" fontSize="6.5" fontFamily="monospace" fontWeight="bold" letterSpacing="1">
                  HEMPFORGE VERIFIED RESEARCH
                </text>
              </g>

              <g transform="translate(230, 18)">
                <rect x="0" y="0" width="54" height="11" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="0.5" />
                <text x="27" y="7.5" fill="#10b981" fontSize="4.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                  {customBadgeLabel}
                </text>
              </g>

              <g transform="translate(20, 65)">
                {titleLines.map((ln, idx) => (
                  <text 
                    key={idx} 
                    x="0" 
                    y={idx * 16} 
                    fill="white" 
                    fontSize={idx === 0 ? "13" : "11"} 
                    fontFamily={theme === 'swiss' ? "Helvetica, Arial, sans-serif" : "Courier, monospace"} 
                    fontWeight="bold" 
                    letterSpacing="-0.3"
                  >
                    {ln}
                  </text>
                ))}
              </g>

              <g transform="translate(20, 130)">
                <text x="0" y="0" fill={colorAccent} fontSize="5" fontFamily="monospace" fontWeight="bold" letterSpacing="1">
                  ISOLATED ENTOMOLOGICAL TARGETS
                </text>
                {activePaper?.compounds?.slice(0,4).map((comp, i) => (
                  <g key={i} transform={`translate(${i * 54}, 8)`}>
                    <rect x="0" y="0" width="48" height="15" rx="2" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                    <text x="24" y="10" fill="#E2E8F0" fontSize="6.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                      {comp}
                    </text>
                  </g>
                ))}
              </g>

              <g transform="translate(20, 175)">
                <rect x="0" y="0" width="260" height="52" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <line x1="0" y1="0" x2="3" y2="0" stroke={colorAccent} strokeWidth="3" />
                <line x1="0" y1="0" x2="0" y2="12" stroke={colorAccent} strokeWidth="3" />

                <text x="10" y="14" fill={colorAccent} fontSize="5" fontFamily="monospace" fontWeight="bold" letterSpacing="0.8">
                  COMPLIANCE / VERIFIED CITATION
                </text>
                
                {outcomeLines.map((ln, idx) => (
                  <text key={idx} x="10" y={25 + idx * 8} fill="rgba(255,255,255,0.85)" fontSize="6" fontFamily="sans-serif">
                    • {ln}
                  </text>
                ))}
              </g>

              <g transform="translate(20, 256)">
                <text x="0" y="-12" fill="rgba(255,255,255,0.5)" fontSize="5" fontFamily="monospace">
                  Published In: {activePaper?.journal || 'Internal Verification'}
                </text>
                <text x="0" y="-4" fill="rgba(255,255,255,0.4)" fontSize="4.5" fontFamily="sans-serif">
                  Authors: {activePaper?.authors || 'System Auditor'}
                </text>

                {includeDisclaimers && (
                  <text x="0" y="10" fill="rgba(16,185,129,0.5)" fontSize="4" fontFamily="sans-serif" fontStyle="italic">
                    *Verification parameters conform to USDA Final Rule protocols. ALCOA++ secured.
                  </text>
                )}
              </g>
            </svg>
          </div>

          <div className="mt-4 p-3 bg-white/5 border border-white/5 text-center font-mono text-[10px] text-slate-400 max-w-[340px] leading-relaxed">
            <Sparkles size={11} className="inline text-amber-400 mr-1.5 align-middle" />
            Rendering 1080x1080px export. Ideal for LinkedIn & laboratory social feeds.
          </div>
        </div>
      </div>
    </div>
  );
}
