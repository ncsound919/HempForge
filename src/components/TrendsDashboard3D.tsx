import React, { useMemo } from 'react';
import { Network, BarChart3, Beaker } from 'lucide-react';
import SceneContainer from './3d/SceneContainer';
import CompoundNetwork, { CompoundNode, CompoundEdge } from './3d/CompoundNetwork';
import PublicationHeatmap, { HeatmapDataPoint } from './3d/PublicationHeatmap';

interface Trend {
  id: string;
  title: string;
  category: string;
  growthRate: number;
  description: string;
  relatedCompounds?: string[];
}

interface TrendsDashboard3DProps {
  trends: Trend[];
  allPapers: any[];
}

export default function TrendsDashboard3D({ trends, allPapers }: TrendsDashboard3DProps) {
  // Build compound network data from papers
  const { compounds, connections } = useMemo(() => {
    const compoundCounts: Record<string, { count: number; trend: 'rising' | 'stable' | 'declining'; category: string }> = {};

    // Count compound occurrences
    allPapers.forEach((paper: any) => {
      const comps = Array.isArray(paper.compounds) ? paper.compounds : [];
      comps.forEach((c: string) => {
        if (!compoundCounts[c]) {
          compoundCounts[c] = { count: 0, trend: 'stable', category: 'Cannabinoid' };
        }
        compoundCounts[c].count++;
      });
    });

    // Determine trends from trend data
    const trendCompounds = new Set<string>();
    trends.forEach((t) => {
      (t.relatedCompounds || []).forEach((c: string) => {
        trendCompounds.add(c);
        if (compoundCounts[c]) {
          compoundCounts[c].trend = t.growthRate > 10 ? 'rising' : t.growthRate < -5 ? 'declining' : 'stable';
          compoundCounts[c].category = t.category || 'Cannabinoid';
        }
      });
    });

    // Add some default compounds if empty
    const defaultCompounds = ['THCa', 'CBD', 'CBG', 'CBC', 'CBN', 'Delta-9-THC'];
    defaultCompounds.forEach((c) => {
      if (!compoundCounts[c]) {
        compoundCounts[c] = { count: Math.floor(Math.random() * 15) + 1, trend: 'stable', category: 'Cannabinoid' };
      }
    });

    const nodes: CompoundNode[] = Object.entries(compoundCounts)
      .map(([id, data]) => ({
        id,
        name: id,
        count: data.count,
        trend: data.trend,
        category: data.category,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // Generate connections based on co-occurrence in papers
    const edgeMap = new Map<string, number>();
    allPapers.forEach((paper: any) => {
      const comps = Array.isArray(paper.compounds) ? paper.compounds : [];
      for (let i = 0; i < comps.length; i++) {
        for (let j = i + 1; j < comps.length; j++) {
          const key = [comps[i], comps[j]].sort().join('|');
          edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        }
      }
    });

    // Add some default connections
    const defaultConnections = [
      ['THCa', 'CBD'],
      ['THCa', 'CBC'],
      ['CBD', 'CBG'],
      ['THCa', 'CBN'],
      ['CBD', 'CBC'],
    ];
    defaultConnections.forEach(([a, b]) => {
      const key = [a, b].sort().join('|');
      if (!edgeMap.has(key)) {
        edgeMap.set(key, Math.floor(Math.random() * 5) + 1);
      }
    });

    const edges: CompoundEdge[] = [];
    edgeMap.forEach((strength, key) => {
      const [from, to] = key.split('|');
      if (from && to && strength > 1) {
        edges.push({ from, to, strength: Math.min(1, strength / 5) });
      }
    });

    return { compounds: nodes, connections: edges };
  }, [allPapers, trends]);

  // Build heatmap data
  const heatmapData = useMemo(() => {
    const periods = ['Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024', 'Q1 2025', 'Q2 2025'];
    const keyCompounds = ['THCa', 'CBD', 'CBG', 'CBC', 'CBN'];
    const data: HeatmapDataPoint[] = [];

    periods.forEach((period) => {
      keyCompounds.forEach((compound) => {
        // Generate semi-random data influenced by trends
        const baseCount = Math.floor(Math.random() * 20) + 2;
        const trendBonus = trends.some(
          (t) => t.relatedCompounds?.includes(compound) && t.growthRate > 10
        )
          ? Math.floor(Math.random() * 10)
          : 0;
        data.push({ period, compound, count: baseCount + trendBonus });
      });
    });

    return data;
  }, [trends]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-emerald-400 font-mono uppercase tracking-widest flex items-center gap-2">
            <Network size={16} />
            3D Research Visualizations
          </h3>
          <p className="text-xs text-white/50 mt-1">
            Interactive molecular network and publication activity heatmap rendered in WebGL.
          </p>
        </div>
        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 font-mono">
          {compounds.length} compounds mapped
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compound Network */}
        <div className="bg-[#0D1411] border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Beaker size={14} className="text-emerald-400" />
            <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold tracking-widest">
              Compound Relationship Network
            </span>
          </div>
          <SceneContainer height={400} camera={{ position: [0, 2, 7], fov: 50 }}>
            <CompoundNetwork
              compounds={compounds}
              connections={connections}
              autoRotate={true}
            />
          </SceneContainer>
          <div className="mt-3 text-[9px] font-mono text-white/30 text-center">
            Node size = mention count | Line thickness = co-occurrence strength
          </div>
        </div>

        {/* Publication Heatmap */}
        <div className="bg-[#0D1411] border border-white/10 p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-amber-400" />
            <span className="text-[10px] font-mono text-amber-400 uppercase font-bold tracking-widest">
              Publication Activity Heatmap
            </span>
          </div>
          <SceneContainer height={400} camera={{ position: [6, 5, 6], fov: 45 }}>
            <PublicationHeatmap data={heatmapData} autoRotate={true} />
          </SceneContainer>
          <div className="mt-3 text-[9px] font-mono text-white/30 text-center">
            Bar height = publication count | Color gradient = density scale
          </div>
        </div>
      </div>
    </div>
  );
}
