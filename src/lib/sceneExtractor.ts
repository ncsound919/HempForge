import { SceneSpec, SceneEntity, SceneProcess, SceneRelationship, SceneParameter, createDefaultSceneSpec, HEMP_ONTOLOGY } from './sceneSpecSchema';
import { smartInfer } from './ollamaInference';

const COMPOUND_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bTHCa?\b/i, name: 'THCa' },
  { pattern: /\bDelta[-\s]?9[-\s]?THC\b/i, name: 'THC' },
  { pattern: /\bCBDa?\b/i, name: 'CBD' },
  { pattern: /\bCBGa?\b/i, name: 'CBG' },
  { pattern: /\bCBNa?\b/i, name: 'CBN' },
  { pattern: /\bCBCa?\b/i, name: 'CBC' },
  { pattern: /\bmyrcene\b/i, name: 'Myrcene' },
  { pattern: /\blimonene\b/i, name: 'Limonene' },
  { pattern: /\blinalool\b/i, name: 'Linalool' },
  { pattern: /\bpinene\b/i, name: 'Pinene' },
  { pattern: /\bcaryophyllene\b/i, name: 'Caryophyllene' },
  { pattern: /\bhumulene\b/i, name: 'Humulene' },
  { pattern: /\bquercetin\b/i, name: 'Quercetin' },
  { pattern: /\bapigenin\b/i, name: 'Apigenin' },
  { pattern: /\bcannaflavin\b/i, name: 'Cannaflavin A' },
];

const CONCENTRATION_PATTERN = /(\d+(?:\.\d+)?)\s*(%|mg\/g|mg\/mL|ppm|percent)/i;

const METHOD_PATTERNS: Array<{ pattern: RegExp; processType: SceneProcess['type']; name: string }> = [
  { pattern: /\bsupercritical\s+CO2\b/i, processType: 'extraction', name: 'Supercritical CO2 Extraction' },
  { pattern: /\bCO2\s+extraction\b/i, processType: 'extraction', name: 'CO2 Extraction' },
  { pattern: /\bethanol\s+extraction\b/i, processType: 'extraction', name: 'Ethanol Extraction' },
  { pattern: /\bhydrocarbon\s+extraction\b/i, processType: 'extraction', name: 'Hydrocarbon Extraction' },
  { pattern: /\brosin\s+press\b/i, processType: 'extraction', name: 'Rosin Pressing' },
  { pattern: /\bsolventless\b/i, processType: 'extraction', name: 'Solventless Extraction' },
  { pattern: /\bdecarboxylation\b/i, processType: 'decarboxylation', name: 'Decarboxylation' },
  { pattern: /\bdecarb\b/i, processType: 'decarboxylation', name: 'Decarboxylation' },
  { pattern: /\bdistillation\b/i, processType: 'distillation', name: 'Distillation' },
  { pattern: /\bshort[-\s]?path\b/i, processType: 'distillation', name: 'Short Path Distillation' },
  { pattern: /\bwiped\s+film\b/i, processType: 'distillation', name: 'Wiped Film Distillation' },
  { pattern: /\bcrystallization\b/i, processType: 'crystallization', name: 'Crystallization' },
  { pattern: /\bchromatography\b/i, processType: 'formulation', name: 'Chromatographic Separation' },
  { pattern: /\bfermentation\b/i, processType: 'fermentation', name: 'Fermentation' },
  { pattern: /\bcultivation\b/i, processType: 'growth', name: 'Cultivation' },
  { pattern: /\bharvest\b/i, processType: 'harvest', name: 'Harvesting' },
  { pattern: /\bHPLC\b/i, processType: 'testing', name: 'HPLC Analysis' },
  { pattern: /\bGC-MS\b/i, processType: 'testing', name: 'GC-MS Analysis' },
];

const EQUIPMENT_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bdecarboxylation\s+reactor\b/i, name: 'Decarboxylation Reactor' },
  { pattern: /\brotary\s+evaporator\b/i, name: 'Rotary Evaporator' },
  { pattern: /\brotovap\b/i, name: 'Rotary Evaporator' },
  { pattern: /\bshort[-\s]?path\s+still\b/i, name: 'Short Path Still' },
  { pattern: /\bclosed[-\s]?loop\s+extractor\b/i, name: 'Closed Loop Extractor' },
  { pattern: /\bHPLC\b/i, name: 'HPLC' },
  { pattern: /\bGC-MS\b/i, name: 'GC-MS' },
  { pattern: /\bfilter\s+press\b/i, name: 'Filter Press' },
  { pattern: /\bchromatography\s+column\b/i, name: 'Chromatography Column' },
];

