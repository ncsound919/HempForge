import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';

export interface CompoundNode {
  id: string;
  name: string;
  count: number;
  trend: 'rising' | 'stable' | 'declining';
  category?: string;
  position?: [number, number, number];
}

export interface CompoundEdge {
  from: string;
  to: string;
  strength: number;
}

interface CompoundNetworkProps {
  compounds: CompoundNode[];
  connections: CompoundEdge[];
  selectedCompound?: string | null;
  onSelectCompound?: (id: string | null) => void;
  autoRotate?: boolean;
}

const TREND_COLORS: Record<string, string> = {
  rising: '#22c55e',
  stable: '#f59e0b',
  declining: '#ef4444',
};

function deterministicRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function NetworkNode({
  compound,
  position,
  isSelected,
  isHighlighted,
  onClick,
}: {
  compound: CompoundNode;
  position: [number, number, number];
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const tempVec = useRef(new THREE.Vector3());

  const scale = useMemo(() => {
    const base = 0.15 + (compound.count / 100) * 0.5;
    return base;
  }, [compound.count]);

  const color = TREND_COLORS[compound.trend] || '#6b7280';

  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime;
      ref.current.position.y = position[1] + Math.sin(t * 0.6 + position[0] * 2) * 0.08;

      const targetScale = hovered || isSelected ? scale * 1.3 : scale;
      ref.current.scale.lerp(
        tempVec.current.set(targetScale, targetScale, targetScale),
        0.1
      );
    }
  });

  return (
    <group>
      <mesh
        ref={ref}
        position={position}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = 'default';
        }}
      >
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color={color}
          roughness={0.4}
          metalness={0.2}
          emissive={isSelected || hovered ? color : '#000000'}
          emissiveIntensity={isSelected ? 0.4 : hovered ? 0.2 : 0}
          transparent
          opacity={isHighlighted || isSelected ? 1.0 : 0.6}
        />
      </mesh>

      <Html
        position={position}
        center
        distanceFactor={8}
        style={{ visibility: (hovered || isSelected) ? 'visible' : 'hidden' }}
      >
        <div className="bg-[#0D1411]/95 border border-emerald-500/30 px-3 py-2 text-center min-w-[140px] pointer-events-none select-none">
          <div className="text-[10px] font-mono font-bold text-white uppercase tracking-widest">
            {compound.name}
          </div>
          <div className="text-[9px] font-mono text-emerald-400 mt-0.5">
            Mentions: {compound.count}
          </div>
          <div className="text-[8px] font-mono mt-0.5" style={{ color }}>
            Trend: {compound.trend}
          </div>
          {compound.category && (
            <div className="text-[8px] font-mono text-white/40 mt-0.5">
              {compound.category}
            </div>
          )}
        </div>
      </Html>

      {/* Label always visible */}
      <Html position={[position[0], position[1] + scale + 0.3, position[2]]} center distanceFactor={10}>
        <div className="text-[8px] font-mono text-white/60 uppercase tracking-wider whitespace-nowrap pointer-events-none select-none">
          {compound.name}
        </div>
      </Html>
    </group>
  );
}

function NetworkEdge({
  from,
  to,
  strength,
  isHighlighted,
}: {
  from: [number, number, number];
  to: [number, number, number];
  strength: number;
  isHighlighted: boolean;
}) {
  return (
    <Line
      points={[from, to]}
      color={isHighlighted ? '#10b981' : '#374151'}
      lineWidth={isHighlighted ? 2 : 1}
      transparent
      opacity={isHighlighted ? 0.8 : 0.2 + strength * 0.3}
    />
  );
}

export default function CompoundNetwork({
  compounds,
  connections,
  selectedCompound,
  onSelectCompound,
  autoRotate = true,
}: CompoundNetworkProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Generate circular layout positions for nodes
  const nodePositions = useMemo(() => {
    const positions: Record<string, [number, number, number]> = {};
    const radius = 3;
    compounds.forEach((compound, i) => {
      if (compound.position) {
        positions[compound.id] = compound.position;
      } else {
        const angle = (i / compounds.length) * Math.PI * 2;
        positions[compound.id] = [
          Math.cos(angle) * radius,
          (deterministicRandom(compound.id) - 0.5) * 1.5,
          Math.sin(angle) * radius,
        ];
      }
    });
    return positions;
  }, [compounds]);

  // Find connected compounds for highlighting
  const connectedIds = useMemo(() => {
    if (!selectedCompound) return new Set<string>();
    const connected = new Set<string>();
    connected.add(selectedCompound);
    connections.forEach((edge) => {
      if (edge.from === selectedCompound) connected.add(edge.to);
      if (edge.to === selectedCompound) connected.add(edge.from);
    });
    return connected;
  }, [selectedCompound, connections]);

  useFrame((state) => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Edges */}
      {connections.map((edge, i) => {
        const fromPos = nodePositions[edge.from];
        const toPos = nodePositions[edge.to];
        if (!fromPos || !toPos) return null;
        const isHighlighted =
          selectedCompound &&
          (edge.from === selectedCompound || edge.to === selectedCompound);
        return (
          <NetworkEdge
            key={`edge-${i}`}
            from={fromPos}
            to={toPos}
            strength={edge.strength}
            isHighlighted={!!isHighlighted}
          />
        );
      })}

      {/* Nodes */}
      {compounds.map((compound) => {
        const pos = nodePositions[compound.id];
        if (!pos) return null;
        return (
          <NetworkNode
            key={compound.id}
            compound={compound}
            position={pos}
            isSelected={selectedCompound === compound.id}
            isHighlighted={connectedIds.has(compound.id)}
            onClick={() => {
              onSelectCompound?.(
                selectedCompound === compound.id ? null : compound.id
              );
            }}
          />
        );
      })}

      {/* Legend */}
      <Html position={[0, -4.5, 0]} center distanceFactor={12}>
        <div className="bg-[#0D1411]/90 border border-white/10 px-4 py-2 flex gap-4 pointer-events-none select-none">
          {Object.entries(TREND_COLORS).map(([trend, color]) => (
            <div key={trend} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[8px] font-mono text-white/50 uppercase tracking-wider">
                {trend}
              </span>
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}
