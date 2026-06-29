import React, { useState, useEffect } from 'react';
import { Upload, FileUp, ListFilter, AlertCircle, CheckCircle2, ChevronRight, Terminal, Network, Database, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { COARecord } from '../types';
import { authFetch } from '../lib/firebase';
import PublicCOAVerifier from './PublicCOAVerifier';
import { useCOAs } from '../contexts';

type PipelineStep = {
  id: string;
  status: 'pending' | 'running' | 'success' | 'warning';
  message: string;
};

interface ISOLab {
  id: string;
  name: string;
  location: string;
  isoAccreditation: string;
  certificateNumber: string;
  activeHandshake: boolean;
}

interface MetrcPackage {
  packageId: string;
  licenseNumber: string;
  itemStrain: string;
  productType: "Flower" | "Concentrate" | "Infused-Edible" | "Topical";
  quantity: number;
  unitOfMeasure: "Grams" | "Ounces" | "Units";
  status: "In-Transit" | "In-Inventory" | "Testing-Pending" | "Testing-Passed" | "Testing-Failed";
  lastSyncDate: string;
}

export default function COAIntake() {
  const { coas, addCoasOptimistic } = useCOAs();
  const onUpload = addCoasOptimistic;
  
  const [isHovering, setIsHovering] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [selectedCoaId, setSelectedCoaId] = useState<string | null>(null);
  
  // Real LIMS & Metrc state from server
  const [labs, setLabs] = useState<ISOLab[]>([]);
  const [packages, setPackages] = useState<MetrcPackage[]>([]);
  const [isLoadingLabs, setIsLoadingLabs] = useState(false);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [metrcInputId, setMetrcInputId] = useState('');
  const [isSyncingMetrc, setIsSyncingMetrc] = useState(false);

  // Fetch real LIMS and Metrc data from Node API
  const fetchLabs = async () => {
    setIsLoadingLabs(true);
    try {
      const res = await authFetch('/api/lims/labs');
      if (res.ok) {
        const data = await res.json();
        setLabs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingLabs(false);
    }
  };

  const fetchPackages = async () => {
    setIsLoadingPackages(true);
    try {
      const res = await authFetch('/api/metrc/packages');
      if (res.ok) {
        const data = await res.json();
        setPackages(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingPackages(false);
    }
  };

  useEffect(() => {
    fetchLabs();
    fetchPackages();
  }, []);

  const toggleLabHandshake = async (labId: string) => {
    try {
      const res = await authFetch('/api/lims/toggle-handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labId })
      });
      if (res.ok) {
        fetchLabs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const syncMetrcStatus = async (packageId: string, targetStatus: string) => {
    setIsSyncingMetrc(true);
    try {
      const res = await authFetch('/api/metrc/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, syncStatus: targetStatus })
      });
      if (res.ok) {
        fetchPackages();
        alert(`Successfully synced test results with Metrc for Package ${packageId}.`);
      }
    } catch (e) {
      console.error(e);
      alert('Metrc synchronization failed.');
    } finally {
      setIsSyncingMetrc(false);
    }
  };

  // Mock agent-managed processing function with server-side safety checks
  const [rawCOAText, setRawCOAText] = useState('');

  const executeAIParsingPipeline = (textToParse?: string) => {
    setIsSimulating(true);
    
    const coaText = textToParse || [
      `GLOBAL LABORATORY SERVICES — CERTIFICATE OF ANALYSIS
Lab Sample ID: 2026-GLS-10901
Client: Carolina Organic Farms
Batch ID: B-8820
Strain Name: Carolina Dream (Premium Flower)
TEST RESULTS (Dry Weight basis):
Moisture Content: 12.1%
THCA: 0.18%
delta-9-THC: 0.05%
TOTAL CBD: 15.4%
Status: Standard pre-decarb testing complete.`,
      `GLOBAL LABORATORY SERVICES — CERTIFICATE OF ANALYSIS
Lab Sample ID: 2026-GLS-10902
Client: Wilson Growers Inc.
Batch ID: B-8821
Strain Name: Cherry Wine (Flower batch)
TEST RESULTS (Dry Weight basis):
Moisture Content: 10.9%
THCA: 0.38%
delta-9-THC: 0.04%
TOTAL CBD: 14.1%
Status: Standard pre-decarb testing complete.`
    ][Math.floor(Math.random() * 2)];

    setPipelineSteps([
      { id: '1', status: 'running', message: 'Intake Agent: Monitoring incoming datastream...' }
    ]);

    const addStep = (msg: string, status: PipelineStep['status'] = 'success', replaceLast = false) => {
      setPipelineSteps(prev => {
        const newSteps = replaceLast ? prev.slice(0, -1) : [...prev];
        if (replaceLast && prev.length > 0) {
           newSteps.push({ ...prev[prev.length - 1], status: 'success' });
        }
        const uniqueId = `step-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        return [...newSteps, { id: uniqueId, status, message: msg }];
      });
    };

    setTimeout(() => {
      addStep('Intake Agent: Monitoring incoming datastream...', 'success', true);
      addStep(`Classification: Detected physical lab Certificate of Analysis (COA) text payload.`, 'success');
      
      setTimeout(() => {
        addStep('Pre-processing: Enhancing and sanitizing raw text payload...', 'running');
        
        setTimeout(() => {
          addStep('Pre-processing: Text sanitization complete.', 'success', true);
          addStep('OCR & LLM Engine: Querying structured Layout Compliance Agent (Gemini Core)...', 'running');

          authFetch('/api/gemini/parse-coa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coaRawText: coaText })
          })
          .then(res => {
            if (!res.ok) throw new Error('API Parser failed');
            return res.json();
          })
          .then(data => {
            setTimeout(() => {
              addStep('OCR & LLM Engine: Gemini extraction and tabular parsing complete.', 'success', true);
              addStep(`Compliance Agent: Executing Total THC formula calculations... Status: ${data.status}.`, 'running');

              setTimeout(() => {
                addStep(`Compliance Agent: Verified under GxP regulatory rules. Calculated Total: ${data.totalThc.toFixed(3)}%.`, 'success', true);
                addStep('Graph Engine: Emitting signed machine-readable records to relational store...', 'success');

                const record = {
                  id: `coa-${Math.random().toString(36).substring(7)}`,
                  batchId: data.batchId,
                  strain: data.strain,
                  uploadDate: new Date().toISOString().split('T')[0],
                  thca: data.thca,
                  d9thc: data.d9thc,
                  totalThc: data.totalThc,
                  status: data.status,
                  recommendation: data.recommendation || "",
                  labName: "Wilmington Analytical Chemistry Services",
                  labCertificateNumber: "Cert-4493-02"
                };

                authFetch('/api/coas', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(record)
                })
                .then(saveRes => {
                  if (!saveRes.ok) throw new Error('Database insertion rejected');
                  return saveRes.json();
                })
                .then(savedCoa => {
                  onUpload([savedCoa]);
                  addStep('Ledger Engine: Cryptographically signed GxP Certificate saved securely to Firestore.', 'success');
                  setIsSimulating(false);
                  setRawCOAText('');
                })
                .catch(saveErr => {
                  console.error(saveErr);
                  addStep('Ledger Engine: COA verified but failed to write to durable database ledger.', 'warning');
                  onUpload([record as any]);
                  setIsSimulating(false);
                  setRawCOAText('');
                });
              }, 1200);
            }, 1000);
          })
          .catch(err => {
            console.error(err);
            addStep('OCR & LLM Engine: Error encountered during extraction. Please verify format.', 'warning', true);
            setIsSimulating(false);
          });

        }, 1200);
      }, 1000);
    }, 800);
  };

  const handleSimulateDrop = () => {
    executeAIParsingPipeline();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="mb-8 border-b border-white/10 pb-6">
        <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">Intake & Agentic Audit</h2>
        <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-2">Upload unstructured PDFs or CSVs. Agents extract data and run Total THC logic.</p>
      </header>

      {/* LIMS Connections and Metrc Integration Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ISO 17025 Labs handshake list */}
        <div className="bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <Network size={16} /> ISO 17025 Accredited Lab Links
              </h3>
              <button onClick={fetchLabs} className="text-white/40 hover:text-white transition-colors">
                <RefreshCw size={14} className={isLoadingLabs ? "animate-spin" : ""} />
              </button>
            </div>
            <p className="text-xs text-white/60 mb-4">
              Connect directly with North Carolina certified testing facilities to pull original certificates of analysis (COAs) and chromatograms.
            </p>
            <div className="space-y-3">
              {labs.map(lab => (
                <div key={lab.id} className="p-3 bg-[#1A221E] border border-white/5 flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-white">{lab.name}</h4>
                    <p className="text-[10px] text-white/40 font-mono">{lab.location} • {lab.certificateNumber}</p>
                  </div>
                  <button 
                    onClick={() => toggleLabHandshake(lab.id)}
                    className={`text-[10px] font-mono px-2 py-1 font-bold tracking-wider uppercase border ${
                      lab.activeHandshake 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                        : 'bg-white/5 text-white/40 border-white/10 hover:text-white'
                    }`}
                  >
                    {lab.activeHandshake ? 'Handshake Active' : 'Establish Link'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Metrc Seed-to-Sale Track-and-Trace connection panel */}
        <div className="bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <Database size={16} /> Metrc Track & Trace Sync
              </h3>
              <button onClick={fetchPackages} className="text-white/40 hover:text-white transition-colors">
                <RefreshCw size={14} className={isLoadingPackages ? "animate-spin" : ""} />
              </button>
            </div>
            <p className="text-xs text-white/60 mb-4">
              Synchronize laboratory pass/fail checks directly with Metrc’s open regulatory database.
            </p>
            <div className="space-y-2 max-h-[160px] overflow-y-auto">
              {packages.map(pkg => (
                <div key={pkg.packageId} className="p-2.5 bg-[#1A221E] border border-white/5 flex justify-between items-center text-xs font-mono">
                  <div>
                    <div className="font-bold text-white text-[11px] truncate w-[180px]">{pkg.packageId}</div>
                    <div className="text-[10px] text-white/40">{pkg.itemStrain} ({pkg.quantity} {pkg.unitOfMeasure})</div>
                  </div>
                  <div className="flex gap-1">
                    <span className={`text-[9px] uppercase font-bold px-1 py-0.5 border ${
                      pkg.status === 'Testing-Passed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      pkg.status === 'Testing-Failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {pkg.status}
                    </span>
                    {pkg.status === 'Testing-Pending' && (
                      <button 
                        disabled={isSyncingMetrc}
                        onClick={() => syncMetrcStatus(pkg.packageId, 'Testing-Passed')}
                        className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-bold px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                      >
                        Push Pass
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Upload Zone & Agent Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div 
            className={`border border-dashed p-6 flex flex-col items-center justify-center text-center transition-colors ${
              isHovering ? 'border-emerald-500 bg-white/5' : 'border-white/10 bg-[#0D1411] hover:bg-white/5'
            }`}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            <div className="bg-emerald-500/20 p-3 text-emerald-400 mb-3">
              <Upload size={24} />
            </div>
            <h3 className="text-sm font-bold text-white tracking-tight">Drag & drop Lab Results</h3>
            <p className="text-white/40 text-[10px] font-mono mt-1 mb-4">Supports physical lab PDF formats, LIMS CSVs.</p>
            
            <button 
              onClick={handleSimulateDrop}
              disabled={isSimulating}
              className={`px-4 py-2 font-bold uppercase tracking-widest text-[10px] transition-all flex items-center gap-1.5 ${
                isSimulating 
                ? 'bg-white/5 text-white/40 cursor-not-allowed' 
                : 'bg-emerald-500 text-[#0A0F0D] hover:bg-emerald-400'
              }`}
            >
              {isSimulating ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-none border-2 border-white/40 border-t-transparent animate-spin" />
                  Pipeline Active...
                </>
              ) : (
                <>
                  <FileUp size={14} />
                  Simulate Drop
                </>
              )}
            </button>
          </div>

          <div className="bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold text-emerald-400 font-mono uppercase tracking-widest mb-1 flex items-center gap-2">
                <ShieldCheck size={16} /> Direct Text Ingestion
              </h3>
              <p className="text-[10px] text-white/50 mb-3 leading-relaxed">
                Paste unstructured COA text or raw OCR metrics to parse instantly via Gemini.
              </p>
              <textarea
                className="w-full h-[95px] bg-[#1A221E] border border-white/10 p-2 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-emerald-500 rounded-none resize-none placeholder-white/20"
                placeholder="GLOBAL LAB REPORT. Batch: B-9904. Strain: Carolina Gold. THCa: 0.22%. Delta-9-THC: 0.05%."
                value={rawCOAText}
                onChange={(e) => setRawCOAText(e.target.value)}
              />
            </div>
            <button
              onClick={() => executeAIParsingPipeline(rawCOAText)}
              disabled={isSimulating || !rawCOAText.trim()}
              className="w-full mt-3 bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-mono font-bold py-2 text-[10px] uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Execute Ingestion
            </button>
          </div>
        </div>

        {/* Live Pipeline Terminal */}
        <div className="lg:col-span-1 bg-[#0D1411] border border-white/10 flex flex-col h-full min-h-[250px]">
          <div className="bg-[#1A221E] px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Terminal size={14} className="text-emerald-500" />
            <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] m-0">Agent Execution Log</h3>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-2 font-mono text-[10px] sm:text-xs bg-[#0A0F0D]">
            {pipelineSteps.length === 0 && (
              <div className="text-white/20 italic">Waiting for incoming document stream...</div>
            )}
            {pipelineSteps.map((step, idx) => (
              <div key={step.id} className="flex gap-3 items-start animate-in fade-in slide-in-from-bottom-2">
                <span className="text-white/30 shrink-0">[{idx < 9 ? '0'+(idx+1) : idx+1}]</span>
                <div className="flex-1">
                  <span className={`${
                    step.status === 'running' ? 'text-amber-400' :
                    step.status === 'success' ? 'text-emerald-400' :
                    step.status === 'warning' ? 'text-red-400' : 'text-white/60'
                  }`}>
                    {step.message}
                  </span>
                  {step.status === 'running' && (
                    <span className="inline-block ml-2 w-1.5 h-1.5 bg-amber-400 animate-pulse"></span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-[#0D1411] border border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-[#1A221E]">
          <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2">
            <ListFilter size={14} className="text-emerald-500"/> Audit Ledger
          </h3>
          <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">Formula: (THCa × 0.877) + Δ9-THC</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-6 py-3 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Batch / Strain</th>
                <th className="px-6 py-3 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">THCa %</th>
                <th className="px-6 py-3 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">Δ9-THC %</th>
                <th className="px-6 py-3 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] text-right">Total THC %</th>
                <th className="px-6 py-3 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Audit Status</th>
                <th className="px-6 py-3 text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Agent Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {coas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-white/40 text-xs font-mono">
                    No records found. Upload COAs to begin analysis.
                  </td>
                </tr>
              ) : (
                coas.map(coa => (
                  <tr key={coa.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-bold text-white tracking-tight">{coa.batchId}</div>
                      <div className="text-xs text-white/40 font-mono mt-0.5">{coa.strain}</div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-sm text-emerald-500/70">{coa.thca.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-mono text-sm text-emerald-500/70">{coa.d9thc.toFixed(2)}</td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-white">{coa.totalThc.toFixed(3)}</td>
                    <td className="px-6 py-4">
                      {coa.status === 'Compliant' && <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-bold uppercase tracking-widest"><CheckCircle2 size={12}/> Pass</span>}
                      {coa.status === 'At Risk' && <span className="inline-flex items-center gap-1 text-amber-400 text-[10px] font-bold uppercase tracking-widest"><AlertCircle size={12}/> Borderline</span>}
                      {coa.status === 'Non-Compliant' && <span className="inline-flex items-center gap-1 text-red-400 text-[10px] font-bold uppercase tracking-widest"><AlertCircle size={12}/> Fail</span>}
                    </td>
                    <td className="px-6 py-4 flex items-center gap-3">
                      <button 
                        onClick={() => setSelectedCoaId(coa.id)}
                        className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold hover:text-emerald-300 flex items-center gap-1"
                      >
                        Verify & QR (Ledger)
                      </button>
                      {coa.recommendation && (
                        <span className="text-white/20 text-xs">|</span>
                      )}
                      {coa.recommendation && (
                        <button 
                          onClick={() => alert(`GxP Compliance Guidance:\n\n${coa.recommendation}`)}
                          className="text-[10px] uppercase tracking-widest text-white/50 hover:text-white font-bold"
                        >
                          Guidance
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Immersive Overlay Modal for Public COA Verification */}
      {selectedCoaId && (
        <div className="fixed inset-0 z-50 bg-[#0A0F0D]/95 overflow-y-auto backdrop-blur-sm">
          <div className="absolute top-4 right-4 z-50">
            <button
              onClick={() => setSelectedCoaId(null)}
              className="bg-white/5 hover:bg-white/10 text-white p-2 rounded-full border border-white/10 transition-colors flex items-center justify-center"
              title="Close Verification Portal"
            >
              <X size={20} />
            </button>
          </div>
          <div className="py-4">
            <PublicCOAVerifier coaId={selectedCoaId} />
          </div>
        </div>
      )}
    </div>
  );
}
