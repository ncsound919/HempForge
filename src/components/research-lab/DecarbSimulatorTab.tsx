import React, { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { authFetch } from '../../lib/firebase';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { 
  Beaker, 
  Activity, 
  Award, 
  AlertTriangle, 
  Lightbulb, 
  Sliders, 
  CheckCircle2, 
  Thermometer, 
  Info, 
  ListOrdered, 
  Save, 
  Plus, 
  Trash, 
  BookOpen, 
  Sparkles, 
  GitCompare, 
  Play,
  Atom 
} from 'lucide-react';
import { DocumentEntry } from '../DocumentLibrary';

const LazySceneContainer = lazy(() => import('../3d/SceneContainer'));
const LazyMoleculeViewer = lazy(() => import('../3d/MoleculeViewer'));

// Kinetic model for Decarb Simulation
function calculateDecarbAtTime(thca0: number, thc0: number, tempC: number, min: number) {
  const baseRate = 0.00008;
  const k = baseRate * Math.exp(0.058 * (tempC - 25)); // 25C reference temperature 
  
  const thca = thca0 * Math.exp(-k * min);
  const conversionMultiplier = 0.877;
  const thcaConverted = thca0 - thca;
  const thc = thc0 + (thcaConverted * conversionMultiplier);
  const totalThc = thc + (thca * conversionMultiplier);

  return {
    time: min,
    thca: Math.max(0, thca),
    thc: Math.max(0, thc),
    totalThc: Math.max(0, totalThc)
  };
}

interface ExperimentalTrial {
  id: string;
  name: string;
  date: string;
  type: 'Decarb Optimization' | 'Atmospheric Stabilization' | 'Synergistic Blend Formulation';
  parameters: {
    temp?: number;
    duration?: number;
    humidity?: number;
    parentTHCa?: number;
    compoundRatio?: string;
  };
  results: {
    preservationRate?: number;
    finalDelta9THC?: number;
    synergyScore?: number;
    compliance: 'COMPLIANT' | 'OVERLIMIT';
  };
  status: 'highly_successful' | 'borderline_compliant' | 'unusable_outlier';
  notes: string;
}

import { usePipeline } from '../../contexts/PipelineContext';

interface DecarbSimulatorTabProps {
  allPapers: DocumentEntry[];
  showLabNotification: (msg: string) => void;
  onNavigateToTab?: (tab: string) => void;
}

export default function DecarbSimulatorTab({
  allPapers,
  showLabNotification,
  onNavigateToTab
}: DecarbSimulatorTabProps) {
  const { setPipelineStrain, setPipelineTHCa, setPipelineD9THC, setPipelineStep, setDraftTemplateType, setAllPapers, setSelectedPaperEntity } = usePipeline();

  // Simulator States
  const [initialTHCa, setInitialTHCa] = useState<number>(15.0);
  const [initialTHC, setInitialTHC] = useState<number>(0.15);
  const [temp, setTemp] = useState<number>(120);
  const [duration, setDuration] = useState<number>(60);
  
  // Curing operations states
  const [curingTemp, setCuringTemp] = useState<number>(20);
  const [curingHumidity, setCuringHumidity] = useState<number>(55);
  const [curingDays, setCuringDays] = useState<number>(14);

  // Selected paper for deep-dive & protocol builder
  const [selectedPaper, setSelectedPaper] = useState<string>('doc-1');
  const [generatedProtocol, setGeneratedProtocol] = useState<string | null>(null);

  // Formulation Blender states
  const [blendTHCa, setBlendTHCa] = useState<number>(8.0);
  const [blendCBC, setBlendCBC] = useState<number>(6.0);
  const [blendCBD, setBlendCBD] = useState<number>(12.0);
  const [blendCBG, setBlendCBG] = useState<number>(4.0);
  const [blendCarrier, setBlendCarrier] = useState<number>(70.0);

  // Swarm debate state
  const [isDebating, setIsDebating] = useState<boolean>(false);
  const [debateLog, setDebateLog] = useState<{agent: string, message: string, color: string}[]>([]);

  // Experimental Trials States (In-memory database simulation)
  const [trialList, setTrialList] = useState<ExperimentalTrial[]>([
    {
      id: 'trial-001',
      name: 'Batch EX-101 Thermal Slope',
      date: '2026-05-18',
      type: 'Decarb Optimization',
      parameters: {
        temp: 115,
        duration: 45,
        parentTHCa: 18.50
      },
      results: {
        finalDelta9THC: 11.20,
        compliance: 'OVERLIMIT'
      },
      status: 'unusable_outlier',
      notes: 'Exceeded short-path limits. Resulting distillate requires severe remedial formulation flow or dilution solvents.'
    },
    {
      id: 'trial-002',
      name: 'Slow Dry-Cure Preservation Benchmark',
      date: '2026-05-22',
      type: 'Atmospheric Stabilization',
      parameters: {
        temp: 15,
        humidity: 62,
        duration: 21
      },
      results: {
        preservationRate: 96.4,
        compliance: 'COMPLIANT'
      },
      status: 'highly_successful',
      notes: 'Highest retention matrix logged. Replicated published agricultural slow decay benchmarks nicely.'
    },
    {
      id: 'trial-003',
      name: 'Microglial Model Analogue Formulation #4',
      date: '2026-05-28',
      type: 'Synergistic Blend Formulation',
      parameters: {
        compoundRatio: '1.2:1 THCa:CBC blend'
      },
      results: {
        synergyScore: 89,
        compliance: 'COMPLIANT'
      },
      status: 'highly_successful',
      notes: 'Optimized TRPA1 receptor activation curve target with minimal trace degradation pathway trigger observed.'
    }
  ]);

  useEffect(() => {
    async function loadDbSimulations() {
      try {
        const res = await authFetch('/api/literature/simulations');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.simulations) && data.simulations.length > 0) {
            setTrialList(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const newSims = data.simulations.filter((s: any) => !existingIds.has(s.id));
              return [...newSims, ...prev];
            });
          }
        }
      } catch (err) {
        console.error("Error loading database simulations:", err);
      }
    }
    loadDbSimulations();
  }, []);

  const [newTrialName, setNewTrialName] = useState<string>('');
  const [newTrialType, setNewTrialType] = useState<'Decarb Optimization' | 'Atmospheric Stabilization' | 'Synergistic Blend Formulation'>('Decarb Optimization');
  const [newTrialNotes, setNewTrialNotes] = useState<string>('');

  // Decarb profile chart calculation over time
  const chartPoints = useMemo(() => {
    const points = [];
    const steps = 10;
    const interval = duration / steps;
    for (let i = 0; i <= steps; i++) {
      const t = Math.round(i * interval);
      const res = calculateDecarbAtTime(initialTHCa, initialTHC, temp, t);
      points.push({
        time: t,
        thca: res.thca,
        thc: res.thc,
        totalThc: res.totalThc
      });
    }
    return points;
  }, [initialTHCa, initialTHC, temp, duration]);

  // Final values at duration
  const finalResult = useMemo(() => {
    return calculateDecarbAtTime(initialTHCa, initialTHC, temp, duration);
  }, [initialTHCa, initialTHC, temp, duration]);

  // Normalized formulation blender math
  const blendTotals = useMemo(() => {
    const sum = blendTHCa + blendCBC + blendCBD + blendCBG + blendCarrier;
    const scale = sum > 0 ? 100 / sum : 1;
    const nTHCa = blendTHCa * scale;
    const nCBC = blendCBC * scale;
    const nCBD = blendCBD * scale;
    const nCBG = blendCBG * scale;
    const nCarrier = blendCarrier * scale;

    const potentialTHC = nTHCa * 0.877;
    const isCompliant = potentialTHC <= 0.30;

    const ratio = nTHCa > 0 ? nCBC / nTHCa : 0;
    const ratioDeviance = Math.abs(ratio - 1.0);
    const synergyScore = Math.max(10, Math.round(100 - (ratioDeviance * 45)));

    return {
      nTHCa,
      nCBC,
      nCBD,
      nCBG,
      nCarrier,
      potentialTHC,
      isCompliant,
      synergyScore
    };
  }, [blendTHCa, blendCBC, blendCBD, blendCBG, blendCarrier]);

  // Curing output prediction
  const curingForecast = useMemo(() => {
    const tempImpact = Math.max(0, (curingTemp - 15) * 0.15);
    const humidityImpact = Math.max(0, (62 - curingHumidity) * 0.18);
    const degradationTotal = Math.min(25, (tempImpact + humidityImpact) * (curingDays / 7));
    const finalPreservation = 100 - degradationTotal;
    
    let advice = "Optimal Curing Profile: Slow cure is safely preserving acidic cannabinoids.";
    let status: 'good' | 'warn' | 'crit' = 'good';
    if (finalPreservation < 91) {
      advice = "Warning: Ambient heat/dryness causing accelerated cannabinoid and terpene degradation. Lower curing room temperature.";
      status = 'warn';
    }
    if (finalPreservation < 81) {
      advice = "Critical Action: High degradation rate risk. Divert to flash freezing or verify humidity levels immediately to prevent biological dry-weight compliance outliers.";
      status = 'crit';
    }

    return {
      preservationRate: finalPreservation,
      degradedPercentage: degradationTotal,
      advice,
      status
    };
  }, [curingTemp, curingHumidity, curingDays]);

  // Handle R&D protocol generation based on literature
  const handleGenerateProtocol = (paperId: string) => {
    const paper = allPapers.find(p => p.id === paperId);
    if (!paper) return;

    const comps = Array.isArray(paper.compounds) ? paper.compounds : [];
    const dosageStr = paper.dosage || 'N/A';
    const outcomeStr = paper.outcomes || 'N/A';

    setGeneratedProtocol(`HEMPFORGE RESEARCH PROTOCOL : REF-RP-${paperId.toUpperCase()}
STATUS: WORKING DRAFT
TAGS: ${comps.join(' + ') || 'THCa + CBD'} | SYNERGY | IN-HOUSE FORMULATION

1. OBJECTIVE: 
Verify synergistic target endpoints published by ${paper.authors} (${paper.year}) utilizing active local inventory batches.

2. MATERIALS & RATIOS:
- Active Component A: Certified High-${comps[0] || 'THCa'} Distillate, Target Purity > 85.0%
- Active Component B: ${comps[1] || 'CBC'} Isolate (Ref: Vault A inventory), Target Purity > 98.0%
- Carrier: Refined Cold-Pressed Organic Hemp Seed Oil (USP Grade)
- Target Concentration Ratio: ${dosageStr}

3. PREPARATION METRICS:
- Vessel clean sweep, heated under nitrogen purge.
- Charge carrier fluid. Gradual thermal ramping to 45°C.
- Dissolve ${comps[1] || 'CBC'} isolate crystal matrix uniformly. 
- Blend ${comps[0] || 'THCa'} concentrate slowly under 200 RPM high-shear agitation for 18 minutes to prevent thermal decarboxylation. 

4. STABILITY METRICS:
- Run immediate HPLC potency pre-check to verify Total potential THC is ≤ 0.30% dry-weight equivalence to comply with Federal codes.
- Aliquot under glass canisters (amber, raw cork, nitrogen flamed headspace).
- Store at 12°C, 45% moisture barrier for 12-week stability assays.

5. PHARMACOLOGICAL OBSERVATIONS:
- Targeted in-house assays aligned for biomarkers. Outcomes reported in literature: "${outcomeStr}".`);
  };

  // Run swarm consensus simulation
  const handleRunDebate = () => {
    setIsDebating(true);
    setDebateLog([]);
    
    const steps = [
      {
        agent: 'Compliance Agent',
        message: 'Reviewing batch B-8803. Lab output lists 0.85% THCa and 0.08% Δ9-THC. Simple total calculation yields 0.825% Total THC. This exceeds the legal federal 0.3% dry weight limit. Immediate quarantine flagged.',
        color: 'text-red-400'
      },
      {
        agent: 'Chemistry Node',
        message: 'Warning: Standard deviation across the lab\'s GC-FID methodology has a 3σ uncertainty bounds of ±0.06% on acidic assays. Further, dry-weight calculation protocols must account for actual residual water moisture weight (currently recorded at a high 14.8%). We are borderline on standard moisture margins.',
        color: 'text-amber-400'
      },
      {
        agent: 'Cultivation & Ops Node',
        message: 'Looking at cultivation logs, this batch had a late harvest cycle (delayed by 8 days due to weather patterns under wet fog). The extended drying cycle accelerated natural cannabinoid conversion pathways. This confirms the elevated THCa ratio compared to the genetic average.',
        color: 'text-purple-400'
      },
      {
        agent: 'Master Summary Node',
        message: 'CONSENSUS RESOLUTION: The batch is legally non-compliant for raw-grain retail, but compliance margins are within processing remedy rules. Recommend: Divert the entire B-8803 cluster directly to liquid solvent extraction. The thermal processing column will isolate the cannabinoids and safely remediate/dilute compliance parameters.',
        color: 'text-emerald-400'
      }
    ];

    let current = 0;
    const interval = setInterval(() => {
      if (current < steps.length) {
        setDebateLog(prev => [...prev, steps[current]]);
        current++;
      } else {
        clearInterval(interval);
        setIsDebating(false);
      }
    }, 1200);
  };

  // Log a new trial to database
  const handleAddTrial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTrialName.trim()) return;

    let params: any = {};
    let results: any = {};
    let status: 'highly_successful' | 'borderline_compliant' | 'unusable_outlier' = 'highly_successful';

    if (newTrialType === 'Decarb Optimization') {
      params = { temp, duration, parentTHCa: initialTHCa };
      results = { 
        finalDelta9THC: finalResult.thc, 
        compliance: finalResult.thc <= 0.30 ? 'COMPLIANT' : 'OVERLIMIT' 
      };
      status = finalResult.thc > 0.30 ? 'unusable_outlier' : (finalResult.thc > 0.20 ? 'borderline_compliant' : 'highly_successful');
    } else if (newTrialType === 'Atmospheric Stabilization') {
      params = { temp: curingTemp, humidity: curingHumidity, duration: curingDays };
      results = { 
        preservationRate: curingForecast.preservationRate, 
        compliance: 'COMPLIANT' 
      };
      status = curingForecast.status === 'crit' ? 'unusable_outlier' : (curingForecast.status === 'warn' ? 'borderline_compliant' : 'highly_successful');
    } else {
      params = { compoundRatio: `${(blendTotals.nTHCa / (blendTotals.nCBC || 1)).toFixed(1)}:1 Ratio` };
      results = { 
        synergyScore: blendTotals.synergyScore, 
        compliance: blendTotals.isCompliant ? 'COMPLIANT' : 'OVERLIMIT' 
      };
      status = !blendTotals.isCompliant ? 'unusable_outlier' : (blendTotals.synergyScore > 75 ? 'highly_successful' : 'borderline_compliant');
    }

    const trial: ExperimentalTrial = {
      id: `trial-${Date.now().toString().slice(-4)}`,
      name: newTrialName,
      date: new Date().toISOString().split('T')[0],
      type: newTrialType,
      parameters: params,
      results,
      status,
      notes: newTrialNotes || 'No notes appended to experimental run.'
    };

    setTrialList(prev => [trial, ...prev]);
    setNewTrialName('');
    setNewTrialNotes('');
  };

  const handleDeleteTrial = (id: string) => {
    setTrialList(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 p-6">
      
      {/* Scientific Reference Foundation Header Board */}
      <div className="bg-[#0D1411] border border-white/10 p-5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-sm font-bold text-amber-400 font-mono uppercase tracking-widest flex items-center gap-2">
              <BookOpen size={16} /> Active Scientific Reference Foundation
            </h3>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              Link an ingested literature publication to calibrate experimental kinetic bounds, synergistic blending models, and drying chamber safety thresholds.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <select
              value={selectedPaper}
              onChange={(e) => {
                setSelectedPaper(e.target.value);
                setGeneratedProtocol(null);
              }}
              className="bg-[#1A221E] border border-white/10 text-white/80 p-2 font-mono text-xs focus:outline-none focus:border-emerald-500 w-full md:w-80"
            >
              {allPapers.map(paper => (
                <option key={paper.id} value={paper.id}>
                  {paper.title.length > 50 ? `${paper.title.slice(0, 50)}...` : paper.title} ({paper.year})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected Reference Summary Card */}
        {(() => {
          const paper = allPapers.find(p => p.id === selectedPaper) || allPapers[0];
          if (!paper) return null;
          const comps = Array.isArray(paper.compounds) ? paper.compounds : [];
          return (
            <div className="mt-4 p-4 bg-[#141C18] border border-emerald-500/10 flex flex-col md:flex-row justify-between gap-4 animate-in fade-in duration-150">
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-emerald-400 font-bold bg-[#0A0F0D] border border-white/5 px-1.5 py-0.5 uppercase tracking-wide">
                  {paper.journal} (Ref: {paper.year})
                </span>
                <h4 className="text-xs font-bold text-white leading-snug">{paper.title}</h4>
                <p className="text-[10px] text-white/50 italic line-clamp-1">"{paper.abstract}"</p>
                {comps.length > 0 && (
                  <div className="flex gap-1.5 pt-1">
                    <span className="text-[8px] font-mono text-white/40 uppercase">Key Entities:</span>
                    {comps.map(c => (
                      <span key={c} className="text-[8px] bg-white/5 text-emerald-400/80 border border-white/5 px-1 font-mono uppercase font-bold">{c}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 shrink-0 self-end md:self-center">
                <button
                  onClick={() => {
                    if (paper.id === 'doc-2') {
                      setInitialTHCa(15.0);
                      setInitialTHC(0.15);
                      setTemp(120);
                      setDuration(60);
                    } else {
                      setInitialTHCa(18.0);
                      setInitialTHC(0.10);
                      setTemp(115);
                      setDuration(45);
                    }
                    showLabNotification(`Applied "${paper.title}" kinetic metrics to Decarboxylation Simulator.`);
                  }}
                  className="bg-[#1A221E] hover:bg-emerald-500 hover:text-black border border-white/10 text-slate-300 text-[10px] font-mono uppercase px-3 py-1.5 transition-all"
                  title="Apply paper kinetics to Decarb Simulator"
                >
                  Calibrate Kinetics
                </button>

                <button
                  onClick={() => {
                    if (paper.id === 'doc-1') {
                      setBlendTHCa(8.0);
                      setBlendCBC(8.0);
                      setBlendCBD(0.0);
                      setBlendCBG(0.0);
                      setBlendCarrier(84.0);
                    } else {
                      setBlendTHCa(comps.includes('THCa') ? 10 : 0);
                      setBlendCBC(comps.includes('CBC') ? 10 : 0);
                      setBlendCBD(comps.includes('CBD') ? 15 : comps.includes('CBDa') ? 12 : 0);
                      setBlendCBG(comps.includes('CBG') ? 5 : 0);
                      setBlendCarrier(70.0);
                    }
                    showLabNotification(`Loaded synergistic ratios from reference paper into Formula Blender.`);
                  }}
                  className="bg-[#1A221E] hover:bg-purple-500 hover:text-white border border-white/10 text-slate-300 text-[10px] font-mono uppercase px-3 py-1.5 transition-all"
                  title="Load synergistic ratios into Blender"
                >
                  Apply Synergies
                </button>

                <button
                  onClick={() => {
                    if (paper.id === 'doc-3') {
                      setCuringTemp(15);
                      setCuringHumidity(62);
                      setCuringDays(28);
                    } else {
                      setCuringTemp(18);
                      setCuringHumidity(60);
                      setCuringDays(14);
                    }
                    showLabNotification(`Applied drying chamber environmental points to Curing Room.`);
                  }}
                  className="bg-[#1A221E] hover:bg-blue-500 hover:text-white border border-white/10 text-slate-300 text-[10px] font-mono uppercase px-3 py-1.5 transition-all"
                  title="Load curing points into Curing room"
                >
                  Set Curing Chamber
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Grid of tools */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    
        {/* Decarboxylation Simulator & Curve */}
        <div id="decarb-simulator-card" className="lg:col-span-2 bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <Beaker size={16} />
                Decarboxylation Kinetic Simulator
              </h3>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 font-mono">Fitted Arrhenius Model</span>
            </div>
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Model the thermal conversion of THCa into active Δ9-THC based on time and heat variables. Ensure expected formulation potencies conform to target specifications.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-[#1A221E] p-3 border border-white/5">
                <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1">Initial THCa (%)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    value={initialTHCa} 
                    onChange={e => setInitialTHCa(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full bg-transparent p-1 font-mono text-emerald-400 text-sm focus:outline-none" 
                    step="0.5"
                  />
                </div>
              </div>

              <div className="bg-[#1A221E] p-3 border border-white/5">
                <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1">Initial Δ9-THC (%)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    value={initialTHC} 
                    onChange={e => setInitialTHC(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full bg-transparent p-1 font-mono text-emerald-400 text-sm focus:outline-none" 
                    step="0.05"
                  />
                </div>
              </div>

              <div className="bg-[#1A221E] p-3 border border-white/5">
                <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1">Temperature (°C)</label>
                <div className="flex items-center justify-between">
                  <span className="text-white font-mono text-sm">{temp}°C</span>
                  <input 
                    type="range" 
                    min="80" 
                    max="180" 
                    value={temp} 
                    onChange={e => setTemp(parseInt(e.target.value))}
                    className="w-1/2 accent-emerald-500"
                  />
                </div>
              </div>

              <div className="bg-[#1A221E] p-3 border border-white/5">
                <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1 font-bold">Duration (Min)</label>
                <div className="flex items-center justify-between">
                  <span className="text-white font-mono text-sm">{duration}m</span>
                  <input 
                    type="range" 
                    min="5" 
                    max="180" 
                    value={duration} 
                    onChange={e => setDuration(parseInt(e.target.value))}
                    className="w-1/2 accent-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Simulated Live Chart Area */}
            <div className="bg-[#0A0F0D] border border-white/5 p-4 relative mb-6">
              <div className="text-[9px] font-mono text-white/30 uppercase tracking-wider mb-2 flex justify-between">
                <span>Reaction Kinetics Chart</span>
              </div>
              
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartPoints}
                    margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis 
                      dataKey="time" 
                      stroke="rgba(255,255,255,0.3)" 
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }}
                      tickFormatter={(value) => `${value}m`}
                    />
                    <YAxis 
                      stroke="rgba(255,255,255,0.3)" 
                      tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' }}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1A221E', borderColor: 'rgba(255,255,255,0.1)', fontFamily: 'monospace', fontSize: '10px', color: 'white' }}
                      itemStyle={{ fontFamily: 'monospace', fontSize: '10px' }}
                      formatter={(value) => [`${Number(value).toFixed(2)}%`, '']}
                      labelFormatter={(label) => `Time: ${label}m`}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace' }} />
                    <Line type="monotone" dataKey="thca" name="THCa" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="thc" name="Δ9-THC" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="totalThc" name="Total THC" stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="3 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Forecast Analysis Details */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 border-t border-white/10 pt-4 bg-emerald-500/5 -mx-6 -mb-6 p-6">
            <div className="flex flex-col">
              <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">End State THCa</span>
              <span className="text-xl font-bold font-mono text-amber-500">{finalResult.thca.toFixed(3)}%</span>
              <span className="text-[10px] text-white/50 mt-1">Remaining intact acid</span>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">End State Δ9-THC</span>
              <span className="text-xl font-bold font-mono text-emerald-400">{finalResult.thc.toFixed(3)}%</span>
              <span className="text-[10px] text-white/50 mt-1">Activated crystalline index</span>
            </div>

            <div className="flex flex-col justify-center">
              {finalResult.thc > 0.3 ? (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-mono flex items-center gap-1.5 p-2 uppercase">
                  <AlertTriangle size={12} className="shrink-0" /> Elevated Δ9-THC Warning
                </div>
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono flex items-center gap-1.5 p-2 uppercase">
                  <Award size={12} className="shrink-0" /> Compliant Target Area
                </div>
              )}
            </div>

            <div className="flex flex-col justify-center gap-2">
              <button 
                onClick={() => {
                  setPipelineStrain('Simulated Batch Output');
                  setPipelineTHCa(finalResult.thca);
                  setPipelineD9THC(finalResult.thc);
                  setDraftTemplateType('Academic Journal Paper');
                  setPipelineStep(3);
                  if (onNavigateToTab) onNavigateToTab('pipeline');
                }}
                className="bg-emerald-500 text-[#0A0F0D] text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-1.5 hover:bg-emerald-400 w-full text-center"
              >
                Draft Research Paper
              </button>
              <button 
                onClick={() => {
    const simPaper = {
      id: `doc-sim-${Date.now()}`,
      name: 'simulation_report.pdf',
      path: '/Simulations/',
      size: '150 KB',
      type: 'pdf' as const,
      uploadDate: new Date().toISOString().split('T')[0],
      title: `Decarboxylation Kinetic Analysis: ${temp}°C / ${duration}m`,
      journal: 'Internal Research Data',
      year: new Date().getFullYear(),
      authors: 'System Simulator',
      abstract: `Predictive model indicating a final THCa yield of ${finalResult.thca.toFixed(2)}% and Δ9-THC yield of ${finalResult.thc.toFixed(2)}% under ${temp}°C conditions.`,
      compounds: ['THCa', 'THC'],
      dosage: `${temp}°C / ${duration}m`,
      outcomes: finalResult.thc > 0.3 ? 'Non-compliant Δ9-THC limits.' : 'Compliant profile.'
    };

    setAllPapers(prev => [simPaper, ...prev]);
    setSelectedPaperEntity(simPaper);
    
    setPipelineStrain('Simulated Batch Output');
    setPipelineTHCa(finalResult.thca);
    setPipelineD9THC(finalResult.thc);
    setPipelineStep(4);
    if (onNavigateToTab) onNavigateToTab('flyers');
                }}
                className="border border-emerald-500/50 text-emerald-400 text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-1.5 hover:bg-emerald-500/10 w-full text-center"
              >
                Create Flyer
              </button>
            </div>
          </div>
        </div>

        {/* HPLC CHROMATOGRAM PEAK SIMULATOR */}
        <div id="chromatogram-card" className="bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <Activity size={16} />
                HPLC Chromatogram Peak Simulator
              </h3>
              <span className="text-[8px] bg-[#1a2e24] text-emerald-300 border border-emerald-500/20 px-2 py-0.5 font-mono">Dye / UV Absorption</span>
            </div>
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Witness sample evolution under high-pressure liquid chromatography (HPLC). Peak amplitudes reflect actual computed kinetic status at minute <span className="text-emerald-400 font-bold">{duration}</span>.
            </p>

            <div className="bg-[#050907] border border-white/5 p-4 rounded-none relative">
              <div className="text-[9px] font-mono text-white/40 mb-2 uppercase flex justify-between">
                <span>UV Detector Log (220 nm)</span>
                <span className="text-emerald-400 animate-pulse">● LIVE CORRELATION</span>
              </div>

              <div className="h-44 w-full relative">
                <svg className="w-full h-full" viewBox="0 0 200 100" preserveAspectRatio="none">
                  <line x1="0" y1="90" x2="200" y2="90" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
                  <line x1="20" y1="0" x2="20" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2" />
                  <line x1="60" y1="0" x2="60" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2" />
                  <line x1="100" y1="0" x2="100" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2" />
                  <line x1="140" y1="0" x2="140" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2" />
                  <line x1="180" y1="0" x2="180" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="2" />

                  {(() => {
                    const mathMaxCap = Math.max(1, (initialTHCa + initialTHC));
                    const thcHeight = (finalResult.thc / mathMaxCap) * 65; 
                    const thcaHeight = (finalResult.thca / mathMaxCap) * 65;

                    let dPath = "M 0 90";
                    for (let x = 0; x <= 200; x += 2) {
                      const pSolvent = 15 * Math.exp(-Math.pow(x - 25, 2) / (2 * Math.pow(2.5, 2)));
                      const pTHC = thcHeight * Math.exp(-Math.pow(x - 90, 2) / (2 * Math.pow(5, 2)));
                      const pTHCa = thcaHeight * Math.exp(-Math.pow(x - 150, 2) / (2 * Math.pow(5, 2)));

                      const y = 90 - (pSolvent + pTHC + pTHCa);
                      dPath += ` L ${x} ${Math.min(90, Math.max(10, y))}`;
                    }

                    return (
                      <>
                        <path d={`${dPath} L 200 90 Z`} fill="rgba(16, 185, 129, 0.04)" />
                        <path d={dPath} fill="none" stroke="#22c55e" strokeWidth="1.5" />

                        {thcHeight > 3 && (
                          <g transform={`translate(90, ${82 - thcHeight})`}>
                            <line x1="0" y1="2" x2="0" y2="8" stroke="#10b981" strokeWidth="0.5" />
                            <text x="0" y="-2" fill="#10b981" fontSize="7" fontFamily="monospace" textAnchor="middle">
                              Δ9-THC ({finalResult.thc.toFixed(1)}%)
                            </text>
                          </g>
                        )}

                        {thcaHeight > 3 && (
                          <g transform={`translate(150, ${82 - thcaHeight})`}>
                            <line x1="0" y1="2" x2="0" y2="8" stroke="#f59e0b" strokeWidth="0.5" />
                            <text x="0" y="-2" fill="#f59e0b" fontSize="7" fontFamily="monospace" textAnchor="middle">
                              THCa ({finalResult.thca.toFixed(1)}%)
                            </text>
                          </g>
                        )}
                      </>
                    );
                  })()}
                </svg>

                <div className="absolute bottom-1.5 left-0 right-0 px-2 flex justify-between text-[7px] font-mono text-white/30">
                  <span>rt: 1.5m (Solvent Gate)</span>
                  <span>rt: 4.8m (Δ9-THC Elution)</span>
                  <span>rt: 7.2m (THCa Elution)</span>
                </div>
              </div>
            </div>

            <div className="bg-[#1A221E] p-3 border border-white/5 mt-4 space-y-1">
              <span className="text-[8px] font-mono text-white/40 uppercase block">Expert Analytical Insight</span>
              <p className="text-[10px] text-white/70 leading-normal">
                Observe the chemical shift dynamically. Higher temperatures compress the retention curve to the left, decreasing the orange THCa peak area and multiplying the green Δ9-THC absorbance index.
              </p>
            </div>
          </div>

          <div className="border-t border-white/10 pt-4 mt-4 flex items-center gap-2">
            <Lightbulb size={14} className="text-amber-400 shrink-0" />
            <span className="text-[9px] font-sans text-white/50">
              Useful for testing solvent-less extract formulations or confirming baseline raw-material inputs.
            </span>
          </div>
        </div>

        {/* 3D Molecular Viewer - Decarboxylation Visualization */}
        <div id="molecule-viewer-card" className="lg:col-span-3 bg-[#0D1411] border border-white/10 p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <Atom size={16} />
                3D Molecular Structure Viewer
              </h3>
              <p className="text-xs text-white/60 mt-2 leading-relaxed">
                Interactive ball-and-stick molecular visualization. View THCa before decarboxylation and the resulting THC molecule after thermal activation at {temp}°C for {duration} minutes.
              </p>
            </div>
            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 font-mono">WebGL Rendered</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* THCa Molecule (Before) */}
            <div className="bg-[#0A0F0D] border border-white/5">
              <div className="px-3 py-2 border-b border-white/5 flex justify-between items-center">
                <span className="text-[9px] font-mono text-amber-400 uppercase tracking-widest font-bold">
                  THCa — Before Decarb
                </span>
                <span className="text-[8px] font-mono text-white/40">C22H30O4</span>
              </div>
              <div style={{ height: 280 }}>
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[10px] font-mono text-white/30">Loading 3D scene...</div>}>
                  <LazySceneContainer height={280} camera={{ position: [4, 2, 5], fov: 45 }}>
                    <LazyMoleculeViewer moleculeKey="THCa" showLabels={false} autoRotate={true} />
                  </LazySceneContainer>
                </Suspense>
              </div>
              <div className="px-3 py-2 border-t border-white/5 text-[9px] font-mono text-white/40">
                Non-psychoactive precursor with carboxylic acid group (COOH)
              </div>
            </div>

            {/* THC Molecule (After) */}
            <div className="bg-[#0A0F0D] border border-white/5">
              <div className="px-3 py-2 border-b border-white/5 flex justify-between items-center">
                <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest font-bold">
                  THC — After Decarb
                </span>
                <span className="text-[8px] font-mono text-white/40">C21H30O2</span>
              </div>
              <div style={{ height: 280 }}>
                <Suspense fallback={<div className="flex items-center justify-center h-full text-[10px] font-mono text-white/30">Loading 3D scene...</div>}>
                  <LazySceneContainer height={280} camera={{ position: [4, 2, 5], fov: 45 }}>
                    <LazyMoleculeViewer moleculeKey="THC" showLabels={false} autoRotate={true} />
                  </LazySceneContainer>
                </Suspense>
              </div>
              <div className="px-3 py-2 border-t border-white/5 text-[9px] font-mono text-white/40">
                Activated psychoactive compound — COOH group removed by heat
              </div>
            </div>
          </div>

          {/* Transformation info */}
          <div className="mt-4 bg-[#1A221E] border border-white/5 p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-[9px] font-mono text-white/60">THCa ({finalResult.thca.toFixed(2)}% remaining)</span>
              </div>
              <span className="text-white/30">→</span>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-[9px] font-mono text-white/60">THC ({finalResult.thc.toFixed(2)}% activated)</span>
              </div>
            </div>
            <span className="text-[8px] font-mono text-white/30">
              Conversion rate: {((1 - finalResult.thca / initialTHCa) * 100).toFixed(1)}% at {temp}°C / {duration}m
            </span>
          </div>
        </div>

        {/* Dynamic Formulation Blender & Synergy Score */}
        <div id="entourage-formula-card" className="lg:col-span-2 bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <Sliders size={16} />
                Entourage Formula Blender (100% Normalized)
              </h3>
              <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 font-mono">Synergy Calculator</span>
            </div>
            
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Design and evaluate custom pharmaceutical formulations. Slide and blend compound isolates. The system automatically normalizes components and projects active synergistic coefficients.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="bg-[#1A221E] p-3 border border-white/5">
                  <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                    <span className="text-amber-500 font-bold">THCa (Acidic Target)</span>
                    <span className="text-white font-bold">{blendTHCa.toFixed(1)}% / {(blendTotals.nTHCa).toFixed(1)}% normalized</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="50" 
                    value={blendTHCa} 
                    onChange={e => setBlendTHCa(parseFloat(e.target.value) || 0)}
                    className="w-full accent-amber-500"
                    step="0.5"
                  />
                </div>

                <div className="bg-[#1A221E] p-3 border border-white/5">
                  <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                    <span className="text-emerald-400 font-bold">CBC (Chromene Boost)</span>
                    <span className="text-white font-bold">{blendCBC.toFixed(1)}% / {(blendTotals.nCBC).toFixed(1)}% normalized</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="30" 
                    value={blendCBC} 
                    onChange={e => setBlendCBC(parseFloat(e.target.value) || 0)}
                    className="w-full accent-emerald-500"
                    step="0.5"
                  />
                </div>

                <div className="bg-[#1A221E] p-3 border border-white/5">
                  <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                    <span className="text-teal-400">CBD Isolate Fraction</span>
                    <span className="text-white">{blendCBD.toFixed(1)}% / {(blendTotals.nCBD).toFixed(1)}% normalized</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="50" 
                    value={blendCBD} 
                    onChange={e => setBlendCBD(parseFloat(e.target.value) || 0)}
                    className="w-full accent-teal-500"
                    step="0.5"
                  />
                </div>

                <div className="bg-[#1A221E] p-3 border border-white/5">
                  <div className="flex justify-between items-center text-[10px] font-mono mb-1.5">
                    <span className="text-blue-400">CBG Stem Fraction</span>
                    <span className="text-white">{blendCBG.toFixed(1)}% / {(blendTotals.nCBG).toFixed(1)}% normalized</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="30" 
                    value={blendCBG} 
                    onChange={e => setBlendCBG(parseFloat(e.target.value) || 0)}
                    className="w-full accent-blue-500"
                    step="0.5"
                  />
                </div>

              </div>

              <div className="bg-[#1A221E] p-4 border border-white/5">
                <div className="flex justify-between items-center text-[10px] font-mono mb-2">
                  <span className="text-slate-400 uppercase tracking-wider">Carrier Diluent (USP Organic Oil)</span>
                  <span className="text-white font-bold">{blendCarrier.toFixed(1)}% / {(blendTotals.nCarrier).toFixed(1)}% normalized</span>
                </div>
                <input 
                  type="range" 
                  min="20" 
                  max="95" 
                  value={blendCarrier} 
                  onChange={e => setBlendCarrier(parseFloat(e.target.value) || 0)}
                  className="w-full accent-slate-400"
                  step="0.5"
                />
              </div>
            </div>

            <div className="mt-6">
              <div className="text-[9px] font-mono text-white/40 uppercase tracking-widest mb-2">Formula Compound Profile</div>
              <div className="h-5 w-full flex bg-[#1A221E] border border-white/10">
                <div style={{ width: `${blendTotals.nTHCa}%` }} className="h-full bg-amber-500 transition-all text-[8px] font-mono flex items-center justify-center text-[#0A0F0D]" title="THCa">
                  {blendTotals.nTHCa > 8 && 'THCa'}
                </div>
                <div style={{ width: `${blendTotals.nCBC}%` }} className="h-full bg-emerald-500 transition-all text-[8px] font-mono flex items-center justify-center text-[#0A0F0D]" title="CBC">
                  {blendTotals.nCBC > 8 && 'CBC'}
                </div>
                <div style={{ width: `${blendTotals.nCBD}%` }} className="h-full bg-teal-500 transition-all text-[8px] font-mono flex items-center justify-center text-[#0A0F0D]" title="CBD">
                  {blendTotals.nCBD > 8 && 'CBD'}
                </div>
                <div style={{ width: `${blendTotals.nCBG}%` }} className="h-full bg-blue-500 transition-all text-[8px] font-mono flex items-center justify-center text-[#0A0F0D]" title="CBG">
                  {blendTotals.nCBG > 8 && 'CBG'}
                </div>
                <div style={{ width: `${blendTotals.nCarrier}%` }} className="h-full bg-slate-600 transition-all text-[8px] font-mono flex items-center justify-center text-[#0A0F0D]" title="Carrier">
                  {blendTotals.nCarrier > 15 && 'Carrier'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-white/10 pt-4 bg-[#111915] -mx-6 -mb-6 p-6 mt-6">
            <div className="flex flex-col">
              <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Total Potential THC</span>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {(blendTotals.potentialTHC).toFixed(3)}%
              </span>
              <span className="text-[10px] text-white/50 mt-1">Federal strict limit: ≤ 0.30%</span>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Predicted Efficacy Score</span>
              <span className="text-lg font-bold font-mono text-purple-400">
                {blendTotals.synergyScore}/100
              </span>
              <span className="text-[10px] text-white/50 mt-1">TRPA1 Reciprocal Affinity</span>
            </div>

            <div className="flex flex-col justify-center">
              {blendTotals.isCompliant ? (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono flex items-center gap-1.5 p-2 uppercase h-fit">
                  <CheckCircle2 size={12} className="shrink-0" /> Compliant Liquid Formula
                </div>
              ) : (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-mono flex items-center gap-1.5 p-2 uppercase h-fit">
                  <AlertTriangle size={12} className="shrink-0" /> EXCEEDS POTENCY LIMIT
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Curing & Storage Decarb Hazard Predictor */}
        <div id="curing-predictor-card" className="bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2 mb-4">
              <Thermometer size={16} />
              Curing Room Predictor
            </h3>
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Determine predicted preservation rates of parent cannabinoids under specific atmospheric values during the drying phases.
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-mono text-white/80 mb-1">
                  <span>Drying Temp (°C)</span>
                  <span>{curingTemp}°C</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="35" 
                  value={curingTemp} 
                  onChange={e => setCuringTemp(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono text-white/80 mb-1">
                  <span>Relative Humidity (%)</span>
                  <span>{curingHumidity}%</span>
                </div>
                <input 
                  type="range" 
                  min="30" 
                  max="80" 
                  value={curingHumidity} 
                  onChange={e => setCuringHumidity(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono text-white/80 mb-1">
                  <span>Exposure Window (Days)</span>
                  <span>{curingDays} Days</span>
                </div>
                <input 
                  type="range" 
                  min="3" 
                  max="45" 
                  value={curingDays} 
                  onChange={e => setCuringDays(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-6 mt-6">
            <div className="bg-[#1A221E] p-4 border border-white/5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-mono text-white/50 uppercase">Acid Preservation Index</span>
                <span className={`text-base font-bold font-mono ${
                  curingForecast.status === 'good' ? 'text-emerald-400' :
                  curingForecast.status === 'warn' ? 'text-amber-500' : 'text-red-500'
                }`}>
                  {curingForecast.preservationRate.toFixed(1)}%
                </span>
              </div>
              
              <div className="h-2 w-full bg-white/5">
                <div 
                  className={`h-full transition-all duration-300 ${
                    curingForecast.status === 'good' ? 'bg-emerald-500' :
                    curingForecast.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${curingForecast.preservationRate}%` }}
                />
              </div>

              <div className="flex gap-2 items-start mt-2">
                <Info size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-[10px] font-sans text-white/70 leading-relaxed italic">{curingForecast.advice}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Dynamic Trial Ledger / Custom Run Persistence Database Section */}
        <div id="trials-ledger-card" className="lg:col-span-3 bg-[#0D1411] border border-white/10 p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-6">
            <div>
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <ListOrdered size={16} />
                Experimental Run Ledger & Batch Trials
              </h3>
              <p className="text-xs text-white/50 mt-1">
                Persist and monitor current virtual simulator configurations to your local testing ledger database.
              </p>
            </div>
            
            <span className="text-[10px] font-mono bg-[#111915] text-emerald-400 border border-white/5 px-2.5 py-1 text-right">
              {trialList.length} Active Records Catalogued
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            <div className="bg-[#1A221E] border border-white/5 p-4 flex flex-col justify-between">
              <form onSubmit={handleAddTrial} className="space-y-4">
                <h4 className="text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Save size={14} /> Log Simulated Run
                </h4>
                
                <div>
                  <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1">Experimental Run Name</label>
                  <input 
                    type="text" 
                    value={newTrialName}
                    onChange={e => setNewTrialName(e.target.value)}
                    placeholder="e.g. Batch B-8803 Sweeping..."
                    className="w-full bg-[#0A0F0D] border border-white/10 p-2 font-mono text-xs text-emerald-400 focus:outline-none focus:border-emerald-500 placeholder-white/20"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1">Select Experiment Vector</label>
                  <select
                    value={newTrialType}
                    onChange={e => setNewTrialType(e.target.value as any)}
                    className="w-full bg-[#0A0F0D] border border-white/10 p-2 font-mono text-xs text-white/70 focus:outline-none focus:border-emerald-500 focus:text-white"
                  >
                    <option value="Decarb Optimization">Decarb Optimizer Sliders</option>
                    <option value="Atmospheric Stabilization">Curing Presets Sliders</option>
                    <option value="Synergistic Blend Formulation">Entourage Blender Sliders</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[8px] font-mono text-white/40 uppercase tracking-widest mb-1">Trial Execution Notes</label>
                  <textarea
                    rows={3}
                    value={newTrialNotes}
                    onChange={e => setNewTrialNotes(e.target.value)}
                    placeholder="Attach custom laboratory comments, specific moisture data variations or targeted compliance actions."
                    className="w-full bg-[#0A0F0D] border border-white/10 p-2 font-mono text-xs text-emerald-400 focus:outline-none focus:border-emerald-500 placeholder-white/20 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs font-mono uppercase tracking-widest py-2.5 flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus size={14} /> Persist Run to Ledger
                </button>
              </form>

              <div className="bg-[#0A0F0D] p-3 text-[10px] text-white/50 border border-white/5 mt-4">
                <span className="text-white text-[9px] font-mono uppercase font-bold block mb-1">💡 System Tip</span>
                Select an experiment vector, tweak the controls in the cards above, and hit "Persist" to instantly record that specific scientific state.
              </div>
            </div>

            <div className="lg:col-span-3 space-y-3 max-h-96 overflow-y-auto pr-2">
              {trialList.length === 0 ? (
                <div className="p-8 border border-dashed border-white/10 text-center text-white/30 italic text-xs font-mono">
                  No registered experimental trial metrics on file. Use the simulator control parameters to run and log a record.
                </div>
              ) : (
                trialList.map((trial) => (
                  <div 
                    key={trial.id} 
                    className="bg-[#1A221E]/60 border border-white/5 p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-white/10 transition-colors animate-in fade-in duration-200"
                  >
                    <div className="space-y-1.5 max-w-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-emerald-400 font-bold bg-[#0A0F0D] border border-white/5 px-1.5 py-0.5">{trial.id}</span>
                        <h4 className="text-xs font-bold text-white font-mono">{trial.name}</h4>
                        <span className="text-[8px] text-white/40 font-mono italic">| {trial.date}</span>
                      </div>
                      
                      <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                        <span className="text-purple-400 font-bold bg-purple-500/5 px-1.5 py-0.5 border border-purple-500/10">
                          {trial.type}
                        </span>
                        
                        {trial.parameters.temp !== undefined && (
                          <span className="text-white/60">Temp: {trial.parameters.temp}°C</span>
                        )}
                        {trial.parameters.duration !== undefined && (
                          <span className="text-white/60">Duration: {trial.parameters.duration} {trial.type === 'Atmospheric Stabilization' ? 'days' : 'mins'}</span>
                        )}
                        {trial.parameters.humidity !== undefined && (
                          <span className="text-white/60">RH: {trial.parameters.humidity}%</span>
                        )}
                        {trial.parameters.compoundRatio && (
                          <span className="text-emerald-400">Ratio: {trial.parameters.compoundRatio}</span>
                        )}
                      </div>

                      <p className="text-[11px] text-white/60 leading-relaxed italic pr-4">"{trial.notes}"</p>
                    </div>

                    <div className="flex flex-row md:flex-col justify-between md:items-end w-full md:w-auto shrink-0 border-t md:border-t-0 border-white/5 pt-3 md:pt-0 gap-3">
                      <div>
                        {trial.results.finalDelta9THC !== undefined && (
                          <span className="text-xs font-mono block text-right font-bold text-white">
                            Activated Δ9: <span className="text-emerald-400">{trial.results.finalDelta9THC.toFixed(2)}%</span>
                          </span>
                        )}
                        {trial.results.preservationRate !== undefined && (
                          <span className="text-xs font-mono block text-right font-bold text-white">
                            Preserv Rate: <span className="text-emerald-400">{trial.results.preservationRate.toFixed(1)}%</span>
                          </span>
                        )}
                        {trial.results.synergyScore !== undefined && (
                          <span className="text-xs font-mono block text-right font-bold text-white">
                            Synergy Score: <span className="font-bold text-purple-400">{trial.results.synergyScore}/100</span>
                          </span>
                        )}
                        
                        <div className="flex justify-end gap-1.5 mt-1">
                          <span className={`text-[8px] font-mono px-1.5 py-0.5 border uppercase font-bold ${
                            trial.results.compliance === 'COMPLIANT' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : 'bg-red-500/10 text-red-500 border-red-500/20'
                          }`}>
                            {trial.results.compliance}
                          </span>

                          <span className={`text-[8px] font-mono px-1.5 py-0.5 border uppercase font-bold ${
                            trial.status === 'highly_successful' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            trial.status === 'borderline_compliant' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                            'bg-red-500/10 text-red-500 border-red-500/20'
                          }`}>
                            {trial.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      <button 
                        onClick={() => handleDeleteTrial(trial.id)}
                        className="text-white/30 hover:text-red-400 p-1 rounded transition-colors self-end md:self-auto"
                        title="Delete Ledger Record"
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Literature & Synergy Comparative Matrix */}
        <div id="synergy-matrix-card" className="lg:col-span-2 bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <BookOpen size={16} />
                Synergy & Evidence Matrix
              </h3>
              <span className="text-[10px] bg-purple-500/10 text-purple-400 p-1 font-mono">Literature Scans Active</span>
            </div>
            
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Synthesized findings scanned from indexed medical journals. Exploit the "Entourage Effect" to design compliant, high-efficacy isolates.
            </p>

            <div className="space-y-3 mb-6 max-h-96 overflow-y-auto pr-1">
              {allPapers.map(paper => {
                const comps = Array.isArray(paper.compounds) ? paper.compounds : [];
                return (
                  <div 
                    key={paper.id}
                    onClick={() => {
                      setSelectedPaper(paper.id);
                      setGeneratedProtocol(null);
                    }}
                    className={`p-4 border border-white/5 cursor-pointer transition-colors ${
                      selectedPaper === paper.id ? 'bg-white/5 border-l-2 border-emerald-500' : 'bg-[#1A221E] hover:bg-white/5'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-mono text-emerald-400 font-bold">{paper.journal} (Ref: {paper.year})</span>
                      <div className="flex gap-1.5">
                        {comps.map(comp => (
                          <span key={comp} className="text-[8px] bg-white/5 text-white/50 border border-white/10 px-1 font-mono uppercase font-bold">{comp}</span>
                        ))}
                      </div>
                    </div>
                    <h4 className="text-xs font-bold text-white mb-2">{paper.title}</h4>
                    <p className="text-[10px] text-white/40 line-clamp-2">{paper.abstract}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedPaper && (
            <div className="bg-[#1A221E] border-t border-white/10 p-4 -mx-6 -mb-6">
              {generatedProtocol ? (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex justify-between items-center">
                    <h5 className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest">Formulated R&D Study Protocol</h5>
                    <button 
                      onClick={() => setGeneratedProtocol(null)}
                      className="text-[9px] font-mono text-white/40 hover:text-white uppercase"
                    >
                      Back to abstract
                    </button>
                  </div>
                  <pre className="text-[10px] font-mono bg-[#0A0F0D] p-4 text-emerald-300/90 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-60 border border-white/5">
                    {generatedProtocol}
                  </pre>
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in duration-200">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[8px] font-mono text-white/40 uppercase">Selected Study Deep-Dive</span>
                      <h5 className="text-xs font-mono font-bold text-white mt-1">Authors: {allPapers.find(p => p.id === selectedPaper)?.authors || 'N/A'}</h5>
                    </div>
                    <button 
                      onClick={() => handleGenerateProtocol(selectedPaper)}
                      className="bg-emerald-500 text-[#0A0F0D] text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1.5 hover:bg-emerald-400 flex items-center gap-1.5"
                    >
                      <Sparkles size={12} /> Propose Study Protocol
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-mono text-emerald-500/80 bg-[#0A0F0D] p-3 border border-white/5">
                    <div>
                      <span className="text-white/40 block uppercase tracking-widest">Active Dosage Model:</span>
                      {allPapers.find(p => p.id === selectedPaper)?.dosage || 'N/A'}
                    </div>
                    <div>
                      <span className="text-white/40 block uppercase tracking-widest">Efficacy &amp; Outcomes:</span>
                      {allPapers.find(p => p.id === selectedPaper)?.outcomes || 'N/A'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Multi-Agent Swarm Consensus Debater Section */}
        <div id="swarm-consensus-card" className="bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <GitCompare size={16} />
                Swarm Consensus Auditor
              </h3>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 font-mono">Multi-node solver</span>
            </div>

            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              Resolve highly complex conflicts between legal guidelines, extraction uncertainties, and raw moisture deviations. Run simulated multi-agent debate structures here.
            </p>

            <div className="bg-[#1A221E] p-4 border border-white/5 mb-6">
              <span className="text-[9px] font-mono text-white/40 block uppercase tracking-widest mb-2">Simulated Conflict Scenario</span>
              <div className="text-xs text-white bg-[#0A0F0D] p-3 border border-white/5 font-mono">
                "Batch B-8803 failed compliance by 0.02% but Chemistry indicates high moisture weights (14.8%) and measurement uncertainties of ±0.06%."
              </div>
            </div>

            <button 
              onClick={handleRunDebate}
              disabled={isDebating}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-mono text-xs font-bold uppercase tracking-widest py-3 flex items-center justify-center gap-2"
            >
              {isDebating ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-none border border-black border-t-transparent animate-spin" />
                  Swarm Debate Loop Active...
                </>
              ) : (
                <>
                  <Play size={14} fill="currentColor" /> Run Swarm Consensus debate
                </>
              )}
            </button>
          </div>

          <div className="mt-6 border-t border-white/10 pt-6">
            <div className="bg-[#0A0F0D] border border-white/5 p-4 rounded-none h-60 overflow-y-auto space-y-4 font-mono text-[9px] sm:text-[10px] leading-relaxed font-semibold">
              {debateLog.length === 0 && (
                <div className="text-white/20 italic text-center pt-16">
                  Trigger multi-agent loop to view consensus debates.
                </div>
              )}
              {debateLog.map((log, index) => {
                if (!log) return null;
                return (
                  <div 
                    key={index} 
                    className="space-y-1 border-l border-white/10 pl-3 animate-in fade-in slide-in-from-bottom-2"
                  >
                    <span className={`font-bold ${log.color || ''} uppercase tracking-widest`}>
                      ● {log.agent}
                    </span>
                    <p className="text-slate-300">{log.message}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
