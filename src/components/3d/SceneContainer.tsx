import React, { Suspense, useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';

interface SceneContainerProps {
  children: React.ReactNode;
  className?: string;
  height?: number | string;
  camera?: { position: [number, number, number]; fov: number };
  ambientIntensity?: number;
  directionalIntensity?: number;
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#10b981" wireframe />
    </mesh>
  );
}

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center h-64 bg-red-950/30 border border-red-800/30 rounded-xl">
          <div className="text-center">
            <p className="text-red-400 font-medium">3D Rendering Error</p>
            <p className="text-red-500/70 text-sm mt-1">WebGL may not be available</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SceneContainer({
  children,
  className = '',
  height = 400,
  camera = { position: [0, 0, 5], fov: 50 },
  ambientIntensity = 0.4,
  directionalIntensity = 1.0,
}: SceneContainerProps) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  return (
    <div
      className={`relative bg-[#050907] border border-white/5 overflow-hidden ${className}`}
      style={{ height }}
    >
      <SceneErrorBoundary>
        <Canvas
          camera={camera}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          }}
          dpr={[1, 2]}
        >
          <ambientLight intensity={ambientIntensity} />
          <directionalLight
            position={[5, 5, 5]}
            intensity={directionalIntensity}
          />
          <directionalLight
            position={[-5, -3, 3]}
            intensity={directionalIntensity * 0.3}
          />
          <pointLight position={[0, 5, 0]} intensity={0.5} color="#10b981" />

          <Suspense fallback={<LoadingFallback />}>
            {children}
          </Suspense>

          <OrbitControls
            ref={controlsRef}
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            autoRotate={false}
            autoRotateSpeed={0.5}
            minDistance={1}
            maxDistance={20}
            dampingFactor={0.05}
            enableDamping
          />

          <fog attach="fog" args={['#050907', 10, 30]} />
        </Canvas>
      </SceneErrorBoundary>

      <div className="absolute bottom-2 right-2 text-[8px] font-mono text-white/20 uppercase tracking-widest select-none pointer-events-none">
        Drag to orbit / Scroll to zoom
      </div>
    </div>
  );
}
