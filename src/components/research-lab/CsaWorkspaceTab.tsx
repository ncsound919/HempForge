import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, Lock, FileCheck2, FileText, Image as ImageIcon } from 'lucide-react';
import { authFetch } from '../../lib/firebase';
import { usePipeline } from '../../contexts/PipelineContext';

export default function CsaWorkspaceTab({ onNavigateToTab }: { onNavigateToTab?: (tab: string) => void }) {
  const [csaRuns, setCsaRuns] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [securityPolicy, setSecurityPolicy] = useState<any>(null);
  const [isLoadingCsa, setIsLoadingCsa] = useState(false);
  const [isVerifyingCsa, setIsVerifyingCsa] = useState(false);

  const { setPipelineStrain, setPipelineStep, setDraftTemplateType, setAllPapers, setSelectedPaperEntity } = usePipeline();

  const handleDraftBrief = (run: any) => {
    setPipelineStrain(`CSA Validation: ${run.agentName} ${run.runId}`);
    setDraftTemplateType('Regulatory Compliance Brief');
    setPipelineStep(3);
    if (onNavigateToTab) onNavigateToTab('pipeline');
  };

  const handleCreateFlyer = (run: any) => {
    const simPaper = {
      id: `doc-csa-${Date.now()}`,
      name: `csa_report_${run.runId}.pdf`,
      path: '/Simulations/',
      size: '210 KB',
      type: 'pdf' as const,
      uploadDate: new Date().toISOString().split('T')[0],
      title: `CSA Validation: ${run.agentName} ${run.runId}`,
      journal: 'Quality Assurance Ledger',
      year: new Date().getFullYear(),
      authors: run.verifiedBy || 'System Auditor',
      abstract: `Validation Scenario: ${run.testScenario}. Run status: ${run.status}. Risk Rating: ${run.riskRating}.`,
      compounds: ['Compliance', 'GxP'],
      dosage: 'N/A',
      outcomes: `Verified on ${new Date(run.validatedAt).toLocaleString()}`
    };

    setAllPapers(prev => [simPaper, ...prev]);
    setSelectedPaperEntity(simPaper);

    setPipelineStrain(`CSA Validation: ${run.agentName} ${run.runId}`);
    setPipelineStep(4);
    if (onNavigateToTab) onNavigateToTab('flyers');
  };

  const fetchCsaAndAuditData = async () => {
    setIsLoadingCsa(true);
    try {
      const [runsRes, logsRes, policyRes] = await Promise.all([
        authFetch('/api/csa/runs'),
        authFetch('/api/audit/logs'),
        authFetch('/api/security/policy')
      ]);
      if (runsRes.ok) setCsaRuns(await runsRes.json());
      if (logsRes.ok) setAuditLogs(await logsRes.json());
      if (policyRes.ok) setSecurityPolicy(await policyRes.json());
    } catch (e) {
      console.error('Error fetching CSA data:', e);
    } finally {
      setIsLoadingCsa(false);
    }
  };

  useEffect(() => {
    fetchCsaAndAuditData();
  }, []);

  const handleTriggerCsaVerify = async () => {
    setIsVerifyingCsa(true);
    try {
      const res = await authFetch('/api/csa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Compliance Agent',
          version: 'v2.0.1',
          riskRating: 'High',
          testScenario: 'Validate upcoming 0.4mg serving caps and strict 0.3% dry weight total THC rules.'
        })
      });
      if (res.ok) {
        await fetchCsaAndAuditData();
        alert('CSA Verification Handshake Successful. FDA/CSA validation run recorded and signed.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsVerifyingCsa(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: CSA Validation Runs */}
        <div className="col-span-2 bg-[#0D1411] border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={16} /> FDA CSA & GxP Model Validation Runs
              </h3>
              <button onClick={fetchCsaAndAuditData} className="text-white/40 hover:text-white transition-colors">
                <RefreshCw size={14} className={isLoadingCsa ? "animate-spin" : ""} />
              </button>
            </div>
            <p className="text-xs text-white/60 mb-6 leading-relaxed">
              In compliance with the FDA's Computer Software Assurance (CSA) draft guidance, every automated decision-support model (e.g., automated threshold fail audits) must undergo structured performance testing vs static baselines.
            </p>

            <div className="space-y-4">
              {csaRuns.map(run => (
                <div key={run.runId} className="p-4 bg-[#1A221E] border border-white/5 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">{run.agentName} ({run.version})</h4>
                      <p className="text-[10px] text-emerald-400 font-mono">ID: {run.runId} • Risk: <span className="font-bold underline">{run.riskRating}</span></p>
                    </div>
                    <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 border border-emerald-500/30 font-mono">
                      {run.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-mono">{run.intendedUse}</p>
                  <div className="text-[11px] text-white/40 leading-normal border-t border-white/5 pt-2 font-mono">
                    <span className="text-emerald-500 font-bold">Verification Scenario:</span> {run.testScenario}
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <div className="flex gap-4 text-[10px] text-white/30 font-mono">
                      <span>Verified: {new Date(run.validatedAt).toLocaleString()}</span>
                      <span>Auditor: {run.verifiedBy}</span>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleDraftBrief(run)}
                        className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-1 border border-emerald-500/30 flex items-center gap-1"
                      >
                        <FileText size={10} /> Draft Brief
                      </button>
                      <button 
                        onClick={() => handleCreateFlyer(run)}
                        className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-1 border border-emerald-500/30 flex items-center gap-1"
                      >
                        <ImageIcon size={10} /> Flyer
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-white/10 pt-4">
            <button 
              onClick={handleTriggerCsaVerify}
              disabled={isVerifyingCsa}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] py-3 text-xs font-bold font-mono uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
            >
              {isVerifyingCsa ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Executing CSA Validation Tests...
                </>
              ) : (
                <>
                  Execute CSA Verification Handshake
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Security, Privacy, and Incident SOP mapping */}
        <div className="col-span-1 space-y-6">
          {securityPolicy && (
            <div className="bg-[#0D1411] border border-white/10 p-6 space-y-6">
              <div>
                <h3 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Lock size={14} /> SaaS Security Framework
                </h3>
                <ul className="text-xs font-mono text-slate-300 space-y-2">
                  <li className="flex justify-between border-b border-white/5 py-1">
                    <span className="text-white/40">Governance</span>
                    <span className="text-white">{securityPolicy.governanceModel}</span>
                  </li>
                  <li className="flex justify-between border-b border-white/5 py-1">
                    <span className="text-white/40">Encryption (At Rest)</span>
                    <span className="text-white">{securityPolicy.encryptionAtRest}</span>
                  </li>
                  <li className="flex justify-between py-1">
                    <span className="text-white/40">Encryption (Transit)</span>
                    <span className="text-white">{securityPolicy.encryptionInTransit}</span>
                  </li>
                </ul>
              </div>

              <div className="border-t border-white/5 pt-4">
                <h3 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest mb-2">
                  Disaster Recovery & Incident SOP
                </h3>
                <p className="text-[11px] text-white/50 leading-relaxed mb-3">
                  Complying with federal security standards and State Attorney General rules.
                </p>
                <ul className="text-xs font-mono text-slate-300 space-y-2">
                  <li className="flex justify-between border-b border-white/5 py-1">
                    <span className="text-white/40">Disaster RTO</span>
                    <span className="text-white font-bold">{securityPolicy.incidentResponsePlan.disasterRecoveryRTO}</span>
                  </li>
                  <li className="flex justify-between border-b border-white/5 py-1">
                    <span className="text-white/40">Disaster RPO</span>
                    <span className="text-white font-bold">{securityPolicy.incidentResponsePlan.disasterRecoveryRPO}</span>
                  </li>
                </ul>
                <div className="mt-3 bg-red-500/10 border border-red-500/20 p-3 text-[10px] text-red-400 font-mono leading-normal">
                  <span className="font-bold block uppercase mb-1">Breach SOP:</span>
                  {securityPolicy.incidentResponsePlan.breachNotificationSOP}
                </div>
              </div>

              <div className="border-t border-white/5 pt-4">
                <h3 className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest mb-2">
                  Data Privacy Mapping
                </h3>
                <div className="space-y-2 text-[11px] text-slate-300 font-mono">
                  <div className="bg-[#1A221E] p-2.5 border border-white/5">
                    <span className="text-white/40 uppercase text-[9px] block">Rights Supported (CCPA)</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {securityPolicy.privacyDataInventory.ccpaRightsHandled.map((r: string) => (
                        <span key={r} className="bg-white/5 border border-white/10 px-1.5 py-0.5 text-[8px] text-emerald-400 uppercase">{r}</span>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-white/40 leading-snug">
                    <span className="text-emerald-400 font-bold">Minimization Rule:</span> {securityPolicy.privacyDataInventory.dataMinimizationRule}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: ALCOA++ Audit Trail Logs list */}
      <div className="bg-[#0D1411] border border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-[#1A221E]">
          <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
            <FileCheck2 size={16} /> ALCOA++ Compliance Audit Ledger (System-Wide Logs)
          </h3>
          <div className="text-[10px] font-mono text-emerald-400 uppercase bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5">
            Cryptographic Hashing Enabled
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-white/50 text-[10px] uppercase tracking-wider">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">User / Identity</th>
                <th className="px-4 py-3">Role / Scoping</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Action Completed</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">SHA-256 Checksum Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {auditLogs.map(log => (
                <tr key={log.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-white/40 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3 text-white font-bold">{log.userId}</td>
                  <td className="px-4 py-3 text-emerald-400/80">{log.userRole}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                      log.category === 'COMPLIANCE_ALARM' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                      log.category === 'AI_INFERENCE' ? 'bg-purple-500/15 text-purple-400 border-purple-500/20' :
                      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}>
                      {log.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold text-white whitespace-nowrap">{log.action}</td>
                  <td className="px-4 py-3 text-slate-300 min-w-[200px] leading-tight text-[11px]">{log.details}</td>
                  <td className="px-4 py-3">
                    <div className="text-[9px] text-white/30 truncate w-28 group relative cursor-pointer hover:text-emerald-400">
                      {log.hash}
                      <span className="absolute bottom-full left-0 hidden group-hover:block bg-[#0A0F0D] text-white p-2 border border-white/10 text-[8px] z-50 w-64 break-all">
                        Signed verification hash: {log.hash}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