const TEMPERATURE_PATTERN = /(\d+(?:\.\d+)?)\s*°?\s*[Cc]/;
const PRESSURE_PATTERN = /(\d+(?:\.\d+)?)\s*(?:psi|bar|atm|MPa)/i;
const PH_PATTERN = /pH\s*(?:of\s*)?(\d+(?:\.\d+)?)/i;
const YIELD_PATTERN = /(?:yield|recovery|extraction\s+rate)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/i;
const DURATION_PATTERN = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|minutes?|mins?)/i;

function extractCompounds(text: string): Array<{ name: string; concentration?: number; unit?: string }> {
  const found = new Map<string, { name: string; concentration?: number; unit?: string }>();

  for (const { pattern, name } of COMPOUND_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const windowStart = Math.max(0, match.index - 60);
      const windowEnd = Math.min(text.length, match.index + match[0].length + 60);
      const context = text.substring(windowStart, windowEnd);
      const concMatch = CONCENTRATION_PATTERN.exec(context);

      found.set(name, {
        name,
        concentration: concMatch ? parseFloat(concMatch[1]) : undefined,
        unit: concMatch ? concMatch[2] : undefined,
      });
    }
  }

  return Array.from(found.values());
}

function extractProcesses(text: string): SceneProcess[] {
  const processes: SceneProcess[] = [];
  const seen = new Set<string>();

  for (const { pattern, processType, name } of METHOD_PATTERNS) {
    if (pattern.test(text) && !seen.has(name)) {
      seen.add(name);
      const process: SceneProcess = {
        id: `proc-${seen.size}`,
        type: processType,
        name,
        parameters: {},
      };

      const tempMatch = TEMPERATURE_PATTERN.exec(text);
      if (tempMatch) {
        process.temperatureCelsius = parseFloat(tempMatch[1]);
        process.parameters.temperature = parseFloat(tempMatch[1]);
      }

      const durationMatch = DURATION_PATTERN.exec(text);
      if (durationMatch) {
        const val = parseFloat(durationMatch[1]);
        const unit = durationMatch[0].toLowerCase();
        process.durationMinutes = unit.includes('hour') || unit.includes('hr') ? val * 60 : val;
        process.parameters.duration = process.durationMinutes;
      }

      processes.push(process);
    }
  }

  return processes;
}

function extractEquipment(text: string): SceneEntity[] {
  const entities: SceneEntity[] = [];
  const seen = new Set<string>();

  for (const { pattern, name } of EQUIPMENT_PATTERNS) {
    if (pattern.test(text) && !seen.has(name)) {
      seen.add(name);
      const ontology = HEMP_ONTOLOGY[name];
      entities.push({
        id: `equip-${seen.size}`,
        type: 'equipment',
        name,
        properties: ontology ? { ...ontology.defaultProperties } : { type: 'general' },
      });
    }
  }

  return entities;
}

function extractParameters(text: string): SceneParameter[] {
  const params: SceneParameter[] = [];

  const tempMatch = TEMPERATURE_PATTERN.exec(text);
  if (tempMatch) {
    params.push({ name: 'Temperature', value: parseFloat(tempMatch[1]), unit: '°C', category: 'temperature' });
  }

  const pressureMatch = PRESSURE_PATTERN.exec(text);
  if (pressureMatch) {
    const unitMatch = pressureMatch[0].match(/(psi|bar|atm|MPa)/i);
    params.push({ name: 'Pressure', value: parseFloat(pressureMatch[1]), unit: unitMatch ? unitMatch[1] : 'psi', category: 'pressure' });
  }

  const phMatch = PH_PATTERN.exec(text);
  if (phMatch) {
    params.push({ name: 'pH', value: parseFloat(phMatch[1]), unit: 'pH', category: 'ph' });
  }

  const yieldMatch = YIELD_PATTERN.exec(text);
  if (yieldMatch) {
    params.push({ name: 'Yield', value: parseFloat(yieldMatch[1]), unit: '%', category: 'yield' });
  }

  return params;
}

