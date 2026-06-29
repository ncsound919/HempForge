export interface SceneSpec {
  id: string;
  paperId?: string;
  title: string;
  description: string;
  sceneType: 'molecule' | 'extraction_process' | 'field_trial' | 'comparative_analysis' | 'timeline' | 'compound_network' | 'formulation_pipeline';
  entities: SceneEntity[];
  processes: SceneProcess[];
  relationships: SceneRelationship[];
  parameters: SceneParameter[];
  camera: CameraConfig;
  visualStyle: VisualStyle;
  generatedAt: string;
  confidence: number;
}

export interface SceneEntity {
  id: string;
  type: 'molecule' | 'sample' | 'equipment' | 'strain' | 'compound_class' | 'biomass' | 'extract' | 'field_plot';
  name: string;
  properties: Record<string, string | number | boolean>;
  position?: [number, number, number];
  scale?: number;
  moleculeTemplate?: 'THCa' | 'THC' | 'CBD' | 'CBG' | 'CBN' | 'CBC' | 'custom';
}

export interface SceneProcess {
  id: string;
  type: 'extraction' | 'decarboxylation' | 'fermentation' | 'distillation' | 'crystallization' | 'growth' | 'harvest' | 'testing' | 'formulation';
  name: string;
  fromEntityId?: string;
  toEntityId?: string;
  parameters: Record<string, string | number>;
  durationMinutes?: number;
  temperatureCelsius?: number;
}

export interface SceneRelationship {
  fromId: string;
  toId: string;
  type: 'produces' | 'contains' | 'transforms_into' | 'measures' | 'inhibits' | 'enhances';
  label?: string;
}

export interface SceneParameter {
  name: string;
  value: number;
  unit: string;
  category: 'temperature' | 'pressure' | 'time' | 'concentration' | 'ph' | 'yield' | 'other';
}

export interface CameraConfig {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  preset?: 'isometric' | 'closeup' | 'overview' | 'side' | 'top';
}

export interface VisualStyle {
  colorTheme: 'lab' | 'field' | 'molecular' | 'industrial' | 'clinical';
  lighting: 'soft' | 'dramatic' | 'flat';
  showLabels: boolean;
  showDataLabels: boolean;
  animationSpeed: number;
}

