import React from 'react';
import { Database, Network, Search, TextSelect, History } from 'lucide-react';

export default function Vault() {
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="mb-8 border-b border-white/10 pb-6">
        <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">Knowledge Vault</h2>
        <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-2">Semantic memory, structured tables, and graph inference.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Knowledge Graph Card */}
        <div className="col-span-1 lg:col-span-2 bg-[#0D1411] border border-white/10 p-6 flex flex-col min-h-[400px]">
          <div className="flex justify-between items-start mb-6">
            <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2">
              <Network size={14} className="text-emerald-500"/>
              Cannabis Knowledge Graph
            </h3>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-none font-bold uppercase tracking-widest">Live</span>
          </div>
          
          <div className="flex-1 bg-[#1A221E] border border-white/10 relative overflow-hidden flex items-center justify-center p-4">
            {/* Abstract representation of the graph using Geometric Balance themes */}
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
            
            <div className="relative w-full h-full">
              {/* Nodes and Edges representation */}
              <div className="absolute top-1/4 left-1/4 w-32 bg-[#0D1411] border-l-2 border-amber-500 p-2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="text-[10px] text-white/40 font-mono uppercase">Cultivar</div>
                <div className="text-xs font-bold text-white">Sour Space Candy</div>
              </div>
              
              <div className="absolute top-[60%] left-[20%] w-28 bg-[#0D1411] border-l-2 border-purple-500 p-2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="text-[10px] text-white/40 font-mono uppercase">Terpene</div>
                <div className="text-xs font-bold text-white">Myrcene</div>
              </div>

              <div className="absolute top-1/3 left-2/3 w-28 bg-[#0D1411] border-l-2 border-emerald-500 p-2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="text-[10px] text-white/40 font-mono uppercase">Cannabinoid</div>
                <div className="text-xs font-bold text-white">THCa</div>
              </div>

              <div className="absolute top-[70%] left-[75%] w-28 bg-[#0D1411] border-l-2 border-red-500 p-2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="text-[10px] text-white/40 font-mono uppercase">Cannabinoid</div>
                <div className="text-xs font-bold text-white">Δ9-THC</div>
              </div>

              {/* Edges - absolute positioning for lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <line x1="25%" y1="25%" x2="20%" y2="60%" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4"/>
                <text x="18%" y="42%" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace" transform="rotate(-70, 22%, 42%)">EXPRESSES</text>
                
                <line x1="25%" y1="25%" x2="66%" y2="33%" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4"/>
                <text x="45%" y="27%" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace" transform="rotate(10, 45%, 27%)">SYNTHESIZES</text>

                <line x1="66%" y1="33%" x2="75%" y2="70%" stroke="#10b981" strokeWidth="2" strokeDasharray="4" className="animate-pulse"/>
                <text x="73%" y="50%" fill="#10b981" fontSize="8" fontFamily="monospace" transform="rotate(75, 73%, 50%)">CONVERTS_TO (decarb: 0.877)</text>
              </svg>
            </div>
          </div>
          <div className="mt-4 flex gap-4 text-[10px] font-mono">
            <span className="text-white/40">Entities: <span className="text-white font-bold">14,204</span></span>
            <span className="text-white/40">Edges: <span className="text-white font-bold">89,112</span></span>
          </div>
        </div>

        {/* Vector Store & RAG Card */}
        <div className="space-y-6">
          <div className="bg-[#0D1411] border border-white/10 p-6 flex flex-col">
            <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
              <Database size={14} className="text-emerald-500"/>
              Vector Store (RAG)
            </h3>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">Embeddings generated for semantic search retrieval against regulatory documents, literature, and COAs.</p>
            
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between border-b border-white/5 py-2">
                <span className="text-white/60">Federal Register Rules</span>
                <span className="text-emerald-400">1.2M tokens</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-2">
                <span className="text-white/60">Research Papers</span>
                <span className="text-emerald-400">4.5M tokens</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-white/60">State Testing Guidelines</span>
                <span className="text-emerald-400">850K tokens</span>
              </div>
            </div>
            
            <div className="mt-4 relative flex items-center">
              <input type="text" placeholder="Query semantic space..." className="w-full bg-[#1A221E] border border-white/10 p-3 text-white text-xs font-mono focus:outline-none focus:border-emerald-500 pr-10" />
              <Search size={14} className="absolute right-3 text-white/40" />
            </div>
          </div>

          {/* Episodic Log Card */}
          <div className="bg-[#0D1411] border border-white/10 p-6 flex flex-col">
            <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
              <History size={14} className="text-emerald-500"/>
              Agent Episodic Log
            </h3>
            <div className="space-y-3">
              <div className="p-3 bg-white/5 border-l-2 border-emerald-500">
                <div className="text-[10px] text-white/40 font-mono mb-1">TRACE: 7A9-B21</div>
                <p className="text-xs text-white leading-tight">Decarb rule application debated between ChemAgent and RegAgent. Consistently defaulted to 0.877 standard conversion.</p>
              </div>
              <div className="p-3 bg-white/5 border-l-2 border-amber-500">
                <div className="text-[10px] text-white/40 font-mono mb-1">TRACE: 7A9-B20</div>
                <p className="text-xs text-white leading-tight">Flagged anomaly in lab result B-8803. THCa to THC ratio biologically improbable for specified cultivar.</p>
              </div>
            </div>
            <button className="mt-4 text-[10px] uppercase font-mono text-emerald-500 hover:text-emerald-400 text-left">View full trace logs →</button>
          </div>
        </div>
        
        {/* Relational Tables */}
        <div className="col-span-1 lg:col-span-3 bg-[#0D1411] border border-white/10 p-6">
          <h3 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] flex items-center gap-2 mb-6">
            <TextSelect size={14} className="text-emerald-500"/>
            Relational Store (Structured Entities)
          </h3>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            <button className="bg-[#1A221E] px-4 py-2 border-b-2 border-emerald-500 text-xs font-mono text-emerald-400 uppercase tracking-widest whitespace-nowrap">core_coa_results</button>
            <button className="bg-transparent px-4 py-2 text-xs font-mono text-white/40 uppercase tracking-widest hover:bg-white/5 whitespace-nowrap">cultivation_params</button>
            <button className="bg-transparent px-4 py-2 text-xs font-mono text-white/40 uppercase tracking-widest hover:bg-white/5 whitespace-nowrap">extraction_yields</button>
            <button className="bg-transparent px-4 py-2 text-xs font-mono text-white/40 uppercase tracking-widest hover:bg-white/5 whitespace-nowrap">lab_metadata</button>
          </div>
          <div className="overflow-x-auto border border-white/10">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#1A221E]">
                <tr>
                  <th className="p-3 text-white/40 uppercase font-bold tracking-widest">batch_id</th>
                  <th className="p-3 text-white/40 uppercase font-bold tracking-widest">sample_matrix</th>
                  <th className="p-3 text-white/40 uppercase font-bold tracking-widest">thca_pct</th>
                  <th className="p-3 text-white/40 uppercase font-bold tracking-widest">d9_pct</th>
                  <th className="p-3 text-white/40 uppercase font-bold tracking-widest">total_thc</th>
                  <th className="p-3 text-white/40 uppercase font-bold tracking-widest">source_uri</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-white/5 text-slate-300">
                <tr className="hover:bg-white/10">
                  <td className="p-3">B-8802</td>
                  <td className="p-3">Flower</td>
                  <td className="p-3 text-emerald-400">0.150</td>
                  <td className="p-3 text-emerald-400">0.050</td>
                  <td className="p-3 font-bold">0.181</td>
                  <td className="p-3 text-blue-400 hover:underline cursor-pointer">s3://bucket/coa_b8802.pdf</td>
                </tr>
                <tr className="hover:bg-white/10">
                  <td className="p-3">B-8803</td>
                  <td className="p-3">Flower</td>
                  <td className="p-3 text-emerald-400">0.850</td>
                  <td className="p-3 text-emerald-400">0.080</td>
                  <td className="p-3 font-bold text-red-400">0.825</td>
                  <td className="p-3 text-blue-400 hover:underline cursor-pointer">s3://bucket/coa_b8803.pdf</td>
                </tr>
                <tr className="hover:bg-white/10">
                  <td className="p-3">EX-101</td>
                  <td className="p-3">Crude Extract</td>
                  <td className="p-3 text-emerald-400">12.50</td>
                  <td className="p-3 text-emerald-400">2.100</td>
                  <td className="p-3 font-bold text-red-400">13.06</td>
                  <td className="p-3 text-blue-400 hover:underline cursor-pointer">s3://bucket/ext_101.pdf</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