function buildRelationships(entities: SceneEntity[], processes: SceneProcess[]): SceneRelationship[] {
  const relationships: SceneRelationship[] = [];
  const compoundEntities = entities.filter(e => e.type === 'compound_class');
  const extractEntities = entities.filter(e => e.type === 'extract');
  const biomassEntities = entities.filter(e => e.type === 'biomass');
  const equipmentEntities = entities.filter(e => e.type === 'equipment');
  const extractionProcesses = processes.filter(p => p.type === 'extraction');

  for (const proc of extractionProcesses) {
    for (const biomass of biomassEntities) {
      for (const extract of extractEntities) {
        relationships.push({
          fromId: biomass.id,
          toId: extract.id,
          type: 'transforms_into',
          label: proc.name,
        });
      }
    }
  }

  for (const compound of compoundEntities) {
    for (const extract of extractEntities) {
      relationships.push({
        fromId: extract.id,
        toId: compound.id,
        type: 'contains',
      });
    }
  }

  for (const compound of compoundEntities) {
    if (compound.name.includes('THCa') || compound.name.includes('THC')) {
      const decarb = processes.find(p => p.type === 'decarboxylation');
      if (decarb) {
        const thca = compoundEntities.find(e => e.name === 'THCa');
        const thc = compoundEntities.find(e => e.name === 'THC');
        if (thca && thc && compound.name === 'THCa') {
          relationships.push({
            fromId: thca.id,
            toId: thc.id,
            type: 'transforms_into',
            label: 'Decarboxylation',
          });
        }
      }
    }
  }

  for (const equip of equipmentEntities) {
    for (const proc of processes) {
      if (
        (equip.name.includes('HPLC') && proc.type === 'testing') ||
        (equip.name.includes('GC-MS') && proc.type === 'testing') ||
        (equip.name.includes('Reactor') && proc.type === 'decarboxylation') ||
        (equip.name.includes('Evaporator') && proc.type === 'distillation') ||
        (equip.name.includes('Still') && proc.type === 'distillation') ||
        (equip.name.includes('Extractor') && proc.type === 'extraction')
      ) {
        relationships.push({
          fromId: equip.id,
          toId: proc.id,
          type: 'enhances',
          label: `${equip.name} enables ${proc.name}`,
        });
      }
    }
  }

  return relationships;
}

function classifySceneType(processes: SceneProcess[], entities: SceneEntity[]): SceneSpec['sceneType'] {
  const hasExtraction = processes.some(p => p.type === 'extraction');
  const hasTesting = processes.some(p => p.type === 'testing');
  const hasCompounds = entities.some(e => e.type === 'compound_class');
  const hasEquipment = entities.some(e => e.type === 'equipment');

  if (hasCompounds && !hasExtraction && !hasTesting) return 'molecule';
  if (hasExtraction && hasEquipment) return 'extraction_process';
  if (hasTesting && hasCompounds) return 'comparative_analysis';
  if (hasCompounds && entities.length > 3) return 'compound_network';

  return 'extraction_process';
}

function estimateConfidence(entities: SceneEntity[], processes: SceneProcess[], params: SceneParameter[]): number {
  let score = 0;
  score += Math.min(entities.length * 0.1, 0.3);
  score += Math.min(processes.length * 0.1, 0.3);
  score += Math.min(params.length * 0.05, 0.2);
  if (entities.some(e => e.type === 'compound_class')) score += 0.1;
  if (entities.some(e => e.type === 'equipment')) score += 0.05;
  if (processes.length > 0) score += 0.05;
  return Math.min(score, 1);
}

