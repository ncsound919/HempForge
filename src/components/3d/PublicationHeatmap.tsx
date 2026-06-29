import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

export interface HeatmapDataPoint {
  period: string;
  compound: string;
  count: number;
}

interface PublicationHeatmapProps {
  data: HeatmapDataPoint[];
  autoRotate?: boolean;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function getCountColor(count: number, maxCount: number): string {
  const t = maxCount > 0 ? count / maxCount : 0;
  // Cool (blue) to hot (red) gradient
  if (t < 0.25) {
    return `rgb(${lerp(30, 50, t * 4)}, ${lerp(80, 120, t * 4)}, ${lerp(180, 180, t * 4)})`;
  } else if (t < 0.5) {
    return `rgb(${lerp(50, 200, (t - 0.25) * 4)}, ${lerp(120, 180, (t - 0.25) * 4)}, ${lerp(180, 50, (t - 0.25) * 4)})`;
  } else if (t < 0.75) {
    return `rgb(${lerp(200, 240, (t - 0.5) * 4)}, ${lerp(180, 120, (t - 0.5) * 4)}, ${lerp(50, 20, (t - 0.5) * 4)})`;
  } else {
    return `rgb(${lerp(240, 255, (t - 0.75) * 4)}, ${lerp(120, 50, (t - 0.75) * 4)}, ${lerp(20, 20, (t - 0.75) * 4)})`;
  }
}

function HeatmapBar({
  position,
  height,
  maxHeight,
  color,
  period,
  compound,
  count,
  delay,
  animationProgressRef,
}: {
  position: [number, number, number];
  height: number;
  maxHeight: number;
  color: string;
  period: string;
  compound: string;
  count: number;
  delay: number;
  animationProgressRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const animatedHeightRef = useRef(0.01);

  useFrame(() => {
    if (ref.current) {
      const t = Math.max(0, Math.min(1, (animationProgressRef.current - delay) / 0.3));
      const eased = t * t * (3 - 2 * t);
      const animatedHeight = Math.max(0.01, height * eased);
      animatedHeightRef.current = animatedHeight;
      ref.current.scale.y = animatedHeight;
      ref.current.position.y = animatedHeight / 2;
      if (hovered) {
        ref.current.scale.x = 1.1;
        ref.current.scale.z = 1.1;
      } else {
        ref.current.scale.x = 1;
        ref.current.scale.z = 1;
      }
    }
  });

  return (
    <mesh
      ref={ref}
      position={position}
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
      <boxGeometry args={[0.7, 1, 0.7]} />
      <meshStandardMaterial
        color={color}
        roughness={0.5}
        metalness={0.1}
        emissive={hovered ? color : '#000000'}
        emissiveIntensity={hovered ? 0.3 : 0}
        transparent
        opacity={0.85}
      />
      {hovered && (
        <Html center distanceFactor={8} position={[0, animatedHeightRef.current + 0.5, 0]}>
          <div className="bg-[#0D1411]/95 border border-emerald-500/30 px-3 py-2 text-center pointer-events-none select-none">
            <div className="text-[9px] font-mono text-emerald-400 font-bold uppercase tracking-wider">
              {compound}
            </div>
            <div className="text-[9px] font-mono text-white/70 mt-0.5">{period}</div>
            <div className="text-[10px] font-mono text-amber-400 font-bold mt-0.5">
              {count} publications
            </div>
          </div>
        </Html>
      )}
    </mesh>
  );
}

export default function PublicationHeatmap({
  data,
  autoRotate = true,
}: PublicationHeatmapProps) {
  const groupRef = useRef<THREE.Group>(null);
  const animProgressRef = useRef(0);

  // Extract unique periods and compounds
  const periods = useMemo(() => {
    const unique = [...new Set(data.map((d) => d.period))];
    return unique.sort();
  }, [data]);

  const compounds = useMemo(() => {
    return [...new Set(data.map((d) => d.compound))];
  }, [data]);

  const maxCount = useMemo(() => {
    return Math.max(1, ...data.map((d) => d.count));
  }, [data]);

  // Build lookup for data
  const dataLookup = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((d) => {
      map.set(`${d.period}|${d.compound}`, d.count);
    });
    return map;
  }, [data]);

  useFrame((state) => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1;
    }
    animProgressRef.current = Math.min(1.5, animProgressRef.current + 0.008);
  });

  return (
    <group ref={groupRef}>
      {periods.map((period, pi) =>
        compounds.map((compound, ci) => {
          const count = dataLookup.get(`${period}|${compound}`) || 0;
          const normalizedHeight = (count / maxCount) * 4 + 0.1;
          const color = getCountColor(count, maxCount);
          const delay = (pi * compounds.length + ci) * 0.02;

          return (
            <HeatmapBar
              key={`${period}-${compound}`}
              position={[
                (pi - periods.length / 2) * 1.0,
                0,
                (ci - compounds.length / 2) * 1.0,
              ]}
              height={normalizedHeight}
              maxHeight={4}
              color={color}
              period={period}
              compound={compound}
              count={count}
              delay={delay}
              animationProgressRef={animProgressRef}
            />
          );
        })
      )}

      {/* X-axis labels (periods) */}
      {periods.map((period, pi) => (
        <Html
          key={`label-x-${pi}`}
          position={[(pi - periods.length / 2) * 1.0, -0.3, (compounds.length / 2) * 1.0 + 0.8]}
          center
          distanceFactor={10}
        >
          <div className="text-[7px] font-mono text-white/40 uppercase tracking-wider whitespace-nowrap pointer-events-none select-none rotate-45 origin-center">
            {period}
          </div>
        </Html>
      ))}

      {/* Z-axis labels (compounds) */}
      {compounds.map((compound, ci) => (
        <Html
          key={`label-z-${ci}`}
          position={[-(periods.length / 2) * 1.0 - 0.8, -0.3, (ci - compounds.length / 2) * 1.0]}
          center
          distanceFactor={10}
        >
          <div className="text-[7px] font-mono text-white/50 uppercase tracking-wider whitespace-nowrap pointer-events-none select-none">
            {compound}
          </div>
        </Html>
      ))}

      {/* Axis labels */}
      <Html position={[0, -0.8, (compounds.length / 2) * 1.0 + 1.5]} center distanceFactor={12}>
        <div className="text-[8px] font-mono text-white/30 uppercase tracking-[0.2em] pointer-events-none select-none">
          Time Period
        </div>
      </Html>
      <Html position={[-(periods.length / 2) * 1.0 - 1.5, -0.8, 0]} center distanceFactor={12}>
        <div className="text-[8px] font-mono text-white/30 uppercase tracking-[0.2em] pointer-events-none select-none -rotate-90">
          Compounds
        </div>
      </Html>

      {/* Color scale legend */}
      <Html position={[0, -1.5, 0]} center distanceFactor={12}>
        <div className="bg-[#0D1411]/90 border border-white/10 px-3 py-2 pointer-events-none select-none">
          <div className="text-[7px] font-mono text-white/40 uppercase tracking-wider mb-1 text-center">
            Publication Density
          </div>
          <div className="flex gap-0">
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
              <div
                key={i}
                className="w-6 h-2"
                style={{ backgroundColor: getCountColor(t * maxCount, maxCount) }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[6px] font-mono text-white/30">Low</span>
            <span className="text-[6px] font-mono text-white/30">High</span>
          </div>
        </div>
      </Html>
    </group>
  );
}
