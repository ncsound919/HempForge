export type OutputClassification = 'live-ai-inference' | 'simulated' | 'heuristic-fallback' | 'deterministic-formula' | 'demo-only' | 'ai-generated-inference';

export function createLiveAIProvenance(data: any, context: any) {
  return {
    outputClassification: 'live-ai-inference',
    scientificClassification: 'ai-generated-inference',
    data,
    provenance: {
      source: { identity: context.model, type: 'ai-model' },
      timestamp: new Date().toISOString(),
      verificationStatus: 'ai-generated',
      triggeredBy: { userId: context.userId, userRole: context.userRole, tenantId: context.tenantId }
    },
    disclaimers: ['AI Inference']
  };
}

export function createSimulatedProvenance(data: any, context: any) {
  return {
    outputClassification: 'simulated',
    scientificClassification: 'speculative-hypothesis',
    data,
    provenance: {
      source: { identity: context.fallbackMethod, type: 'fallback' },
      timestamp: new Date().toISOString(),
      verificationStatus: 'simulated',
      triggeredBy: { userId: context.userId, userRole: context.userRole, tenantId: context.tenantId }
    },
    disclaimers: ['SIMULATED', 'MUST NOT']
  };
}

export function createFormulaProvenance(data: any, context: any) {
  return {
    outputClassification: 'deterministic-formula',
    scientificClassification: 'deterministic-formula',
    data,
    provenance: {
      source: { identity: context.formula, type: 'formula' },
      timestamp: new Date().toISOString(),
      verificationStatus: 'verified',
      triggeredBy: { userId: context.userId, userRole: context.userRole, tenantId: context.tenantId }
    },
    disclaimers: []
  };
}

export function createHeuristicProvenance(data: any, context: any) {
  return {
    outputClassification: 'heuristic-fallback',
    scientificClassification: 'heuristic',
    data,
    provenance: {
      source: { identity: context.method, type: 'heuristic' },
      timestamp: new Date().toISOString(),
      verificationStatus: 'unverified',
      triggeredBy: { userId: context.userId, userRole: context.userRole, tenantId: context.tenantId }
    },
    disclaimers: []
  };
}

export function labelDemoData(data: any, source: string) {
  return {
    outputClassification: 'demo-only',
    scientificClassification: 'demo',
    data,
    provenance: {
      source: { identity: source, type: 'demo' },
      timestamp: new Date().toISOString(),
      verificationStatus: 'simulated',
      triggeredBy: { userId: 'system', userRole: 'system', tenantId: 'system' }
    },
    disclaimers: ['DEMO DATA']
  };
}
