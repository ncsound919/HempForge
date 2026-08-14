import React, { useState, useEffect } from 'react';
import { Loader2, CreditCard, CheckCircle2, ExternalLink, AlertTriangle, ShieldCheck } from 'lucide-react';
import { authFetch } from '../lib/firebase';

interface Plan {
  id: string;
  slug: string;
  name: string;
  monthlyCents: number;
  monthlyDollars: number;
  description: string;
  features: string[];
  maxSeats: number;
  maxFacilities: number;
  highlight?: boolean;
  cta: string;
}

interface Subscription {
  id: string;
  plan_id: string;
  status: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
}

export default function Billing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await authFetch('/api/billing/status');
      if (!res.ok) throw new Error(`Status failed: ${res.status}`);
      const data = await res.json();
      setEnabled(data.enabled);
      setPlans(data.plans ?? []);
      setSubscription(data.subscription ?? null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const checkout = async (planSlug: string) => {
    setBusy(planSlug);
    setError(null);
    try {
      const res = await authFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Checkout failed: ${res.status}`);
      if (data.custom) {
        setError(data.message || 'Enterprise is a custom quote — contact sales.');
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy('portal');
    setError(null);
    try {
      const res = await authFetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Portal failed');
      if (data.url) window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
      </div>
    );
  }

  const activePlan = subscription ? plans.find((p) => p.id === subscription.plan_id) : null;

  return (
    <div className="space-y-8">
      <header className="mb-6 border-b border-white/10 pb-6">
        <h2 className="text-3xl font-display font-bold text-white tracking-tight italic">Billing & Plans</h2>
        <p className="text-white/40 font-mono text-xs uppercase tracking-widest mt-2">
          Compliance-ledger subscriptions powered by Stripe.
        </p>
      </header>

      {!enabled && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 p-4 text-amber-300 text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-bold uppercase tracking-wider text-xs mb-1">Billing not configured</p>
            <p className="text-xs text-amber-200/80">
              Stripe is not enabled on this deployment. Set <code className="font-mono">STRIPE_SECRET_KEY</code> and the
              three price ids (<code className="font-mono">STRIPE_PRICE_*_ID</code>) to accept payments.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/40 p-3 text-xs text-red-300">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {subscription && (
        <div className="bg-emerald-900/20 border border-emerald-500/30 p-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald-400" size={20} />
            <div>
              <p className="text-sm font-bold text-emerald-300 uppercase tracking-wider">
                {subscription.status === 'active' || subscription.status === 'trialing' ? 'Active' : subscription.status} Plan
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {activePlan?.name || subscription.plan_id}
                {subscription.current_period_end && (
                  <span className="ml-2 text-slate-500">
                    renews {new Date(subscription.current_period_end).toLocaleDateString()}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {subscription.cancel_at_period_end && (
              <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-1">
                Cancels at period end
              </span>
            )}
            <button
              onClick={() => void openPortal()}
              disabled={busy !== null}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-emerald-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
            >
              {busy === 'portal' ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
              Manage Billing
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isActive = subscription?.plan_id === plan.id;
          return (
            <div
              key={plan.id}
              className={`bg-[#0D1411] border p-6 flex flex-col ${
                plan.highlight
                  ? 'border-emerald-500/60 shadow-lg shadow-emerald-500/10'
                  : 'border-white/10'
              }`}
            >
              {plan.highlight && (
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2">
                  Most Popular
                </span>
              )}
              <h3 className="text-xl font-bold text-white tracking-tight italic">{plan.name}</h3>
              <div className="mt-3 mb-1">
                {plan.monthlyCents === 0 ? (
                  <span className="text-3xl font-bold text-white">Custom</span>
                ) : (
                  <>
                    <span className="text-3xl font-bold text-white">${plan.monthlyDollars.toLocaleString()}</span>
                    <span className="text-sm text-slate-500">/mo</span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{plan.description}</p>

              <ul className="mt-5 space-y-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-300">
                    <ShieldCheck size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => (plan.monthlyCents === 0 ? checkout(plan.slug) : checkout(plan.slug))}
                disabled={busy !== null || isActive}
                className={`mt-6 px-4 py-2.5 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-40 ${
                  plan.highlight
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-[#0A0F0D]'
                    : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                }`}
              >
                {busy === plan.slug ? (
                  <Loader2 size={14} className="animate-spin mx-auto" />
                ) : isActive ? (
                  'Current Plan'
                ) : (
                  plan.cta
                )}
              </button>
              {isActive && (
                <p className="text-[10px] text-emerald-400 text-center mt-2 uppercase tracking-wider">
                  You're on this plan
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
