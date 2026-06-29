import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  ShieldAlert,
  Award,
  CheckCircle,
  Printer,
  ArrowLeft,
  Calendar,
  Hash,
  Info,
  AlertTriangle,
  Copy,
} from 'lucide-react';

interface PublicCOAVerifierProps {
  coaId: string;
  onBackToApp?: () => void;
}

interface VerifiedCoa {
  id: string;
  batchId: string;
  strain: string;
  uploadDate?: string;
  certificationDate?: string;
  thca: number;
  d9thc: number;
  totalThc: number;
  status: 'Compliant' | 'At Risk' | 'Non-Compliant' | string;
  labName?: string;
  labCertificateNumber?: string;
  certifiedBy?: string;
  complianceSignature?: string;
  signatureMatches?: boolean;
  verifiedAt?: string;
  verificationStatus?: 'VERIFIED_VALID' | 'SIGNATURE_CORRUPTED' | string;
  disclaimer?: string;
  recommendation?: string;
}

function fmtPct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(3)}%` : '—';
}

function fmtDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export default function PublicCOAVerifier({
  coaId,
  onBackToApp,
}: PublicCOAVerifierProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coa, setCoa] = useState<VerifiedCoa | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/coas/verify/${encodeURIComponent(coaId)}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        const contentType = res.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
          ? await res.json()
          : null;

        if (!res.ok) {
          throw new Error(
            payload?.details ||
              payload?.error ||
              'This certificate is not registered in the public GxP compliance ledger.'
          );
        }

        setCoa(payload);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(
            err?.message ||
              'Failed to fetch the requested compliance certificate.'
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => controller.abort();
  }, [coaId]);

  const verifyUrl = useMemo(() => {
    if (!coa?.id) return '';
    return `${window.location.origin}/verify/${encodeURIComponent(coa.id)}`;
  }, [coa?.id]);

  useEffect(() => {
    async function buildQr() {
      if (!verifyUrl) {
        setQrDataUrl('');
        return;
      }

      try {
        const url = await QRCode.toDataURL(verifyUrl, {
          width: 180,
          margin: 1,
          color: {
            dark: '#111827',
            light: '#FFFFFF',
          },
        });
        setQrDataUrl(url);
      } catch {
        setQrDataUrl('');
      }
    }

    buildQr();
  }, [verifyUrl]);

  const handlePrint = () => window.print();

  const copySignature = async () => {
    if (!coa?.complianceSignature) return;
    try {
      await navigator.clipboard.writeText(coa.complianceSignature);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0F0D] flex flex-col items-center justify-center p-6 text-slate-200">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
          Verifying cryptographic ledger record...
        </p>
      </div>
    );
  }

  if (error || !coa) {
    return (
      <div className="min-h-screen bg-[#0A0F0D] flex items-center justify-center p-6 text-slate-200">
        <div className="max-w-md w-full bg-[#121A16] border border-red-500/30 p-8 text-center space-y-5">
          <ShieldAlert className="mx-auto text-red-500" size={48} />
          <h2 className="text-xl font-bold text-white uppercase tracking-tight">
            Ledger Registry Failure
          </h2>
          <p className="text-xs text-white/60 leading-relaxed font-mono">
            {error || 'The specified Certificate ID could not be loaded.'}
          </p>
          {onBackToApp && (
            <button
              onClick={onBackToApp}
              className="w-full bg-white/5 hover:bg-white/10 text-white font-mono font-bold text-xs uppercase py-2.5 tracking-wider transition-colors"
            >
              Go to Portal Login
            </button>
          )}
        </div>
      </div>
    );
  }

  const verificationOk =
    coa.signatureMatches === true &&
    coa.verificationStatus === 'VERIFIED_VALID';

  const complianceTone =
    coa.status === 'Compliant'
      ? 'emerald'
      : coa.status === 'At Risk'
      ? 'amber'
      : 'red';

  return (
    <div className="min-h-screen bg-[#0A0F0D] text-slate-200 py-12 px-4 sm:px-6 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[400px] bg-emerald-500/5 blur-[120px] pointer-events-none rounded-full" />

      <div className="max-w-4xl mx-auto flex justify-between items-center mb-8 print:hidden">
        {onBackToApp ? (
          <button
            onClick={onBackToApp}
            className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} /> Back to Portal
          </button>
        ) : (
          <div />
        )}

        <button
          onClick={handlePrint}
          className="bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D] font-mono font-bold text-xs uppercase px-4 py-2 flex items-center gap-2 tracking-wider transition-all"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-4xl mx-auto bg-[#0E1512] border-4 border-[#1D2923] p-8 sm:p-12 relative overflow-hidden print:bg-white print:text-slate-900 print:border-slate-800 print:p-8 shadow-2xl">
        <div className="absolute inset-2 border border-emerald-500/20 pointer-events-none print:border-slate-300" />
        <div className="absolute inset-4 border border-emerald-500/5 pointer-events-none print:border-slate-100" />

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-[0.02] print:opacity-[0.03]">
          <Award size={600} className="text-emerald-500 print:text-slate-900" />
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-6 mb-8 print:border-slate-200 relative z-10">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight italic flex items-center gap-2 print:text-slate-900">
              <Award className="text-emerald-400 print:text-slate-800" size={26} />
              HEMPFORGE DIGITAL COA REGISTRY
            </h1>
            <p className="text-[10px] font-mono text-emerald-400/80 uppercase tracking-widest mt-1 print:text-slate-600">
              GxP Secure Cryptographic Verification System
            </p>
          </div>

          <div
            className={`mt-4 md:mt-0 px-3 py-1.5 border font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5
            ${
              verificationOk
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 print:bg-slate-100 print:text-slate-800 print:border-slate-300'
                : 'bg-red-500/10 border-red-500/30 text-red-400 print:bg-slate-100 print:text-slate-800 print:border-slate-300'
            }`}
          >
            {verificationOk ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
            Registry Match: {coa.verificationStatus || 'UNKNOWN'}
          </div>
        </div>

        <div className="text-center space-y-2 mb-10 relative z-10">
          <h2 className="text-xs uppercase font-mono tracking-[0.2em] text-emerald-400/80 print:text-slate-600">
            Official Certificate of Chemical Compliance
          </h2>
          <p className="text-3xl font-bold tracking-tight text-white print:text-slate-900">
            Hemp Cultivar: {coa.strain || 'Unknown'}
          </p>
          <div className="w-16 h-0.5 bg-emerald-500 mx-auto mt-4 print:bg-slate-800" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10 relative z-10">
          <div className="md:col-span-2 space-y-6">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 print:text-slate-800 border-b border-white/5 pb-2 print:border-slate-200">
              Laboratory Dry-Weight Chromatography Data
            </h3>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[#141E19] border border-white/5 p-4 text-center print:bg-slate-50 print:border-slate-200">
                <span className="block text-[10px] font-mono uppercase text-white/40 print:text-slate-500">
                  THCa %
                </span>
                <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 print:text-slate-800">
                  {fmtPct(coa.thca)}
                </span>
              </div>

              <div className="bg-[#141E19] border border-white/5 p-4 text-center print:bg-slate-50 print:border-slate-200">
                <span className="block text-[10px] font-mono uppercase text-white/40 print:text-slate-500">
                  Δ9-THC %
                </span>
                <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 print:text-slate-800">
                  {fmtPct(coa.d9thc)}
                </span>
              </div>

              <div className="bg-[#141E19] border border-emerald-500/20 p-4 text-center print:bg-slate-100 print:border-slate-300">
                <span className="block text-[10px] font-mono uppercase text-emerald-400 print:text-slate-600 font-bold">
                  Total THC %
                </span>
                <span className="text-xl sm:text-2xl font-bold font-mono text-white print:text-slate-900">
                  {fmtPct(coa.totalThc)}
                </span>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 p-4 font-mono text-[10px] leading-relaxed text-white/60 print:bg-slate-50 print:text-slate-600 print:border-slate-200">
              <div className="flex items-start gap-2">
                <Info size={14} className="text-emerald-400 shrink-0 mt-0.5 print:text-slate-800" />
                <div>
                  <span className="font-bold text-white print:text-slate-800">
                    State regulatory formula:
                  </span>{' '}
                  Total THC = (THCa × 0.877) + Δ9-THC.
                </div>
              </div>
            </div>

            <div className="space-y-3 font-mono text-xs text-white/60 print:text-slate-700">
              <Row label="Batch Identifier" value={coa.batchId} />
              <Row label="Certification Date" value={fmtDate(coa.certificationDate || coa.uploadDate)} />
              <Row label="Accredited Laboratory" value={coa.labName || 'Unknown lab'} />
              <Row label="Lab ISO Certificate" value={coa.labCertificateNumber || '—'} />
              <Row label="Verified Timestamp" value={fmtDate(coa.verifiedAt)} />
            </div>
          </div>

          <div className="flex flex-col items-center justify-between border-l border-white/10 pl-0 md:pl-8 border-t border-t-white/10 pt-8 md:pt-0 md:border-t-0 print:border-slate-200">
            <div className="text-center w-full">
              <span className="block text-[10px] font-mono uppercase text-white/40 mb-3 print:text-slate-500">
                Regulatory Audit Status
              </span>

              <div
                className={`p-6 border flex flex-col items-center justify-center space-y-2 ${
                  complianceTone === 'emerald'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 print:bg-emerald-50 print:text-emerald-800 print:border-emerald-200'
                    : complianceTone === 'amber'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 print:bg-amber-50 print:text-amber-800 print:border-amber-200'
                    : 'bg-red-500/10 border-red-500/30 text-red-400 print:bg-red-50 print:text-red-800 print:border-red-200'
                }`}
              >
                {complianceTone === 'red' ? (
                  <ShieldAlert size={36} className="text-red-400 print:text-red-700" />
                ) : (
                  <ShieldCheck
                    size={36}
                    className={
                      complianceTone === 'amber'
                        ? 'text-amber-400 print:text-amber-700'
                        : 'text-emerald-400 print:text-emerald-700'
                    }
                  />
                )}
                <span className="font-mono text-base font-bold uppercase tracking-wider">
                  {coa.status}
                </span>
                <span className="text-[9px] font-mono opacity-80 uppercase tracking-widest">
                  Compliance classification
                </span>
              </div>
            </div>

            <div className="text-center mt-6 flex flex-col items-center">
              <span className="block text-[10px] font-mono uppercase text-white/40 mb-3 print:text-slate-500">
                Scan to Verify Registry
              </span>

              <div className="bg-white p-2.5 inline-block border border-white/10 print:border-slate-300">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Registry QR Code"
                    className="w-24 h-24 sm:w-28 sm:h-28 block object-contain"
                  />
                ) : (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 grid place-items-center text-slate-500 text-xs">
                    QR unavailable
                  </div>
                )}
              </div>

              <span className="text-[8px] font-mono text-white/30 mt-2 block print:text-slate-400">
                ID: {coa.id}
              </span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 mt-8 font-mono text-[10px] print:border-slate-200 relative z-10">
          <div className="flex justify-between items-center mb-2 gap-3">
            <span className="text-white/40 uppercase tracking-wider print:text-slate-500 flex items-center gap-1">
              <Hash size={12} /> Cryptographic Compliance Ledger Signature
            </span>

            <button
              onClick={copySignature}
              className="text-emerald-400 hover:text-emerald-300 transition-colors uppercase font-bold tracking-widest text-[9px] print:hidden flex items-center gap-1"
            >
              <Copy size={11} />
              {copied ? 'Copied!' : 'Copy Hash'}
            </button>
          </div>

          <div className="bg-[#141E19] border border-white/5 p-3 text-white/50 break-all font-mono text-[9px] select-all leading-relaxed print:bg-slate-50 print:text-slate-600 print:border-slate-200">
            {coa.complianceSignature || 'NULL_SIGNATURE_LEDGER_NOT_SIGNED_BY_COMPLIANCE_AGENT'}
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 gap-4 text-white/30 print:text-slate-400 text-[9px]">
            <span>Verified On: {coa.verifiedAt || new Date().toISOString()}</span>
            <span className="uppercase text-emerald-400/80 print:text-slate-700">
              SHA256 HMAC secured ledger system
            </span>
          </div>
        </div>

        <div className="mt-8 border-t border-dashed border-white/10 pt-6 text-center text-[9px] font-mono text-white/30 leading-relaxed print:border-slate-200 print:text-slate-400">
          {coa.disclaimer ||
            'This document represents a digital replication of live chemical data from the compliance engine.'}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-1.5 print:border-slate-100">
      <span>{label.toUpperCase()}:</span>
      <span className="font-bold text-white print:text-slate-900 text-right break-words">
        {value || '—'}
      </span>
    </div>
  );
}