export const HEMP_ONTOLOGY: Record<string, { type: SceneEntity['type']; defaultProperties: Record<string, string | number>; moleculeTemplate?: SceneEntity['moleculeTemplate'] }> = {
  'THCa': { type: 'compound_class', defaultProperties: { molecularFormula: 'C22H30O4', molecularWeight: 358.48 }, moleculeTemplate: 'THCa' },
  'THC': { type: 'compound_class', defaultProperties: { molecularFormula: 'C21H30O2', molecularWeight: 314.47 }, moleculeTemplate: 'THC' },
  'CBD': { type: 'compound_class', defaultProperties: { molecularFormula: 'C21H30O2', molecularWeight: 314.47 }, moleculeTemplate: 'CBD' },
  'CBG': { type: 'compound_class', defaultProperties: { molecularFormula: 'C21H32O2', molecularWeight: 316.49 }, moleculeTemplate: 'CBG' },
  'CBN': { type: 'compound_class', defaultProperties: { molecularFormula: 'C21H26O2', molecularWeight: 310.44 }, moleculeTemplate: 'CBN' },
  'CBC': { type: 'compound_class', defaultProperties: { molecularFormula: 'C21H30O2', molecularWeight: 314.47 } },
  'Myrcene': { type: 'compound_class', defaultProperties: { molecularFormula: 'C10H16', molecularWeight: 136.24, class: 'terpene' } },
  'Limonene': { type: 'compound_class', defaultProperties: { molecularFormula: 'C10H16', molecularWeight: 136.24, class: 'terpene' } },
  'Linalool': { type: 'compound_class', defaultProperties: { molecularFormula: 'C10H18O', molecularWeight: 154.25, class: 'terpene' } },
  'Pinene': { type: 'compound_class', defaultProperties: { molecularFormula: 'C10H16', molecularWeight: 136.24, class: 'terpene' } },
  'Caryophyllene': { type: 'compound_class', defaultProperties: { molecularFormula: 'C15H24', molecularWeight: 204.36, class: 'terpene' } },
  'Humulene': { type: 'compound_class', defaultProperties: { molecularFormula: 'C15H24', molecularWeight: 204.36, class: 'terpene' } },
  'Quercetin': { type: 'compound_class', defaultProperties: { molecularFormula: 'C15H10O7', molecularWeight: 302.24, class: 'flavonoid' } },
  'Apigenin': { type: 'compound_class', defaultProperties: { molecularFormula: 'C15H10O5', molecularWeight: 270.24, class: 'flavonoid' } },
  'Cannaflavin A': { type: 'compound_class', defaultProperties: { molecularFormula: 'C21H26O5', molecularWeight: 358.43, class: 'flavonoid' } },
  'Hemp Biomass': { type: 'biomass', defaultProperties: { state: 'solid', moisture: '10-15%' } },
  'CO2 Extract': { type: 'extract', defaultProperties: { state: 'liquid', method: 'supercritical CO2' } },
  'Ethanol Extract': { type: 'extract', defaultProperties: { state: 'liquid', method: 'ethanol' } },
  'Hydrocarbon Extract': { type: 'extract', defaultProperties: { state: 'liquid', method: 'hydrocarbon' } },
  'Rosin': { type: 'extract', defaultProperties: { state: 'solid', method: 'solventless' } },
  'Distillate': { type: 'extract', defaultProperties: { state: 'viscous_liquid', method: 'distillation' } },
  'Isolate': { type: 'extract', defaultProperties: { state: 'solid', method: 'crystallization' } },
  'Decarboxylation Reactor': { type: 'equipment', defaultProperties: { type: 'reactor', maxTemp: 160 } },
  'Rotary Evaporator': { type: 'equipment', defaultProperties: { type: 'evaporator' } },
  'Short Path Still': { type: 'equipment', defaultProperties: { type: 'still' } },
  'HPLC': { type: 'equipment', defaultProperties: { type: 'analytical_instrument' } },
  'GC-MS': { type: 'equipment', defaultProperties: { type: 'analytical_instrument' } },
  'Closed Loop Extractor': { type: 'equipment', defaultProperties: { type: 'extractor' } },
  'Filter Press': { type: 'equipment', defaultProperties: { type: 'filtration' } },
  'Chromatography Column': { type: 'equipment', defaultProperties: { type: 'purification' } },
};

