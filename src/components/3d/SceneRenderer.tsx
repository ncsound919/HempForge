import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import SceneContainer from './SceneContainer';
import type {
  SceneSpec,
  SceneEntity,
  SceneProcess,
  CameraConfig,
} from '../../lib/sceneSpecSchema';

const MoleculeViewer = React.lazy(() => import('./MoleculeViewer'));
const CompoundNetwork = React.lazy(() => import('./CompoundNetwork'));
const PublicationHeatmap = React.lazy(() => import('./PublicationHeatmap'));

const PROCESS_COLORS: Record<string, string> = {
  extraction: '#10b981',
  decarboxylation: '#f59e0b',
  distillation: '#3b82f6',
  crystallization: '#8b5cf6',
  testing: '#ef4444',
  fermentation: '#ec4899',
  growth: '#22c55e',
  harvest: '#d97706',
  formulation: '#06b6d4',
};

interface SceneRendererProps {
  spec: SceneSpec;
  height?: number | string;
  onEntitySelect?: (entityId: string) => void;
  onExport?: (canvas: HTMLCanvasElement) => void;
}

function SceneOverlay({
  spec,
  onExport,
}: {
  spec: SceneSpec;
  onExport?: (canvas: HTMLCanvasElement) => void;
}) {
  const handleExport = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (canvas && onExport) onExport(canvas);
  }, [onExport]);

  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div className="pointer-events-auto absolute top-3 left-3 flex flex-col gap-2 z-10">
        <div className="bg-[#0D1411]/90 border border-white/10 px-3 py-2 max-w-[260px]">
          <div className="text-[9px] font-mono text-emerald-400 font-bold uppercase tracking-widest">
            {spec.title}
          </div>
          <div className="text-[8px] font-mono text-white/40 mt-0.5 leading-relaxed">
            {spec.description}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="text-[7px] font-mono text-white/30 uppercase tracking-wider">
              Confidence
            </div>
            <div className="flex-1 h-1 bg-white/10 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${spec.confidence * 100}%` }}
              />
            </div>
            <div className="text-[7px] font-mono text-emerald-400">
              {Math.round(spec.confidence * 100)}%
            </div>
          </div>
        </div>
        {onExport && (
          <button
            onClick={handleExport}
            className="bg-[#0D1411]/90 border border-white/10 px-3 py-1.5 text-[8px] font-mono text-white/60 uppercase tracking-widest hover:text-emerald-400 hover:border-emerald-500/30 transition-colors cursor-pointer"
          >
            Export PNG
          </button>
        )}
      </div>
    </Html>
  );
}