export function extractSceneFromText(text: string, paperId?: string): SceneSpec {
  const compounds = extractCompounds(text);
  const processes = extractProcesses(text);
  const equipment = extractEquipment(text);
  const parameters = extractParameters(text);

  const entities: SceneEntity[] = [];

  for (const compound of compounds) {
    const ontology = HEMP_ONTOLOGY[compound.name];
    const entity: SceneEntity = {
      id: `entity-${entities.length + 1}`,
      type: ontology?.type || 'compound_class',
      name: compound.name,
      properties: {
        ...(ontology?.defaultProperties || {}),
        ...(compound.concentration !== undefined ? { concentration: compound.concentration, concentrationUnit: compound.unit || '%' } : {}),
      },
    };
    if (ontology?.moleculeTemplate) {
      entity.moleculeTemplate = ontology.moleculeTemplate;
    }
    entities.push(entity);
  }

  if (!entities.some(e => e.type === 'biomass') && text.toLowerCase().includes('hemp')) {
    const biomassOntology = HEMP_ONTOLOGY['Hemp Biomass'];
    entities.push({
      id: `entity-${entities.length + 1}`,
      type: 'biomass',
      name: 'Hemp Biomass',
      properties: { ...biomassOntology.defaultProperties },
    });
  }

  const hasExtract = processes.some(p => p.type === 'extraction');
  if (hasExtract) {
    const methodMatch = /(?:CO2|ethanol|hydrocarbon|rosin)/i.exec(text);
    const extractName = methodMatch ? `${methodMatch[0]} Extract` : 'CO2 Extract';
    const ontology = HEMP_ONTOLOGY[extractName] || HEMP_ONTOLOGY['CO2 Extract'];
    entities.push({
      id: `entity-${entities.length + 1}`,
      type: 'extract',
      name: extractName,
      properties: { ...ontology.defaultProperties },
    });
  }

  entities.push(...equipment);

  const relationships = buildRelationships(entities, processes);
  const sceneType = classifySceneType(processes, entities);
  const confidence = estimateConfidence(entities, processes, parameters);

  const spec = createDefaultSceneSpec(
    `Extracted Scene from Research`,
    sceneType
  );

  spec.entities = entities;
  spec.processes = processes;
  spec.relationships = relationships;
  spec.parameters = parameters;
  spec.confidence = confidence;
  spec.paperId = paperId;

  if (paperId) {
    const titleMatch = text.match(/^.{10,120}/m);
    spec.title = titleMatch ? titleMatch[0].trim().substring(0, 100) : `Scene from paper ${paperId}`;
  }

  const descParts: string[] = [];
  if (compounds.length > 0) descParts.push(`Compounds: ${compounds.map(c => c.name).join(', ')}`);
  if (processes.length > 0) descParts.push(`Processes: ${processes.map(p => p.name).join(', ')}`);
  if (equipment.length > 0) descParts.push(`Equipment: ${equipment.map(e => e.name).join(', ')}`);
  spec.description = descParts.join('. ');

  return spec;
}

const LLM_SCENE_PROMPT = `You are a hemp/cannabis research visualization assistant. Analyze the following text and extract a SceneSpec for 3D visualization.

Return a JSON object with:
- title: descriptive title for the scene
- sceneType: one of "molecule", "extraction_process", "field_trial", "comparative_analysis", "timeline", "compound_network", "formulation_pipeline"
- description: 1-2 sentence summary
- entities: array of objects with {id, type ("molecule"|"sample"|"equipment"|"strain"|"compound_class"|"biomass"|"extract"|"field_plot"), name, properties (object), moleculeTemplate (if compound: "THCa"|"THC"|"CBD"|"CBG"|"CBN"|"CBC"|null)}
- processes: array of objects with {id, type ("extraction"|"decarboxylation"|"fermentation"|"distillation"|"crystallization"|"growth"|"harvest"|"testing"|"formulation"), name, fromEntityId, toEntityId, parameters (object), temperatureCelsius, durationMinutes}
- relationships: array of objects with {fromId, toId, type ("produces"|"contains"|"transforms_into"|"measures"|"inhibits"|"enhances"), label}
- parameters: array of objects with {name, value (number), unit, category ("temperature"|"pressure"|"time"|"concentration"|"ph"|"yield"|"other")}
- camera: {position: [x,y,z], target: [x,y,z], fov (number), preset: "isometric"|"closeup"|"overview"|"side"|"top"}
- visualStyle: {colorTheme: "lab"|"field"|"molecular"|"industrial"|"clinical", lighting: "soft"|"dramatic"|"flat", showLabels (boolean), showDataLabels (boolean), animationSpeed (number 0-1)}

Text to analyze:
---
{TEXT}
---

Return ONLY the JSON object.`;

function mergeScenes(base: SceneSpec, llmData: Partial<SceneSpec>): SceneSpec {
  const merged = { ...base };

  if (llmData.title) merged.title = llmData.title;
  if (llmData.description) merged.description = llmData.description;
  if (llmData.sceneType) merged.sceneType = llmData.sceneType;

  if (llmData.entities && llmData.entities.length > 0) {
    const existingIds = new Set(base.entities.map(e => e.id));
    const newEntities = llmData.entities.filter(e => !existingIds.has(e.id));
    merged.entities = [...base.entities, ...newEntities];
  }

  if (llmData.processes && llmData.processes.length > 0) {
    const existingIds = new Set(base.processes.map(p => p.id));
    const newProcesses = llmData.processes.filter(p => !existingIds.has(p.id));
    merged.processes = [...base.processes, ...newProcesses];
  }

  if (llmData.relationships && llmData.relationships.length > 0) {
    merged.relationships = [...base.relationships, ...llmData.relationships];
  }

  if (llmData.parameters && llmData.parameters.length > 0) {
    merged.parameters = [...base.parameters, ...llmData.parameters];
  }

  if (llmData.camera) {
    merged.camera = { ...base.camera, ...llmData.camera };
  }

  if (llmData.visualStyle) {
    merged.visualStyle = { ...base.visualStyle, ...llmData.visualStyle };
  }

  return merged;
}

