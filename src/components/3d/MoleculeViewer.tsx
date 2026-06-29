import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { MOLECULE_TEMPLATES } from '../../data/moleculeTemplates';

export interface AtomData {
  position: [number, number, number];
  element: string;
  color?: string;
}

export interface BondData {
  from: number;
  to: number;
  order: number;
}

export interface MoleculeTemplate {
  name: string;
  formula: string;
  atoms: AtomData[];
  bonds: BondData[];
  description: string;
}

const ELEMENT_COLORS: Record<string, string> = {
  C: '#6b7280',
  H: '#f3f4f6',
  O: '#ef4444',
  N: '#3b82f6',
  S: '#eab308',
};

const ELEMENT_RADII: Record<string, number> = {
  C: 0.3,
  H: 0.15,
  O: 0.28,
  N: 0.28,
  S: 0.35,
};

interface AtomProps {
  position: [number, number, number];
  element: string;
  color?: string;
  onHover?: (element: string) => void;
  onUnhover?: () => void;
  bobPhase?: number;
}

function Atom({ position, element, color, onHover, onUnhover, bobPhase = 0 }: AtomProps) {
  const ref = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const tempVec = useRef(new THREE.Vector3());
  const atomColor = color || ELEMENT_COLORS[element] || '#888888';
  const radius = ELEMENT_RADII[element] || 0.25;

  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime;
      ref.current.position.y = position[1] + Math.sin(t * 0.8 + bobPhase) * 0.03;
      if (hovered) {
        ref.current.scale.setScalar(1.2);
      } else {
        ref.current.scale.lerp(tempVec.current.set(1, 1, 1), 0.1);
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
        onHover?.(element);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
        onUnhover?.();
        document.body.style.cursor = 'default';
      }}
    >
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial
        color={atomColor}
        roughness={0.3}
        metalness={0.1}
        emissive={hovered ? atomColor : '#000000'}
        emissiveIntensity={hovered ? 0.3 : 0}
      />
      {hovered && (
        <Html center distanceFactor={5}>
          <div className="bg-[#1A221E] border border-emerald-500/30 text-emerald-400 text-[9px] font-mono px-2 py-1 whitespace-nowrap pointer-events-none select-none">
            {element}
          </div>
        </Html>
      )}
    </mesh>
  );
}

interface BondProps {
  from: [number, number, number];
  to: [number, number, number];
  order: number;
}

function Bond({ from, to, order }: BondProps) {
  const ref = useRef<THREE.Group>(null);

  const { position, rotation, length } = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    return { position: [mid.x, mid.y, mid.z] as [number, number, number], rotation: euler, length: len };
  }, [from, to]);

  const bondRadius = 0.06;
  const bondSpacing = 0.15;

  return (
    <group ref={ref} position={position} rotation={rotation}>
      {order === 1 && (
        <mesh>
          <cylinderGeometry args={[bondRadius, bondRadius, length, 8]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.5} metalness={0.1} />
        </mesh>
      )}
      {order === 2 && (
        <>
          <mesh position={[-bondSpacing, 0, 0]}>
            <cylinderGeometry args={[bondRadius * 0.8, bondRadius * 0.8, length, 8]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.5} metalness={0.1} />
          </mesh>
          <mesh position={[bondSpacing, 0, 0]}>
            <cylinderGeometry args={[bondRadius * 0.8, bondRadius * 0.8, length, 8]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.5} metalness={0.1} />
          </mesh>
        </>
      )}
      {order === 3 && (
        <>
          <mesh>
            <cylinderGeometry args={[bondRadius * 0.6, bondRadius * 0.6, length, 8]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.5} metalness={0.1} />
          </mesh>
          <mesh position={[-bondSpacing * 1.2, 0, 0]}>
            <cylinderGeometry args={[bondRadius * 0.6, bondRadius * 0.6, length, 8]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.5} metalness={0.1} />
          </mesh>
          <mesh position={[bondSpacing * 1.2, 0, 0]}>
            <cylinderGeometry args={[bondRadius * 0.6, bondRadius * 0.6, length, 8]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.5} metalness={0.1} />
          </mesh>
        </>
      )}
    </group>
  );
}

interface MoleculeViewerProps {
  molecule?: MoleculeTemplate;
  moleculeKey?: string;
  showLabels?: boolean;
  autoRotate?: boolean;
  transformProgress?: number;
}

export default function MoleculeViewer({
  molecule,
  moleculeKey = 'THCa',
  showLabels = true,
  autoRotate = true,
  transformProgress,
}: MoleculeViewerProps) {
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  const mol = molecule || MOLECULE_TEMPLATES[moleculeKey] || MOLECULE_TEMPLATES.THCa;

  useFrame((state) => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.15;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Bonds */}
      {mol.bonds.map((bond, i) => {
        const fromAtom = mol.atoms[bond.from];
        const toAtom = mol.atoms[bond.to];
        if (!fromAtom || !toAtom) return null;
        return (
          <Bond
            key={`bond-${i}`}
            from={fromAtom.position}
            to={toAtom.position}
            order={bond.order}
          />
        );
      })}

      {/* Atoms */}
      {mol.atoms.map((atom, i) => (
        <Atom
          key={`atom-${i}`}
          position={atom.position}
          element={atom.element}
          color={atom.color}
          onHover={setHoveredElement}
          onUnhover={() => setHoveredElement(null)}
          bobPhase={i * 0.5}
        />
      ))}

      {/* Info panel */}
      {showLabels && (
        <Html position={[0, -4, 0]} center distanceFactor={10}>
          <div className="bg-[#0D1411]/90 border border-white/10 px-3 py-2 text-center min-w-[180px] pointer-events-none select-none">
            <div className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest">
              {mol.name}
            </div>
            <div className="text-[9px] font-mono text-white/50 mt-0.5">{mol.formula}</div>
            {hoveredElement && (
              <div className="text-[8px] font-mono text-amber-400 mt-1">
                Hovering: {hoveredElement} atom
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}