function EntityDetailPanel({
  entity,
  processes,
  onClose,
  onViewMolecule,
}: {
  entity: SceneEntity;
  processes: SceneProcess[];
  onClose: () => void;
  onViewMolecule?: () => void;
}) {
  const connectedProcesses = useMemo(
    () =>
      processes.filter(
        (p) => p.fromEntityId === entity.id || p.toEntityId === entity.id
      ),
    [entity.id, processes]
  );

  return (
    <Html center distanceFactor={6}>
      <div className="bg-[#0D1411]/95 border border-emerald-500/30 p-4 min-w-[220px] max-w-[280px] pointer-events-auto select-none">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-widest">
              {entity.name}
            </div>
            <div className="text-[8px] font-mono text-white/40 uppercase tracking-wider mt-0.5">
              {entity.type}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 text-xs cursor-pointer"
          >
            ×
          </button>
        </div>

        <div className="space-y-1.5 mb-3">
          {Object.entries(entity.properties).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center">
              <span className="text-[7px] font-mono text-white/40 uppercase tracking-wider">
                {key}
              </span>
              <span className="text-[8px] font-mono text-white/70">
                {String(value)}
              </span>
            </div>
          ))}
        </div>

        {connectedProcesses.length > 0 && (
          <div className="border-t border-white/10 pt-2 mb-2">
            <div className="text-[7px] font-mono text-white/30 uppercase tracking-wider mb-1">
              Connected Processes
            </div>
            <div className="space-y-1">
              {connectedProcesses.map((proc) => (
                <div
                  key={proc.id}
                  className="flex items-center gap-1.5"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        PROCESS_COLORS[proc.type] || '#6b7280',
                    }}
                  />
                  <span className="text-[7px] font-mono text-white/50">
                    {proc.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {entity.moleculeTemplate && (
          <button
            onClick={onViewMolecule}
            className="w-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-1.5 text-[8px] font-mono text-emerald-400 uppercase tracking-widest hover:bg-emerald-500/30 transition-colors cursor-pointer"
          >
            View Molecule
          </button>
        )}
      </div>
    </Html>
  );
}

function ProcessFlowArrow({
  from,
  to,
  processType,
}: {
  from: [number, number, number];
  to: [number, number, number];
  processType: string;
}) {
  const color = PROCESS_COLORS[processType] || '#6b7280';

  return (
    <Line
      points={[from, to]}
      color={color}
      lineWidth={2}
      transparent
      opacity={0.7}
    />
  );
}

function MoleculeScene({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  const primaryEntity =
    spec.entities.find((e) => e.type === 'compound_class') ||
    spec.entities[0];

  if (!primaryEntity) {
    return (
      <Html center>
        <div className="text-[9px] font-mono text-white/40 uppercase tracking-widest">
          No entities in scene
        </div>
      </Html>
    );
  }

  return (
    <group>
      <MoleculeViewer
        moleculeKey={primaryEntity.moleculeTemplate || 'THCa'}
        showLabels={spec.visualStyle.showLabels}
      />
      {selectedEntity && selectedEntity !== primaryEntity.id && (
        <EntityDetailPanel
          entity={primaryEntity}
          processes={spec.processes}
          onClose={() => onSelectEntity(null)}
        />
      )}
    </group>
  );
}

function CompoundNetworkScene({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  const { compounds, connections } = useMemo(() => {
    const compounds = spec.entities.map((e) => ({
      id: e.id,
      name: e.name,
      count: (e.properties.count as number) || 1,
      trend: (e.properties.trend as 'rising' | 'stable' | 'declining') || 'stable',
      category: (e.properties.category as string) || e.type,
      position: e.position,
    }));

    const connections = spec.relationships.map((r) => ({
      from: r.fromId,
      to: r.toId,
      strength: 0.5,
    }));

    return { compounds, connections };
  }, [spec.entities, spec.relationships]);

  return (
    <CompoundNetwork
      compounds={compounds}
      connections={connections}
      selectedCompound={selectedEntity}
      onSelectCompound={(id) => onSelectEntity(id)}
    />
  );
}

function ExtractionProcessScene({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  const entityPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    const count = spec.entities.length;
    spec.entities.forEach((e, i) => {
      if (e.position) {
        map.set(e.id, e.position);
      } else {
        const angle = (i / count) * Math.PI * 2;
        const radius = 3;
        map.set(e.id, [
          Math.cos(angle) * radius,
          0,
          Math.sin(angle) * radius,
        ]);
      }
    });
    return map;
  }, [spec.entities]);

  return (
    <group>
      {spec.processes.map((proc) => {
        if (!proc.fromEntityId || !proc.toEntityId) return null;
        const from = entityPositions.get(proc.fromEntityId);
        const to = entityPositions.get(proc.toEntityId);
        if (!from || !to) return null;
        return (
          <ProcessFlowArrow
            key={proc.id}
            from={from}
            to={to}
            processType={proc.type}
          />
        );
      })}

      {spec.entities.map((entity) => {
        const pos = entityPositions.get(entity.id) || [0, 0, 0];
        return (
          <group key={entity.id}>
            {entity.moleculeTemplate ? (
              <group position={pos}>
                <MoleculeViewer
                  moleculeKey={entity.moleculeTemplate}
                  showLabels={spec.visualStyle.showLabels}
                  autoRotate={false}
                />
              </group>
            ) : (
              <Html position={pos} center distanceFactor={8}>
                <div
                  className="bg-[#0D1411]/90 border border-white/10 px-3 py-2 text-center cursor-pointer hover:border-emerald-500/30 transition-colors pointer-events-auto select-none"
                  onClick={() => onSelectEntity(entity.id)}
                >
                  <div className="text-[9px] font-mono font-bold text-white uppercase tracking-widest">
                    {entity.name}
                  </div>
                  <div className="text-[7px] font-mono text-white/40 uppercase tracking-wider mt-0.5">
                    {entity.type}
                  </div>
                </div>
              </Html>
            )}
          </group>
        );
      })}

      {selectedEntity && (() => {
        const entity = spec.entities.find((e) => e.id === selectedEntity);
        if (!entity) return null;
        return (
          <EntityDetailPanel
            entity={entity}
            processes={spec.processes}
            onClose={() => onSelectEntity(null)}
          />
        );
      })()}
    </group>
  );
}

function TimelineScene({
  spec,
  selectedEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
}) {
  const heatmapData = useMemo(() => {
    return spec.entities.map((e) => ({
      period: (e.properties.period as string) || 'Unknown',
      compound: e.name,
      count: (e.properties.count as number) || 0,
    }));
  }, [spec.entities]);

  return (
    <PublicationHeatmap
      data={heatmapData}
    />
  );
}

function FormulationPipelineScene({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  const entityPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    const count = spec.entities.length;
    spec.entities.forEach((e, i) => {
      if (e.position) {
        map.set(e.id, e.position);
      } else {
        const spacing = 3;
        map.set(e.id, [
          (i - (count - 1) / 2) * spacing,
          0,
          0,
        ]);
      }
    });
    return map;
  }, [spec.entities]);

  return (
    <group>
      {spec.processes.map((proc) => {
        if (!proc.fromEntityId || !proc.toEntityId) return null;
        const from = entityPositions.get(proc.fromEntityId);
        const to = entityPositions.get(proc.toEntityId);
        if (!from || !to) return null;
        return (
          <ProcessFlowArrow
            key={proc.id}
            from={from}
            to={to}
            processType={proc.type}
          />
        );
      })}

      {spec.entities.map((entity) => {
        const pos = entityPositions.get(entity.id) || [0, 0, 0];
        return (
          <group key={entity.id} position={pos}>
            {entity.moleculeTemplate ? (
              <MoleculeViewer
                moleculeKey={entity.moleculeTemplate}
                showLabels={spec.visualStyle.showLabels}
                autoRotate={false}
              />
            ) : (
              <Html center distanceFactor={8}>
                <div
                  className="bg-[#0D1411]/90 border border-white/10 px-3 py-2 text-center cursor-pointer hover:border-emerald-500/30 transition-colors pointer-events-auto select-none"
                  onClick={() => onSelectEntity(entity.id)}
                >
                  <div className="text-[9px] font-mono font-bold text-white uppercase tracking-widest">
                    {entity.name}
                  </div>
                  <div className="text-[7px] font-mono text-white/40 uppercase tracking-wider mt-0.5">
                    {entity.type}
                  </div>
                </div>
              </Html>
            )}
          </group>
        );
      })}

      {selectedEntity && (() => {
        const entity = spec.entities.find((e) => e.id === selectedEntity);
        if (!entity) return null;
        return (
          <EntityDetailPanel
            entity={entity}
            processes={spec.processes}
            onClose={() => onSelectEntity(null)}
          />
        );
      })()}
    </group>
  );
}

function ComparativeAnalysisScene({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  const moleculeEntities = spec.entities.filter((e) => e.moleculeTemplate);
  const heatmapEntities = spec.entities.filter((e) => !e.moleculeTemplate);

  return (
    <group>
      <group position={[-2.5, 0, 0]}>
        {moleculeEntities.slice(0, 2).map((entity, i) => (
          <group key={entity.id} position={[i * 5, 0, 0]}>
            <MoleculeViewer
              moleculeKey={entity.moleculeTemplate!}
              showLabels={spec.visualStyle.showLabels}
              autoRotate={false}
            />
          </group>
        ))}
      </group>

      {heatmapEntities.length > 0 && (
        <group position={[0, -3, 0]}>
          <PublicationHeatmap
            data={heatmapEntities.map((e) => ({
              period: (e.properties.period as string) || 'Unknown',
              compound: e.name,
              count: (e.properties.count as number) || 0,
            }))}
          />
        </group>
      )}

      {selectedEntity && (() => {
        const entity = spec.entities.find((e) => e.id === selectedEntity);
        if (!entity) return null;
        return (
          <EntityDetailPanel
            entity={entity}
            processes={spec.processes}
            onClose={() => onSelectEntity(null)}
          />
        );
      })()}
    </group>
  );
}

function FieldTrialScene({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  const { compounds, connections } = useMemo(() => {
    const compounds = spec.entities.map((e) => ({
      id: e.id,
      name: e.name,
      count: (e.properties.plotSize as number) || 1,
      trend: 'stable' as const,
      category: (e.properties.strain as string) || e.type,
      position: e.position,
    }));

    const connections = spec.relationships.map((r) => ({
      from: r.fromId,
      to: r.toId,
      strength: 0.5,
    }));

    return { compounds, connections };
  }, [spec.entities, spec.relationships]);

  return (
    <CompoundNetwork
      compounds={compounds}
      connections={connections}
      selectedCompound={selectedEntity}
      onSelectCompound={(id) => onSelectEntity(id)}
    />
  );
}

function SceneContent({
  spec,
  selectedEntity,
  onSelectEntity,
}: {
  spec: SceneSpec;
  selectedEntity: string | null;
  onSelectEntity: (id: string | null) => void;
}) {
  switch (spec.sceneType) {
    case 'molecule':
      return (
        <MoleculeScene
          spec={spec}
          selectedEntity={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      );
    case 'compound_network':
      return (
        <CompoundNetworkScene
          spec={spec}
          selectedEntity={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      );
    case 'extraction_process':
      return (
        <ExtractionProcessScene
          spec={spec}
          selectedEntity={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      );
    case 'timeline':
      return (
        <TimelineScene
          spec={spec}
          selectedEntity={selectedEntity}
        />
      );
    case 'formulation_pipeline':
      return (
        <FormulationPipelineScene
          spec={spec}
          selectedEntity={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      );
    case 'comparative_analysis':
      return (
        <ComparativeAnalysisScene
          spec={spec}
          selectedEntity={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      );
    case 'field_trial':
      return (
        <FieldTrialScene
          spec={spec}
          selectedEntity={selectedEntity}
          onSelectEntity={onSelectEntity}
        />
      );
    default:
      return (
        <Html center>
          <div className="text-[9px] font-mono text-white/40 uppercase tracking-widest">
            Unknown scene type
          </div>
        </Html>
      );
  }
}

export default function SceneRenderer({
  spec,
  height = 480,
  onEntitySelect,
  onExport,
}: SceneRendererProps) {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  const handleSelectEntity = useCallback(
    (id: string | null) => {
      setSelectedEntity(id);
      if (id && onEntitySelect) {
        onEntitySelect(id);
      }
    },
    [onEntitySelect]
  );

  const cameraConfig: CameraConfig = spec.camera;

  return (
    <div className="relative">
      <SceneContainer
        height={height}
        camera={{
          position: cameraConfig.position,
          fov: cameraConfig.fov,
        }}
      >
        <Suspense fallback={null}>
          <SceneContent
            spec={spec}
            selectedEntity={selectedEntity}
            onSelectEntity={handleSelectEntity}
          />
        </Suspense>
      </SceneContainer>

      <SceneOverlay spec={spec} onExport={onExport} />
    </div>
  );
}
