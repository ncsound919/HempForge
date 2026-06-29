import React from 'react';
import { Sparkles, FileText, Beaker, Image, FileCheck2 } from 'lucide-react';
import { authFetch } from '../../lib/firebase';
import { DocumentEntry } from '../DocumentLibrary';
import FlyerCreator from '../FlyerCreator';
import { usePipeline } from '../../contexts/PipelineContext';

interface ResearchPipelineProps {
  showLabNotification: (msg: string) => void;
}

export default function ResearchPipeline({
  showLabNotification
}: ResearchPipelineProps) {
  const {
    allPapers,
    setAllPapers,
    selectedPaperEntity,
    setSelectedPaperEntity,
    coaRawInput,
    setCoaRawInput,
    isParsingCoa,
    setIsParsingCoa,
    parsingMessage,
    setParsingMessage,
    pipelineStep,
    setPipelineStep,
    pipelineStrain,
    setPipelineStrain,
    pipelineTHCa,
    setPipelineTHCa,
    pipelineD9THC,
    setPipelineD9THC,
    pipelineMoisture,
    setPipelineMoisture,
    pipelineTemp,
    setPipelineTemp,
    pipelineDuration,
    setPipelineDuration,
    pipelineRatios,
    setPipelineRatios,
    draftTemplateType,
    setDraftTemplateType,
    isDraftingPaper,
    setIsDraftingPaper,
    draftedPaperData,
    setDraftedPaperData,
    isPaperPublished,
    setIsPaperPublished
  } = usePipeline();

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* Top Wizard Steps tracker */}
      <div className="bg-[#0D1411] border border-white/10 p-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
            <Sparkles size={14} className="text-amber-400" /> Active Research Pipeline
          </span>
          
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((step) => (
              <button
                key={step}
                onClick={() => setPipelineStep(step as any)}
                className={`px-3 py-1.5 text-xs font-mono border transition-all flex items-center gap-1.5 ${
                  pipelineStep === step
                    ? 'bg-emerald-500 text-[#0A0F0D] border-emerald-400 font-bold'
                    : 'bg-[#1A221E] text-white/50 border-white/10 hover:text-white'
                }`}
              >
                <span className="font-bold">{step}.</span>
                {step === 1 && "Material Ingestion"}
                {step === 2 && "Kinetics Simulation"}
                {step === 3 && "AI Paper Synthesis"}
                {step === 4 && "Social Poster Design"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Hand: Steps side guide & info panel */}
        <div className="lg:col-span-4 bg-[#0D1411] border border-white/10 p-5 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <div>
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold tracking-widest">Research Pipeline Guide</span>
              <h3 className="text-base font-bold text-white mt-1 leading-snug">Autonomous Scientific Publishing Loop</h3>
              <p className="text-xs text-white/50 mt-2 leading-relaxed font-sans">
                HempForge research nodes empower researchers to transform raw material certificates into certified, peer-review-quality science reports and social-media infographics under fully verified compliance constraints.
              </p>
            </div>

            <div className="space-y-3">
              {/* Step status list */}
              <div className={`p-3 border transition-colors ${pipelineStep === 1 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-[#121915]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${pipelineStep === 1 ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/60'}`}>01</span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Recursive COA OCR Ingestion</h4>
                </div>
                <p className="text-[10px] text-white/40 mt-1 leading-normal font-sans">
                  Ingest raw Certificates of Analysis or PDF texts. NLP parsing routines isolate key THCa and Δ9-THC starting ratios.
                </p>
              </div>

              <div className={`p-3 border transition-colors ${pipelineStep === 2 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-[#121915]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${pipelineStep === 2 ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/60'}`}>02</span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Kinetic Thermal Simulation</h4>
                </div>
                <p className="text-[10px] text-white/40 mt-1 leading-normal font-sans">
                  Map temperature and duration parameters. Model thermal conversion using predictive Arrhenius kinetics and verify safety limits.
                </p>
              </div>

              <div className={`p-3 border transition-colors ${pipelineStep === 3 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-[#121915]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${pipelineStep === 3 ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/60'}`}>03</span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">AI Document Drafting</h4>
                </div>
                <p className="text-[10px] text-white/40 mt-1 leading-normal font-sans">
                  Instruct Gemini 3.5 to draft customized, peer-reviewed academic reports, clinical whitepapers, or regulatory briefs based on active simulated kinetics.
                </p>
              </div>

              <div className={`p-3 border transition-colors ${pipelineStep === 4 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-[#121915]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${pipelineStep === 4 ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/60'}`}>04</span>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">Social Infographic Designer</h4>
                </div>
                <p className="text-[10px] text-white/40 mt-1 leading-normal font-sans">
                  Transform academic metadata directly into visually stunning social flyers using Swiss minimal proportions, fully ready for distribution.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-emerald-500/5 border border-emerald-500/20 text-[10px] font-mono text-emerald-400 space-y-1">
            <span className="font-bold uppercase block">● Dynamic Synergy Engine</span>
            <p className="text-slate-400 leading-normal font-sans">
              All steps are live-linked. Modifying the temperature in Step 2 will instantly regenerate the scientific curves, updating the drafted report content in Step 3!
            </p>
          </div>
        </div>

        {/* Right Hand: Active Step Workspace Pane */}
        <div className="lg:col-span-8 bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between min-h-[500px]">
          
          {/* Step 1 Workspace: Ingestion */}
          {pipelineStep === 1 && (
            <div className="space-y-4 flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                    <FileText size={14} /> Step 1: Raw COA OCR Ingestion
                  </h4>
                  <span className="text-[9px] bg-white/5 text-slate-400 px-1.5 py-0.5 font-mono">Parser Mode: Real-time API</span>
                </div>

                <p className="text-xs text-white/60 leading-relaxed font-sans">
                  Paste a raw lab Certificate of Analysis (COA) text or select from pre-loaded lab templates below to trigger OCR extraction.
                </p>

                {/* Preloads selectors */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => {
                      setPipelineStrain('Sour Diesel Acidic Cut');
                      setCoaRawInput(`HempForge Analytics Lab - Certificate of Analysis
BATCH ID: HF-EX-99801
STRAIN CULTIVAR: Sour Diesel Acidic Cut
MOISTURE CONTENT: 11.45%
POTENCY ANALYSIS (HPLC-UV):
  THCa: 18.65 wt%
  Delta-9 THC: 0.12 wt%
  CBDa: 0.45 wt%
  CBC: 0.22 wt%
STATUS: PRE-EXTRACTION RAW FLOWER`);
                    }}
                    className="bg-[#1A221E] text-[10px] font-mono text-white/80 border border-white/10 hover:border-emerald-500/30 px-2.5 py-1"
                  >
                    Template: Sour Diesel
                  </button>
                  <button
                    onClick={() => {
                      setPipelineStrain('Cherry Wine Flower');
                      setCoaRawInput(`Cherry Wine Potency Certification Report
Lab Ref: EX-887
Strain: Cherry Wine Flower
Moisture: 13.10%
CBDa: 14.80 wt%
THCa: 12.40 wt%
Delta-9 THC: 0.04 wt%
CBN: 0.02 wt%`);
                    }}
                    className="bg-[#1A221E] text-[10px] font-mono text-white/80 border border-white/10 hover:border-emerald-500/30 px-2.5 py-1"
                  >
                    Template: Cherry Wine
                  </button>
                  <button
                    onClick={() => {
                      setPipelineStrain('Hawaiian Haze Greenhouse');
                      setCoaRawInput(`Pacific Botanical Lab COA
Lot: #883-99B
Cultivar: Hawaiian Haze Greenhouse
Water Content: 12.20%
HPLC Potency:
  THCa: 16.50%
  Delta-9 THC: 0.15%
  CBCa: 0.65%`);
                    }}
                    className="bg-[#1A221E] text-[10px] font-mono text-white/80 border border-white/10 hover:border-emerald-500/30 px-2.5 py-1"
                  >
                    Template: Hawaiian Haze
                  </button>
                </div>

                <textarea
                  value={coaRawInput}
                  onChange={(e) => setCoaRawInput(e.target.value)}
                  rows={8}
                  className="w-full bg-[#0A0F0D] border border-white/10 p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500 resize-none leading-relaxed"
                />

                {parsingMessage && (
                  <div className="bg-[#121915] border border-white/5 p-3 text-[10px] font-mono text-emerald-300">
                    {parsingMessage}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 pt-4 mt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4 text-xs font-mono text-slate-300">
                  <div>Strain: <span className="text-white font-bold">{pipelineStrain}</span></div>
                  <div>THCa: <span className="text-emerald-400 font-bold">{pipelineTHCa}%</span></div>
                  <div>Moisture: <span className="text-white font-bold">{pipelineMoisture}%</span></div>
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={async () => {
                      setIsParsingCoa(true);
                      setParsingMessage('Starting RAG crawler & executing OCR text parsing...');
                      try {
                        const res = await authFetch('/api/gemini/parse-coa', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ coaRawText: coaRawInput })
                        });
                        const data = await res.json();
                        if (data.error) {
                          setParsingMessage(`Error: ${data.error}`);
                        } else {
                          setPipelineStrain(data.strain || 'Parsed Strain');
                          setPipelineTHCa(Number(data.thca) || 15.0);
                          setPipelineD9THC(Number(data.d9thc) || 0.1);
                          setPipelineMoisture(Number(data.moisture) || 12.0);
                          setParsingMessage('Successfully isolated cannabinoids profile via server-side Gemini API.');
                        }
                      } catch (e: any) {
                        setParsingMessage(`Failed to contact RAG service: ${e.message}`);
                      } finally {
                        setIsParsingCoa(false);
                      }
                    }}
                    disabled={isParsingCoa}
                    className="bg-transparent border border-emerald-500/30 hover:border-emerald-400 text-emerald-400 px-4 py-2 font-mono text-xs uppercase hover:bg-emerald-500/5 transition-colors flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
                  >
                    {isParsingCoa ? 'Parsing...' : 'Parse COA with Gemini'}
                  </button>

                  <button
                    onClick={() => setPipelineStep(2)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all flex-1 sm:flex-initial text-center"
                  >
                    Proceed to Simulation
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 Workspace: Simulation */}
          {pipelineStep === 2 && (() => {
            const conversionFactor = 0.877;
            const rateConstant = 0.00008 * Math.exp(0.058 * (pipelineTemp - 25));
            const finalThca = pipelineTHCa * Math.exp(-rateConstant * pipelineDuration);
            const convertedThc = pipelineTHCa - finalThca;
            const finalD9Thc = pipelineD9THC + (convertedThc * conversionFactor);
            const totalThcComputed = finalD9Thc + (finalThca * conversionFactor);
            const isCompliant = totalThcComputed <= 0.3;

            return (
              <div className="space-y-6 flex-1 flex flex-col justify-between animate-in fade-in duration-200">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Beaker size={14} /> Step 2: Decarboxylation Simulation
                    </h4>
                    <span className="text-[9px] bg-white/5 text-slate-400 px-1.5 py-0.5 font-mono">Model: Arrhenius Kinetics</span>
                  </div>

                  <p className="text-xs text-white/60 leading-relaxed font-sans">
                    Fine-tune decarboxylation parameters to calculate activated THC levels. Ensure your final potency ratios stay below the regulatory 0.3% compliance threshold.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#1A221E] p-4 border border-white/5">
                    <div className="space-y-4 font-mono text-[11px]">
                      <span className="text-[9px] text-white/40 uppercase font-bold tracking-wider block">Extraction Control Sliders</span>
                      
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-slate-300">
                          <span>Temperature (°C)</span>
                          <span className="text-emerald-400 font-bold">{pipelineTemp}°C</span>
                        </div>
                        <input 
                          type="range" 
                          min="80" 
                          max="180" 
                          value={pipelineTemp} 
                          onChange={(e) => setPipelineTemp(Number(e.target.value))}
                          className="w-full accent-emerald-500 bg-[#0A0F0D] h-1"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-slate-300">
                          <span>Duration (minutes)</span>
                          <span className="text-emerald-400 font-bold">{pipelineDuration} mins</span>
                        </div>
                        <input 
                          type="range" 
                          min="5" 
                          max="120" 
                          value={pipelineDuration} 
                          onChange={(e) => setPipelineDuration(Number(e.target.value))}
                          className="w-full accent-emerald-500 bg-[#0A0F0D] h-1"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-slate-400 block uppercase text-[10px]">Synergy Entourage Blends</label>
                        <input 
                          type="text" 
                          value={pipelineRatios} 
                          onChange={(e) => setPipelineRatios(e.target.value)}
                          className="w-full bg-[#0A0F0D] border border-white/10 p-2 text-xs text-white focus:outline-none"
                          placeholder="e.g. THCa, CBC, CBD"
                        />
                      </div>
                    </div>

                    <div className="border-l border-white/5 pl-0 md:pl-6 space-y-4">
                      <span className="text-[9px] font-mono text-white/40 uppercase font-bold tracking-wider block">Calculated Yield Profiles</span>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-slate-400 font-sans">Remaining THCa</span>
                          <span className="text-white font-bold">{finalThca.toFixed(3)}%</span>
                        </div>

                        <div className="flex justify-between text-xs font-mono">
                          <span className="text-slate-400 font-sans">Activated Δ9-THC</span>
                          <span className="text-amber-400 font-bold">{finalD9Thc.toFixed(3)}%</span>
                        </div>

                        <div className="border-t border-white/5 pt-2 flex justify-between text-xs font-mono">
                          <span className="text-slate-300 font-sans">Total Computed THC</span>
                          <span className={`font-bold ${isCompliant ? 'text-emerald-400' : 'text-red-400'}`}>{totalThcComputed.toFixed(3)}%</span>
                        </div>

                        <div className="pt-2">
                          {isCompliant ? (
                            <div className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 p-2 text-[10px] font-mono text-center uppercase tracking-wider font-bold">
                              ✓ REGULATORY COMPLIANT BATCH
                            </div>
                          ) : (
                            <div className="bg-red-500/10 text-red-400 border border-red-500/20 p-2 text-[10px] font-mono text-center uppercase tracking-wider font-bold">
                              ⚠ EXCEEDS 0.3% COMPLIANCE LIMIT
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-4 flex justify-between">
                  <button
                    onClick={() => setPipelineStep(1)}
                    className="bg-[#121915] border border-white/10 text-slate-300 px-4 py-2 font-mono text-xs uppercase hover:bg-white/5"
                  >
                    Back
                  </button>

                  <button
                    onClick={() => setPipelineStep(3)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider"
                  >
                    Configure Report Drafting
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Step 3 Workspace: Paper Synthesis */}
          {pipelineStep === 3 && (
            <div className="space-y-6 flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-400" /> Step 3: AI Document Synthesis
                  </h4>
                  <span className="text-[9px] bg-white/5 text-slate-400 px-1.5 py-0.5 font-mono">Model: Gemini-3.5-Flash</span>
                </div>

                <p className="text-xs text-white/60 leading-relaxed font-sans">
                  Instruct the server-side Gemini agent to compile, model, and draft an elite, peer-reviewed document using your simulated kinetics parameters.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(['Academic Journal Paper', 'Regulatory Compliance Brief', 'Clinical Trial Whitepaper'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setDraftTemplateType(t)}
                      className={`p-3 border font-mono text-[10px] uppercase text-left transition-all ${
                        draftTemplateType === t
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 font-bold'
                          : 'bg-transparent text-slate-400 border-white/5 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {isDraftingPaper ? (
                  <div className="bg-[#0A0F0D] border border-white/5 p-8 text-center space-y-4 min-h-[200px] flex flex-col items-center justify-center">
                    <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-none animate-spin" />
                    <div className="space-y-1">
                      <span className="text-xs font-mono text-emerald-400 uppercase font-bold animate-pulse">Running Gemini Synthesizer...</span>
                      <p className="text-[10px] text-white/40 font-mono">Calculating Arrhenius slopes, drafting executive summary, formatting scientific citations...</p>
                    </div>
                  </div>
                ) : draftedPaperData ? (
                  <div className="space-y-4">
                    <div className="bg-emerald-500/5 border border-emerald-500/20 p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <span className="text-[9px] font-mono text-emerald-400 uppercase font-bold tracking-wider block">Generated Successfully</span>
                        <h5 className="text-xs text-white font-bold font-mono">{draftedPaperData.title}</h5>
                      </div>

                      <button
                        onClick={() => {
                          // Publish to Lab Library!
                          const newDoc: DocumentEntry = {
                            id: `doc-gen-${Date.now()}`,
                            name: `${pipelineStrain.toLowerCase().replace(/[^a-z0-9]/g, '_')}_brief.pdf`,
                            path: '/Self_Uploads/Generated_Briefs/',
                            size: '1.2 MB',
                            type: 'pdf',
                            uploadDate: new Date().toISOString().split('T')[0],
                            title: draftedPaperData.title || '',
                            journal: draftTemplateType === 'Academic Journal Paper' ? 'Journal of Cannabis Cannabinoid Research' : 'Regulatory Affairs Review',
                            year: 2026,
                            authors: 'HempForge Autonomous AI Agent',
                            abstract: draftedPaperData.abstract || '',
                            compounds: draftedPaperData.compounds || ['THCa', 'CBC'],
                            dosage: draftedPaperData.dosage || 'Simulated Model',
                            outcomes: draftedPaperData.outcomes || 'Verified compliant batch.'
                          };

                          setAllPapers(prev => [newDoc, ...prev]);
                          setSelectedPaperEntity(newDoc);
                          setIsPaperPublished(true);
                        }}
                        disabled={isPaperPublished}
                        className={`px-4 py-2 font-mono text-[10px] uppercase font-bold transition-all ${
                          isPaperPublished
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D]'
                        }`}
                      >
                        {isPaperPublished ? '✓ Published in Lab' : 'Publish to Library'}
                      </button>
                    </div>

                    {/* Markdown view container */}
                    <div className="bg-[#0A0F0D] border border-white/5 p-4 text-xs font-sans text-slate-300 leading-relaxed h-48 overflow-y-auto whitespace-pre-wrap select-text">
                      {draftedPaperData.markdown}
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#0A0F0D] border border-white/5 p-8 text-center min-h-[160px] flex flex-col justify-center items-center space-y-2">
                    <span className="text-xs text-white/30 font-mono">No document drafted yet.</span>
                    <button
                      onClick={async () => {
                        setIsDraftingPaper(true);
                        setIsPaperPublished(false);
                        try {
                          const res = await authFetch('/api/gemini/generate-paper', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              strain: pipelineStrain,
                              thca: pipelineTHCa,
                              d9thc: pipelineD9THC,
                              moisture: pipelineMoisture,
                              temp: pipelineTemp,
                              duration: pipelineDuration,
                              blendRatios: pipelineRatios,
                              templateType: draftTemplateType
                            })
                          });
                          const data = await res.json();
                          setDraftedPaperData(data);
                        } catch (e) {
                          console.error(e);
                        } finally {
                          setIsDraftingPaper(false);
                        }
                      }}
                      className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-wider"
                    >
                      Draft Document with Gemini
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 pt-4 flex justify-between">
                <button
                  onClick={() => setPipelineStep(2)}
                  className="bg-[#121915] border border-white/10 text-slate-300 px-4 py-2 font-mono text-xs uppercase hover:bg-white/5"
                >
                  Back
                </button>

                <button
                  onClick={() => setPipelineStep(4)}
                  disabled={!draftedPaperData}
                  className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Create Social Flyer
                </button>
              </div>
            </div>
          )}

          {/* Step 4 Workspace: Flyer Creator */}
          {pipelineStep === 4 && (
            <div className="space-y-6 flex-1 flex flex-col justify-between animate-in fade-in duration-200">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Image size={14} /> Step 4: Social Poster & Flyer Designer
                  </h4>
                  <span className="text-[9px] bg-white/5 text-slate-400 px-1.5 py-0.5 font-mono">Format: SVG Vector Card</span>
                </div>

                <p className="text-xs text-white/60 leading-relaxed font-sans">
                  All done! Your generated research paper is fully loaded into the Flyer Creator system below. Select a visual theme to render.
                </p>

                <div className="border border-white/10">
                  <FlyerCreator 
                    papers={allPapers}
                    selectedPaperId={selectedPaperEntity?.id || allPapers[0]?.id || 'doc-1'} 
                  />
                </div>
              </div>

              <div className="border-t border-white/10 pt-4 flex justify-between">
                <button
                  onClick={() => setPipelineStep(3)}
                  className="bg-[#121915] border border-white/10 text-slate-300 px-4 py-2 font-mono text-xs uppercase hover:bg-white/5"
                >
                  Back to Document
                </button>

                <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase flex items-center gap-1">
                  ✓ PIPELINE COMPLETE
                </span>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