export async function extractSceneWithLLM(text: string, paperId?: string): Promise<SceneSpec> {
  const baseScene = extractSceneFromText(text, paperId);

  if (baseScene.confidence >= 0.5) {
    return baseScene;
  }

  const prompt = LLM_SCENE_PROMPT.replace('{TEXT}', text.substring(0, 4000));

  try {
    const result = await smartInfer(prompt, {
      format: 'json',
      preferLocal: true,
      systemPrompt: 'You are a precise hemp research visualization assistant. Return only valid JSON for a SceneSpec.',
      timeout: 15000,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return baseScene;
      }
    }

    const llmScene: Partial<SceneSpec> = {};

    if (typeof parsed.title === 'string') llmScene.title = parsed.title;
    if (typeof parsed.description === 'string') llmScene.description = parsed.description;
    if (typeof parsed.sceneType === 'string') llmScene.sceneType = parsed.sceneType as SceneSpec['sceneType'];

    if (Array.isArray(parsed.entities)) {
      llmScene.entities = parsed.entities.filter((e: unknown): e is SceneEntity => {
        if (typeof e !== 'object' || e === null) return false;
        const obj = e as Record<string, unknown>;
        return typeof obj.id === 'string' && typeof obj.name === 'string' && typeof obj.type === 'string';
      });
    }

    if (Array.isArray(parsed.processes)) {
      llmScene.processes = parsed.processes.filter((p: unknown): p is SceneProcess => {
        if (typeof p !== 'object' || p === null) return false;
        const obj = p as Record<string, unknown>;
        return typeof obj.id === 'string' && typeof obj.name === 'string' && typeof obj.type === 'string';
      });
    }

    if (Array.isArray(parsed.relationships)) {
      llmScene.relationships = parsed.relationships.filter((r: unknown): r is SceneSpec['relationships'][0] => {
        if (typeof r !== 'object' || r === null) return false;
        const obj = r as Record<string, unknown>;
        return typeof obj.fromId === 'string' && typeof obj.toId === 'string' && typeof obj.type === 'string';
      });
    }

    if (Array.isArray(parsed.parameters)) {
      llmScene.parameters = parsed.parameters.filter((p: unknown): p is SceneSpec['parameters'][0] => {
        if (typeof p !== 'object' || p === null) return false;
        const obj = p as Record<string, unknown>;
        return typeof obj.name === 'string' && typeof obj.value === 'number' && typeof obj.unit === 'string';
      });
    }

    if (typeof parsed.camera === 'object' && parsed.camera !== null) {
      const cam = parsed.camera as Record<string, unknown>;
      if (Array.isArray(cam.position) && Array.isArray(cam.target) && typeof cam.fov === 'number') {
        llmScene.camera = {
          position: cam.position as [number, number, number],
          target: cam.target as [number, number, number],
          fov: cam.fov,
          preset: typeof cam.preset === 'string' ? cam.preset as SceneSpec['camera']['preset'] : undefined,
        };
      }
    }

    if (typeof parsed.visualStyle === 'object' && parsed.visualStyle !== null) {
      const vs = parsed.visualStyle as Record<string, unknown>;
      llmScene.visualStyle = {
        colorTheme: (typeof vs.colorTheme === 'string' ? vs.colorTheme : baseScene.visualStyle.colorTheme) as SceneSpec['visualStyle']['colorTheme'],
        lighting: (typeof vs.lighting === 'string' ? vs.lighting : baseScene.visualStyle.lighting) as SceneSpec['visualStyle']['lighting'],
        showLabels: typeof vs.showLabels === 'boolean' ? vs.showLabels : baseScene.visualStyle.showLabels,
        showDataLabels: typeof vs.showDataLabels === 'boolean' ? vs.showDataLabels : baseScene.visualStyle.showDataLabels,
        animationSpeed: typeof vs.animationSpeed === 'number' ? vs.animationSpeed : baseScene.visualStyle.animationSpeed,
      };
    }

    const merged = mergeScenes(baseScene, llmScene);
    merged.confidence = Math.min(baseScene.confidence + 0.3, 1.0);
    return merged;
  } catch (err) {
    console.warn('[extractSceneWithLLM] LLM extraction failed, returning pure extraction:', err);
    return baseScene;
  }
}
