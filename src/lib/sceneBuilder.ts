import type { SceneSpec, SceneEntity, SceneProcess, CameraConfig } from './sceneSpecSchema';

export interface RenderableScene {
  molecules: MoleculeConfig[];
  network: NetworkConfig;
  heatmap: HeatmapConfig[];
  processFlows: ProcessFlowConfig[];
  camera: CameraConfig;
  labels: LabelConfig[];
}

export interface MoleculeConfig {
  template: string;
  position: [number, number, number];
  scale: number;
  label: string;
  highlighted: boolean;
}

export interface NetworkConfig {
  nodes: Array<{
    id: string;
    name: string;
    count: number;
    trend: 'rising' | 'stable' | 'declining';
    category: string;
    position?: [number, number, number];
  }>;
  edges: Array<{
    from: string;
    to: string;
    strength: number;
  }>;
}

export interface HeatmapConfig {
  period: string;
  compound: string;
  count: number;
}

export interface ProcessFlowConfig {
  id: string;
  type: string;
  from: [number, number, number];
  to: [number, number, number];
  label: string;
  color: string;
}

export interface LabelConfig {
  text: string;
  position: [number, number, number];
  color: string;
}

const PROCESS_COLORS: Record<string, string> = {
  extraction: '#10b981',
  decarboxylation: '#f59e0b',
  fermentation: '#8b5cf6',
  distillation: '#3b82f6',
  crystallization: '#06b6d4',
  growth: '#22c55e',
  harvest: '#f97316',
  testing: '#ef4444',
  formulation: '#ec4899',
};

const ENTITY_CATEGORY_MAP: Record<string, string> = {
  molecule: 'Cannabinoid',
  compound_class: 'Cannabinoid',
  biomass: 'Raw Material',
  extract: 'Extract',
  equipment: 'Equipment',
  sample: 'Sample',
  strain: 'Cultivar',
  field_plot: 'Field',
};

function circularLayout(count: number, radius: number): Array<[number, number, number]> {
  const positions: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    positions.push([
      Math.cos(angle) * radius,
      (Math.sin(i * 1.7) * 0.5),
      Math.sin(angle) * radius,
    ]);
  }
  return positions;
}

function linearLayout(count: number, spacing: number): Array<[number, number, number]> {
  const positions: Array<[number, number, number]> = [];
  const startX = -((count - 1) * spacing) / 2;
  for (let i = 0; i < count; i++) {
    positions.push([startX + i * spacing, 0, 0]);
  }
  return positions;
}

function hierarchicalLayout(
  entities: SceneEntity[],
  processes: SceneProcess[]
): Map<string, [number, number, number]> {
  const positions = new Map<string, [number, number, number]>();
  const layers: string[][] = [];

  const inputEntities = entities.filter(e =>
    e.type === 'biomass' || e.type === 'sample' || e.type === 'strain' || e.type === 'field_plot'
  );
  const processEntities = processes;
  const outputEntities = entities.filter(e =>
    e.type === 'extract' || e.type === 'compound_class' || e.type === 'molecule'
  );
  const equipmentEntities = entities.filter(e => e.type === 'equipment');

  if (inputEntities.length > 0) layers.push(inputEntities.map(e => e.id));
  if (processEntities.length > 0) layers.push(processEntities.map(p => p.id));
  if (outputEntities.length > 0) layers.push(outputEntities.map(e => e.id));

  const layerSpacing = 4;
  const startY = -((layers.length - 1) * layerSpacing) / 2;

  layers.forEach((layer, layerIdx) => {
    const layerPositions = circularLayout(layer.length, 2.5);
    layer.forEach((id, i) => {
      positions.set(id, [
        layerPositions[i][0],
        startY + layerIdx * layerSpacing,
        layerPositions[i][2],
      ]);
    });
  });

  equipmentEntities.forEach((equip, i) => {
    positions.set(equip.id, [
      -5 + i * 2,
      0,
      -3,
    ]);
  });

  return positions;
}

export function layoutEntities(entities: SceneEntity[]): Map<string, [number, number, number]> {
  const positions = new Map<string, [number, number, number]>();

  const compoundEntities = entities.filter(e => e.type === 'compound_class' || e.type === 'molecule');
  const otherEntities = entities.filter(e => e.type !== 'compound_class' && e.type !== 'molecule');

  const compoundPositions = circularLayout(compoundEntities.length, 3);
  compoundEntities.forEach((entity, i) => {
    positions.set(entity.id, compoundPositions[i]);
  });

  const otherPositions = circularLayout(otherEntities.length, 5);
  otherEntities.forEach((entity, i) => {
    const basePos = otherPositions[i];
    positions.set(entity.id, [
      basePos[0] * 1.5,
      basePos[1] + 2,
      basePos[2] * 1.5,
    ]);
  });

  return positions;
}

