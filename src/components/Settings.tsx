import React, { useState, useEffect } from 'react';
import { ShieldAlert, Database, Scale, Sliders, Cpu, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { getOllamaConfig, setOllamaConfig, detectLocalModels, OllamaConfig, OllamaModel } from '../lib/ollamaService';

export default function Settings() {
  const [ollamaConfig, setOllamaConfigState] = useState<OllamaConfig>(getOllamaConfig());
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [detectStatus, setDetectStatus] = useState<'idle' | 'detecting' | 'connected' | 'failed'>('idle');
  const [errorHelp, setErrorHelp] = useState<string>('');

  const handleTestOllama = async (endpointToTest?: string, bypassSimulate: boolean = false) => {
    const url = endpointToTest || ollamaConfig.endpoint;
    setDetectStatus('detecting');
    setErrorHelp('');
    try {
      const models = await detectLocalModels(url, bypassSimulate);
      setLocalModels(models);
      setDetectStatus('connected');
      
      // If the current config model isn't in the list, auto-select the first available model if list is non-empty
      if (models.length > 0 && !models.some(m => m.name === ollamaConfig.model || m.name.startsWith(ollamaConfig.model))) {
        const updated = { ...ollamaConfig, endpoint: url, model: models[0].name };
        setOllamaConfigState(updated);
        setOllamaConfig(updated);
      } else {
        const updated = { ...ollamaConfig, endpoint: url };
        setOllamaConfigState(updated);
        setOllamaConfig(updated);
      }
    } catch (err: any) {
      setDetectStatus('failed');
      setErrorHelp(
        `Failed to reach local Ollama on ${url}. Standard browsers block connection unless CORS is configured on your machine. To fix, launch Ollama with: OLLAMA_ORIGINS="*" ollama serve`
      );
    }
  };

  useEffect(() => {
    // Proactively test connection on load or populate simulated models
    if (ollamaConfig.simulate) {
      setLocalModels([
        { name: 'llama3.2:latest', size: 2020000000, family: 'llama' },
        { name: 'qwen2.5:1.5b', size: 980000000, family: 'qwen' },
        { name: 'gemma2:2b', size: 1600000000, family: 'gemma' },
        { name: 'phi3:latest', size: 2200000000, family: 'phi' },
      ]);
      setDetectStatus('connected');
    } else {
      handleTestOllama(ollamaConfig.endpoint).catch(() => {});
    }
  }, []);

  const handleConfigChange = (key: keyof OllamaConfig, value: any) => {
    const updated = { ...ollamaConfig, [key]: value };
    setOllamaConfigState(updated);
    setOllamaConfig(updated);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header className="mb-8 border-b border-white/10 pb-6">
        <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">Configuration</h2>
        <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-2">Manage rulesets, thresholds, and swarm parameters.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingSection 
          icon={<Cpu size={20} className="text-emerald-500"/>}
          title="Local CPU Core (Ollama)"
          description="Leverage local open-source LLMs on your physical hardware."
        >
          <div className="space-y-4 pt-2 text-xs font-mono">
            <div>
              <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-2">Preferred AI Core</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleConfigChange('preferredProvider', 'ollama')}
                  className={`p-3 border font-bold text-center transition-all ${
                    ollamaConfig.preferredProvider === 'ollama'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                      : 'bg-[#1A221E] border-white/10 text-white/40 hover:text-white'
                  }`}
                >
                  LOCAL CPU (CORE)
                </button>
                <button
                  type="button"
                  onClick={() => handleConfigChange('preferredProvider', 'gemini')}
                  className={`p-3 border font-bold text-center transition-all ${
                    ollamaConfig.preferredProvider === 'gemini'
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                      : 'bg-[#1A221E] border-white/10 text-white/40 hover:text-white'
                  }`}
                >
                  GEMINI (FALLBACK)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-2">Execution Environment</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleConfigChange('simulate', true);
                    setLocalModels([
                      { name: 'llama3.2:latest', size: 2020000000, family: 'llama' },
                      { name: 'qwen2.5:1.5b', size: 980000000, family: 'qwen' },
                      { name: 'gemma2:2b', size: 1600000000, family: 'gemma' },
                      { name: 'phi3:latest', size: 2200000000, family: 'phi' },
                    ]);
                    setDetectStatus('connected');
                  }}
                  className={`p-3 border font-bold text-center transition-all ${
                    ollamaConfig.simulate
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                      : 'bg-[#1A221E] border-white/10 text-white/40 hover:text-white'
                  }`}
                >
                  SIMULATION CORES
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleConfigChange('simulate', false);
                    setLocalModels([]);
                    handleTestOllama(ollamaConfig.endpoint, true);
                  }}
                  className={`p-3 border font-bold text-center transition-all ${
                    !ollamaConfig.simulate
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                      : 'bg-[#1A221E] border-white/10 text-white/40 hover:text-white'
                  }`}
                >
                  REAL HARDWARE
                </button>
              </div>
              <p className="text-[10px] text-white/40 mt-1.5 font-sans leading-relaxed">
                Choose **Simulation Cores** to test full tool calling, model hot-swapping, and edge execution immediately. Choose **Real Hardware** to connect directly to your local computer's physical Ollama server.
              </p>
            </div>

            {!ollamaConfig.simulate && (
              <>
                <div>
                  <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-1">Local Ollama Endpoint</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ollamaConfig.endpoint}
                      onChange={(e) => handleConfigChange('endpoint', e.target.value)}
                      placeholder="http://127.0.0.1:11434"
                      className="flex-1 bg-[#1A221E] border border-white/10 text-white p-2 outline-none focus:border-emerald-500 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => handleTestOllama()}
                      disabled={detectStatus === 'detecting'}
                      className="bg-[#1A221E] border border-white/10 px-3 hover:bg-white/5 text-emerald-500 flex items-center justify-center transition-colors"
                      title="Test connection and load models"
                    >
                      <RefreshCw size={14} className={detectStatus === 'detecting' ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-1">Selected Model</label>
                  {localModels.length > 0 ? (
                    <select
                      value={ollamaConfig.model}
                      onChange={(e) => handleConfigChange('model', e.target.value)}
                      className="w-full bg-[#1A221E] border border-white/10 text-white p-2.5 outline-none focus:border-emerald-500 font-mono text-xs"
                    >
                      {localModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} ({m.family || 'LLM'})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ollamaConfig.model}
                        onChange={(e) => handleConfigChange('model', e.target.value)}
                        placeholder="llama3.2"
                        className="w-full bg-[#1A221E] border border-white/10 text-white p-2.5 outline-none focus:border-emerald-500 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {ollamaConfig.simulate && (
              <div>
                <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-1">Active Simulated Core</label>
                <select
                  value={ollamaConfig.model}
                  onChange={(e) => handleConfigChange('model', e.target.value)}
                  className="w-full bg-[#1A221E] border border-white/10 text-white p-2.5 outline-none focus:border-emerald-500 font-mono text-xs"
                >
                  <option value="llama3.2">llama3.2:latest (Llama 3 3B - Balanced)</option>
                  <option value="qwen2.5">qwen2.5:1.5b (Qwen 1.5B - High Speed)</option>
                  <option value="phi3">phi3:latest (Phi-3 3.8B - Reasoning)</option>
                  <option value="gemma2">gemma2:2b (Gemma 2 2B - Creative)</option>
                </select>
              </div>
            )}

            {/* Status Pills */}
            <div className="pt-2">
              {detectStatus === 'connected' && (
                <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 p-2.5">
                  <CheckCircle size={16} />
                  <div>
                    <p className="font-bold uppercase tracking-wider text-[9px]">
                      {ollamaConfig.simulate ? "SIMULATED CORES ACTIVE" : "Ollama CPU Detected"}
                    </p>
                    <p className="text-[10px] text-white/60 font-sans mt-0.5">
                      {ollamaConfig.simulate 
                        ? `Loaded 4 high-speed sandbox LLM models in the browser container.`
                        : `Found ${localModels.length} offline model(s) ready for zero-latency local execution.`}
                    </p>
                  </div>
                </div>
              )}

              {detectStatus === 'failed' && !ollamaConfig.simulate && (
                <div className="space-y-4">
                  <div className="flex items-start gap-2 text-amber-500 bg-amber-500/5 border border-amber-500/20 p-2.5">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold uppercase tracking-wider text-[9px]">Ollama Core Unreachable</p>
                      <p className="text-[10px] text-white/60 font-sans mt-0.5 leading-relaxed">
                        The applet is running inside a secure sandbox, so your browser blocks loopback connections unless Ollama is started with full CORS access.
                      </p>
                    </div>
                  </div>

                  <div className="bg-[#121815] border border-white/5 p-4 space-y-3">
                    <p className="text-[10px] font-bold text-white uppercase tracking-wider">Troubleshooting Steps</p>
                    
                    <div className="space-y-2">
                      <p className="text-[9px] text-emerald-400 font-bold uppercase">1. Stop running instances</p>
                      <p className="text-[10px] text-white/60 font-sans">Exit the Ollama app from your system tray or taskbar fully.</p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[9px] text-emerald-400 font-bold uppercase">2. Start Ollama with CORS origins enabled</p>
                      
                      <div className="space-y-1">
                        <p className="text-[9px] text-white/40 uppercase font-mono">macOS / Linux Terminal:</p>
                        <pre className="bg-[#0A0F0D] p-2 text-[9px] text-emerald-500 border border-white/5 overflow-x-auto">
                          OLLAMA_ORIGINS="*" ollama serve
                        </pre>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[9px] text-white/40 uppercase font-mono">Windows Cmd Prompt:</p>
                        <pre className="bg-[#0A0F0D] p-2 text-[9px] text-emerald-500 border border-white/5 overflow-x-auto">
                          set OLLAMA_ORIGINS=*<br />
                          ollama serve
                        </pre>
                      </div>
                    </div>

                    <p className="text-[9px] text-white/40 font-sans mt-1">
                      Once running, hit the green refresh icon above. Alternatively, switch to **Simulation Cores** above to test with zero configuration!
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SettingSection>

        <SettingSection 
          icon={<Scale size={20} className="text-emerald-500"/>}
          title="Compliance Thresholds"
          description="Global configuration for agent evaluation logic."
        >
          <div className="space-y-4 pt-2">
             <div>
               <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-2">Total THC Formula</label>
               <select className="w-full bg-[#1A221E] border border-white/10 rounded-none text-sm p-3 text-white font-mono outline-none focus:border-emerald-500 transition-colors">
                 <option>(THCa × 0.877) + Δ9-THC</option>
                 <option>Δ9-THC Only (Legacy)</option>
               </select>
             </div>
             <div>
               <label className="block text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-2">Enforced Limit Dry Weight</label>
               <div className="flex items-center gap-2">
                 <input type="number" defaultValue={0.3} step={0.1} className="w-24 bg-[#1A221E] border border-white/10 rounded-none text-sm p-3 font-mono text-white outline-none focus:border-emerald-500 transition-colors" />
                 <span className="text-xs font-mono text-white/40">%</span>
               </div>
             </div>
          </div>
        </SettingSection>

        <SettingSection 
          icon={<Sliders size={20} className="text-emerald-500"/>}
          title="Agent Confidence"
          description="Controls when human escalation is required."
        >
          <div className="space-y-4 pt-2">
            <div>
              <label className="flex justify-between text-[10px] font-bold text-emerald-500 tracking-[0.2em] uppercase mb-2">
                <span>OCR Extract Confidence</span>
                <span className="text-emerald-400">85%</span>
              </label>
              <input type="range" min="50" max="99" defaultValue="85" className="w-full accent-emerald-500" />
            </div>
            <div className="pt-2 flex items-center gap-2">
              <input type="checkbox" id="escalate" defaultChecked className="rounded-none text-emerald-500 bg-[#1A221E] border-white/10 focus:ring-emerald-500 focus:ring-offset-0" />
              <label htmlFor="escalate" className="text-xs font-mono text-slate-300">Require human review for 'At Risk' findings</label>
            </div>
          </div>
        </SettingSection>

        <SettingSection 
          icon={<Database size={20} className="text-emerald-500"/>}
          title="OCR & Intake Strategy"
          description="Manage document classification and processing pipelines."
        >
          <ul className="space-y-4 pt-2 text-xs font-mono text-slate-300">
            <li>
              <label className="text-[10px] text-emerald-500 uppercase tracking-widest font-bold mb-1 block">Default Text Recognizer</label>
              <select className="bg-[#1A221E] border border-white/10 text-white w-full p-2 outline-none focus:border-emerald-500">
                <option>Marker + Layout VLM (High Accuracy)</option>
                <option>PaddleOCR (Fast structure)</option>
                <option>Tesseract (Legacy/Fallback)</option>
              </select>
            </li>
            <li>
              <label className="text-[10px] text-emerald-500 uppercase tracking-widest font-bold mb-1 block">Validation Strictness</label>
              <select className="bg-[#1A221E] border border-white/10 text-white w-full p-2 outline-none focus:border-emerald-500">
                <option>Enforce Physical Constraints (Sum ≤ 100%)</option>
                <option>Loose (Allow Minor Calibration Error)</option>
              </select>
            </li>
          </ul>
        </SettingSection>

        <SettingSection 
           icon={<ShieldAlert size={20} className="text-emerald-500"/>}
           title="Legal Disclaimers"
           description="HempForge operates via open-source tools."
        >
          <div className="pt-2 text-xs text-amber-500/80 font-mono leading-relaxed bg-amber-500/5 border border-amber-500/20 p-4 rounded-none">
            [WARNING] Agentic recommendations are for research and informational purposes only. Do not interpret findings as formal legal advice. Algorithms cannot replace certified laboratory testing or legal counsel in your respective jurisdiction.
          </div>
        </SettingSection>
      </div>
    </div>
  );
}

function SettingSection({ icon, title, description, children }: { icon: React.ReactNode, title: string, description: string, children: React.ReactNode }) {
  return (
    <div className="bg-[#0D1411] border border-white/10 p-6 flex flex-col">
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <h3 className="font-bold text-white tracking-tight italic text-lg">{title}</h3>
      </div>
      <p className="text-[10px] uppercase font-mono text-white/40 tracking-widest mb-6">{description}</p>
      {children}
    </div>
  )
}