function generateId(): string {
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultSceneSpec(title: string, sceneType: SceneSpec['sceneType']): SceneSpec {
  const cameraPresets: Record<SceneSpec['sceneType'], CameraConfig> = {
    molecule: { position: [4, 3, 4], target: [0, 0, 0], fov: 50, preset: 'closeup' },
    extraction_process: { position: [6, 4, 6], target: [0, 0, 0], fov: 55, preset: 'overview' },
    field_trial: { position: [8, 6, 8], target: [0, 0, 0], fov: 60, preset: 'overview' },
    comparative_analysis: { position: [0, 8, 0], target: [0, 0, 0], fov: 50, preset: 'top' },
    timeline: { position: [10, 3, 0], target: [0, 0, 0], fov: 55, preset: 'side' },
    compound_network: { position: [0, 5, 7], target: [0, 0, 0], fov: 50, preset: 'isometric' },
    formulation_pipeline: { position: [6, 4, 6], target: [0, 0, 0], fov: 55, preset: 'isometric' },
  };

  const visualStyles: Record<SceneSpec['sceneType'], VisualStyle> = {
    molecule: { colorTheme: 'molecular', lighting: 'dramatic', showLabels: true, showDataLabels: false, animationSpeed: 0.5 },
    extraction_process: { colorTheme: 'industrial', lighting: 'soft', showLabels: true, showDataLabels: true, animationSpeed: 0.7 },
    field_trial: { colorTheme: 'field', lighting: 'flat', showLabels: true, showDataLabels: true, animationSpeed: 0.3 },
    comparative_analysis: { colorTheme: 'lab', lighting: 'soft', showLabels: true, showDataLabels: true, animationSpeed: 0.5 },
    timeline: { colorTheme: 'lab', lighting: 'flat', showLabels: true, showDataLabels: true, animationSpeed: 0.4 },
    compound_network: { colorTheme: 'molecular', lighting: 'dramatic', showLabels: true, showDataLabels: false, animationSpeed: 0.6 },
    formulation_pipeline: { colorTheme: 'clinical', lighting: 'soft', showLabels: true, showDataLabels: true, animationSpeed: 0.5 },
  };

  return {
    id: generateId(),
    title,
    description: '',
    sceneType,
    entities: [],
    processes: [],
    relationships: [],
    parameters: [],
    camera: cameraPresets[sceneType],
    visualStyle: visualStyles[sceneType],
    generatedAt: new Date().toISOString(),
    confidence: 0,
  };
}

export function validateSceneSpec(spec: unknown): spec is SceneSpec {
  if (typeof spec !== 'object' || spec === null) return false;
  const s = spec as Record<string, unknown>;

  if (typeof s.id !== 'string') return false;
  if (typeof s.title !== 'string') return false;
  if (typeof s.description !== 'string') return false;

  const validSceneTypes = ['molecule', 'extraction_process', 'field_trial', 'comparative_analysis', 'timeline', 'compound_network', 'formulation_pipeline'];
  if (!validSceneTypes.includes(s.sceneType as string)) return false;

  if (!Array.isArray(s.entities)) return false;
  if (!Array.isArray(s.processes)) return false;
  if (!Array.isArray(s.relationships)) return false;
  if (!Array.isArray(s.parameters)) return false;

  if (typeof s.camera !== 'object' || s.camera === null) return false;
  const cam = s.camera as Record<string, unknown>;
  if (!Array.isArray(cam.position) || cam.position.length !== 3) return false;
  if (!Array.isArray(cam.target) || cam.target.length !== 3) return false;
  if (typeof cam.fov !== 'number') return false;

  if (typeof s.visualStyle !== 'object' || s.visualStyle === null) return false;
  const vs = s.visualStyle as Record<string, unknown>;
  const validColorThemes = ['lab', 'field', 'molecular', 'industrial', 'clinical'];
  if (!validColorThemes.includes(vs.colorTheme as string)) return false;

  if (typeof s.generatedAt !== 'string') return false;
  if (typeof s.confidence !== 'number') return false;

  for (const entity of s.entities) {
    if (typeof entity !== 'object' || entity === null) return false;
    const e = entity as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.type !== 'string') return false;
    if (typeof e.properties !== 'object' || e.properties === null) return false;
  }

  for (const process of s.processes) {
    if (typeof process !== 'object' || process === null) return false;
    const p = process as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.type !== 'string') return false;
    if (typeof p.parameters !== 'object' || p.parameters === null) return false;
  }

  for (const rel of s.relationships) {
    if (typeof rel !== 'object' || rel === null) return false;
    const r = rel as Record<string, unknown>;
    if (typeof r.fromId !== 'string' || typeof r.toId !== 'string' || typeof r.type !== 'string') return false;
  }

  for (const param of s.parameters) {
    if (typeof param !== 'object' || param === null) return false;
    const p = param as Record<string, unknown>;
    if (typeof p.name !== 'string' || typeof p.value !== 'number' || typeof p.unit !== 'string' || typeof p.category !== 'string') return false;
  }

  return true;
}
