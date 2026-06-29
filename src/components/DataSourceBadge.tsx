/**
 * DataSourceBadge.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * A polished, animated badge component that communicates the trustworthiness
 * and classification of a data source to the user.
 *
 * Modes:
 *  - "live-ai-inference"    → Emerald/green  (Sparkles icon)  — real Gemini output
 *  - "simulated"            → Amber/yellow   (FlaskConical icon) — placeholder/fallback
 *  - "heuristic-fallback"   → Amber/yellow   (AlertTriangle icon) — keyword matching
 *  - "production-real"      → Indigo/blue    (ShieldCheck icon) — live DB/verified
 *  - "demo-only"            → Slate/gray     (Database icon)   — demo data
 *  - "formula-computed"     → Teal           (Calculator icon) — deterministic formula
 *  - "manual"               → Purple/violet  (User icon)       — manually entered
 *  - "ai-generated"         → Emerald soft   (Bot icon)        — AI generated
 *
 * Props:
 *  - classification: one of the above mode strings
 *  - size?: "sm" | "md" | "lg" (defaults to "md")
 *  - showLabel?: boolean (defaults to true)
 *  - pulse?: boolean — animate with a subtle pulse (defaults to false)
 *  - className?: extra classes
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import {
  Sparkles,
  FlaskConical,
  AlertTriangle,
  ShieldCheck,
  Database,
  Calculator,
  User,
  Bot,
  Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataClassification =
  | "live-ai-inference"
  | "ai-generated"
  | "ai-generated-inference"
  | "simulated"
  | "speculative-hypothesis"
  | "heuristic-fallback"
  | "production-real"
  | "demo-only"
  | "formula-computed"
  | "deterministic_formula"
  | "manual"
  | string; // allow pass-through of arbitrary provenance strings

export type BadgeSize = "xs" | "sm" | "md" | "lg";

export interface DataSourceBadgeProps {
  classification: DataClassification;
  size?: BadgeSize;
  showLabel?: boolean;
  pulse?: boolean;
  className?: string;
}

// ─── Config Map ───────────────────────────────────────────────────────────────

interface BadgeConfig {
  icon: any;
  label: string;
  colorClass: string;       // text + border color
  bgClass: string;          // background
  dotClass: string;         // indicator dot color
}

function resolveConfig(classification: DataClassification): BadgeConfig {
  const c = (classification ?? "").toLowerCase();

  if (c.includes("live") || c.includes("live-ai")) {
    return {
      icon: Sparkles,
      label: "Live AI",
      colorClass: "text-emerald-300 border-emerald-500/40",
      bgClass: "bg-emerald-950/60",
      dotClass: "bg-emerald-400",
    };
  }
  if (c.includes("ai-generated") || c.includes("ai_generated") || c.includes("ai generated")) {
    return {
      icon: Bot,
      label: "AI Generated",
      colorClass: "text-emerald-400 border-emerald-500/30",
      bgClass: "bg-emerald-950/50",
      dotClass: "bg-emerald-300",
    };
  }
  if (c.includes("simulated") || c.includes("speculative")) {
    return {
      icon: FlaskConical,
      label: "Simulated",
      colorClass: "text-amber-300 border-amber-500/40",
      bgClass: "bg-amber-950/60",
      dotClass: "bg-amber-400",
    };
  }
  if (c.includes("heuristic") || c.includes("fallback")) {
    return {
      icon: AlertTriangle,
      label: "Heuristic",
      colorClass: "text-yellow-300 border-yellow-500/40",
      bgClass: "bg-yellow-950/60",
      dotClass: "bg-yellow-400",
    };
  }
  if (c.includes("production") || c.includes("verified")) {
    return {
      icon: ShieldCheck,
      label: "Production",
      colorClass: "text-indigo-300 border-indigo-500/40",
      bgClass: "bg-indigo-950/60",
      dotClass: "bg-indigo-400",
    };
  }
  if (c.includes("demo")) {
    return {
      icon: Database,
      label: "Demo Only",
      colorClass: "text-slate-400 border-slate-600/40",
      bgClass: "bg-slate-900/60",
      dotClass: "bg-slate-500",
    };
  }
  if (c.includes("formula") || c.includes("deterministic")) {
    return {
      icon: Calculator,
      label: "Formula",
      colorClass: "text-teal-300 border-teal-500/40",
      bgClass: "bg-teal-950/60",
      dotClass: "bg-teal-400",
    };
  }
  if (c.includes("manual")) {
    return {
      icon: User,
      label: "Manual",
      colorClass: "text-violet-300 border-violet-500/40",
      bgClass: "bg-violet-950/60",
      dotClass: "bg-violet-400",
    };
  }
  // Generic / unknown fallback
  return {
    icon: Zap,
    label: classification || "Unknown",
    colorClass: "text-slate-400 border-slate-600/40",
    bgClass: "bg-slate-900/60",
    dotClass: "bg-slate-500",
  };
}

// ─── Size Config ──────────────────────────────────────────────────────────────

const SIZE_ICON: Record<BadgeSize, number> = { xs: 10, sm: 12, md: 13, lg: 15 };
const SIZE_TEXT: Record<BadgeSize, string> = {
  xs: "text-[9px]",
  sm: "text-[10px]",
  md: "text-[11px]",
  lg: "text-xs",
};
const SIZE_PADDING: Record<BadgeSize, string> = {
  xs: "px-1.5 py-0.5 gap-1",
  sm: "px-2 py-0.5 gap-1",
  md: "px-2.5 py-1 gap-1.5",
  lg: "px-3 py-1.5 gap-2",
};
const SIZE_DOT: Record<BadgeSize, string> = {
  xs: "w-1 h-1",
  sm: "w-1.5 h-1.5",
  md: "w-1.5 h-1.5",
  lg: "w-2 h-2",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DataSourceBadge({
  classification,
  size = "md",
  showLabel = true,
  pulse = false,
  className = "",
}: DataSourceBadgeProps) {
  const cfg = resolveConfig(classification);
  const Icon = cfg.icon;

  return (
    <span
      className={[
        "inline-flex items-center border font-mono uppercase tracking-wider font-semibold backdrop-blur-sm select-none",
        "transition-all duration-200",
        cfg.bgClass,
        cfg.colorClass,
        SIZE_PADDING[size],
        SIZE_TEXT[size],
        className,
      ].join(" ")}
      title={`Data classification: ${classification}`}
      aria-label={`Data source: ${cfg.label}`}
    >
      {/* Pulsing status dot */}
      <span className="relative flex items-center justify-center">
        <span
          className={[
            "rounded-full",
            cfg.dotClass,
            SIZE_DOT[size],
            pulse ? "animate-pulse" : "",
          ].join(" ")}
        />
        {pulse && (
          <span
            className={[
              "absolute rounded-full opacity-50 animate-ping",
              cfg.dotClass,
              SIZE_DOT[size],
            ].join(" ")}
          />
        )}
      </span>

      {/* Icon */}
      <Icon size={SIZE_ICON[size]} className="shrink-0" aria-hidden />

      {/* Label */}
      {showLabel && <span className="leading-none">{cfg.label}</span>}
    </span>
  );
}