export function buildProcessFlows(
  processes: SceneProcess[],
  positions: Map<string, [number, number, number]>
): ProcessFlowConfig[] {
  const flows: ProcessFlowConfig[] = [];

  for (const process of processes) {
    const fromPos = process.fromEntityId
      ? positions.get(process.fromEntityId)
      : undefined;
    const toPos = process.toEntityId
      ? positions.get(process.toEntityId)
      : undefined;

    const start: [number, number, number] = fromPos || [0, 0, 0];
    const end: [number, number, number] = toPos || [3, 0, 0];

    flows.push({
      id: process.id,
      type: process.type,
      from: start,
      to: end,
      label: process.name,
      color: PROCESS_COLORS[process.type] || '#6b7280',
    });

    if (!fromPos && !toPos) {
      flows[flows.length - 1].from = [-2, 0, 0];
      flows[flows.length - 1].to = [2, 0, 0];
    }
  }

  return flows;
}

function buildMoleculeConfigs(entities: SceneEntity[], positions: Map<string, [number, number, number]>): MoleculeConfig[] {
  return entities
    .filter(e => e.moleculeTemplate)
    .map(entity => ({
      template: entity.moleculeTemplate!,
      position: positions.get(entity.id) || [0, 0, 0],
      scale: entity.scale || 1,
      label: entity.name,
      highlighted: false,
    }));
}

function buildNetworkConfig(
  entities: SceneEntity[],
  positions: Map<string, [number, number, number]>,
  spec: SceneSpec
): NetworkConfig {
  const nodes = entities.map(entity => ({
    id: entity.id,
    name: entity.name,
    count: typeof entity.properties.concentration === 'number' ? entity.properties.concentration : 1,
    trend: 'stable' as const,
    category: ENTITY_CATEGORY_MAP[entity.type] || 'Other',
    position: positions.get(entity.id),
  }));

  const edges = spec.relationships.map(rel => ({
    from: rel.fromId,
    to: rel.toId,
    strength: rel.type === 'contains' ? 0.8 : rel.type === 'transforms_into' ? 0.9 : 0.5,
  }));

  return { nodes, edges };
}

function buildHeatmapData(spec: SceneSpec): HeatmapConfig[] {
  const heatmapData: HeatmapConfig[] = [];
  const compounds = spec.entities.filter(e => e.type === 'compound_class' || e.type === 'molecule');

  for (const compound of compounds) {
    const concentration = typeof compound.properties.concentration === 'number'
      ? compound.properties.concentration
      : typeof compound.properties.count === 'number'
        ? compound.properties.count
        : 1;

    heatmapData.push({
      period: spec.generatedAt.substring(0, 7),
      compound: compound.name,
      count: Math.round(concentration),
    });
  }

  return heatmapData;
}

function buildLabels(
  entities: SceneEntity[],
  processes: SceneProcess[],
  positions: Map<string, [number, number, number]>
): LabelConfig[] {
  const labels: LabelConfig[] = [];

  for (const entity of entities) {
    const pos = positions.get(entity.id);
    if (pos) {
      labels.push({
        text: entity.name,
        position: [pos[0], pos[1] + 0.5, pos[2]],
        color: '#10b981',
      });
    }
  }

  for (const process of processes) {
    const fromPos = process.fromEntityId ? positions.get(process.fromEntityId) : undefined;
    const toPos = process.toEntityId ? positions.get(process.toEntityId) : undefined;

    if (fromPos && toPos) {
      const midPos: [number, number, number] = [
        (fromPos[0] + toPos[0]) / 2,
        (fromPos[1] + toPos[1]) / 2 + 1.2,
        (fromPos[2] + toPos[2]) / 2,
      ];
      labels.push({
        text: process.name,
        position: midPos,
        color: PROCESS_COLORS[process.type] || '#6b7280',
      });
    }
  }

  return labels;
}

export function buildRenderableScene(spec: SceneSpec): RenderableScene {
  const positions = spec.processes.length > 0 && spec.entities.length > 0
    ? hierarchicalLayout(spec.entities, spec.processes)
    : layoutEntities(spec.entities);

  const molecules = buildMoleculeConfigs(spec.entities, positions);
  const network = buildNetworkConfig(spec.entities, positions, spec);
  const heatmap = buildHeatmapData(spec);
  const processFlows = buildProcessFlows(spec.processes, positions);
  const labels = buildLabels(spec.entities, spec.processes, positions);

  return {
    molecules,
    network,
    heatmap,
    processFlows,
    camera: {
      position: spec.camera.position,
      target: spec.camera.target,
      fov: spec.camera.fov,
    },
    labels,
  };
}
