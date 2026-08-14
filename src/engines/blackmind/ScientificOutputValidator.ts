import type { ValidationResult, ValidationError, ValidationWarning, ValidatorType, ValidationConfig } from './types'

const DEFAULT_CONFIG: ValidationConfig = {
  enabledValidators: ['data', 'trend', 'insight', 'cross-domain', 'drift', 'science-paper'],
  strictMode: false,
  allowWarnings: true,
  thresholds: { minConfidence: 0.7, maxPValue: 0.05, maxNoiseRatio: 0.3, maxDriftScore: 0.15 },
}

export class ScientificOutputValidator {
  private config: ValidationConfig

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async validate(output: unknown, type: ValidatorType): Promise<ValidationResult> {
    const startTime = Date.now()
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []
    try {
      switch (type) {
        case 'data': this.validateData(output, errors, warnings); break
        case 'trend': this.validateTrend(output, errors, warnings); break
        case 'insight': await this.validateInsight(output, errors, warnings); break
        case 'cross-domain': await this.validateCrossDomain(output, errors, warnings); break
        case 'drift': this.validateDrift(output, errors, warnings); break
        case 'science-paper': await this.validateSciencePaper(output, errors, warnings); break
      }
    } catch (err) {
      errors.push({ code: 'VALIDATION_EXCEPTION', message: err instanceof Error ? err.message : String(err), severity: 'error' })
    }
    const criticalErrors = errors.filter(e => e.severity === 'critical')
    const valid = this.config.strictMode
      ? errors.length === 0
      : criticalErrors.length === 0
    return {
      valid, errors, warnings,
      metadata: { validatedAt: new Date().toISOString(), validatorVersion: '1.0.0', inputHash: this.hashOutput(output), validationDuration: Date.now() - startTime },
    }
  }

  validateData(output: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!output || typeof output !== 'object') {
      errors.push({ code: 'INVALID_TYPE', message: 'Output is not an object', severity: 'error' })
      return
    }
    if (!output.data && !output.rows) errors.push({ code: 'MISSING_DATA', message: 'Missing data field in output', severity: 'error' })
    if (output.schema?.columns) {
      for (const col of output.schema.columns) {
        if (!col.unit) warnings.push({ code: 'MISSING_UNIT', message: `Column ${col.name} missing unit`, suggestion: 'Add unit to schema' })
        if (col.min !== undefined && col.max !== undefined) {
          const values = (output.data || output.rows || []).map((r: any) => r[col.name])
          for (const v of values) {
            if (v < col.min || v > col.max) errors.push({ code: 'OUT_OF_RANGE', message: `Value ${v} out of range for ${col.name}`, severity: 'error', field: col.name, value: v })
          }
        }
      }
    }
    if (output.data || output.rows) {
      for (const row of (output.data || output.rows)) {
        for (const [key, value] of Object.entries(row)) {
          if (value === null || value === undefined || Number.isNaN(value)) errors.push({ code: 'MISSING_VALUE', message: `Missing value in field ${key}`, severity: 'error', field: key })
        }
      }
    }
  }

  validateTrend(output: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!output.series) { errors.push({ code: 'MISSING_SERIES', message: 'Missing series for trend validation', severity: 'error' }); return }
    const series = output.series
    if (!Array.isArray(series) || series.length < 2) { errors.push({ code: 'INVALID_SERIES', message: 'Invalid or too short series', severity: 'error' }); return }
    if (output.trendDetected === false && output.expectedTrend) errors.push({ code: 'TREND_MISMATCH', message: 'Expected trend not detected', severity: 'error' })
    const first = series[0]; const last = series[series.length - 1]
    if (output.expectedDirection === 'up' && last < first) errors.push({ code: 'DIRECTION_MISMATCH', message: 'Expected upward trend not found', severity: 'error' })
    if (output.expectedDirection === 'down' && last > first) errors.push({ code: 'DIRECTION_MISMATCH', message: 'Expected downward trend not found', severity: 'error' })
    if (output.noise && output.noise > this.config.thresholds.maxNoiseRatio) warnings.push({ code: 'HIGH_NOISE', message: `Noise ratio ${output.noise} exceeds threshold`, suggestion: 'Consider smoothing' })
  }

  async validateInsight(output: any, errors: ValidationError[], warnings: ValidationWarning[]): Promise<void> {
    if (!output) { errors.push({ code: 'MISSING_OUTPUT', message: 'Insight output is empty', severity: 'error' }); return }
    if (output.confidence !== undefined && output.confidence < this.config.thresholds.minConfidence) errors.push({ code: 'LOW_CONFIDENCE', message: `Confidence ${output.confidence} below threshold`, severity: 'error' })
    if (output.pValue !== undefined && output.pValue > this.config.thresholds.maxPValue) errors.push({ code: 'NOT_SIGNIFICANT', message: `p-value ${output.pValue} not statistically significant`, severity: 'error' })
    if (output.isTrivial === true) warnings.push({ code: 'TRIVIAL_INSIGHT', message: 'Insight is trivial or restates input data' })
    if (output.domainChecksPassed === false) errors.push({ code: 'DOMAIN_VIOLATION', message: 'Insight violates domain-specific rules', severity: 'error' })
    if (!output.explanation || !output.explanation.steps?.length) warnings.push({ code: 'NO_EXPLANATION', message: 'Insight lacks explainable reasoning chain' })
  }

  async validateCrossDomain(output: any, errors: ValidationError[], warnings: ValidationWarning[]): Promise<void> {
    if (!output.domains || !Array.isArray(output.domains)) { errors.push({ code: 'MISSING_DOMAINS', message: 'Cross-domain output missing domains array', severity: 'error' }); return }
    if (output.domains.length < 2) errors.push({ code: 'NOT_CROSS_DOMAIN', message: 'Output does not span multiple domains', severity: 'error' })
    if (output.relationships) {
      for (const rel of output.relationships) {
        if (rel.forbidden) errors.push({ code: 'FORBIDDEN_RELATIONSHIP', message: `Forbidden relationship: ${rel.type}`, severity: 'critical' })
        if (rel.effectTime && rel.causeTime && rel.effectTime < rel.causeTime) errors.push({ code: 'CAUSALITY_VIOLATION', message: 'Effect precedes cause', severity: 'critical' })
      }
    }
  }

  validateDrift(output: any, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (output.outputDriftScore !== undefined && output.outputDriftScore > this.config.thresholds.maxDriftScore) errors.push({ code: 'OUTPUT_DRIFT', message: `Output drift ${output.outputDriftScore} exceeds threshold`, severity: 'error' })
    if (output.trendDriftScore !== undefined && output.trendDriftScore > this.config.thresholds.maxDriftScore) errors.push({ code: 'TREND_DRIFT', message: `Trend drift ${output.trendDriftScore} exceeds threshold`, severity: 'error' })
    if (output.crossDomainDriftScore !== undefined && output.crossDomainDriftScore > this.config.thresholds.maxDriftScore) errors.push({ code: 'CROSS_DOMAIN_DRIFT', message: `Cross-domain drift ${output.crossDomainDriftScore} exceeds threshold`, severity: 'error' })
  }

  async validateSciencePaper(output: any, errors: ValidationError[], warnings: ValidationWarning[]): Promise<void> {
    if (!output.entities || !output.entities.length) warnings.push({ code: 'NO_ENTITIES', message: 'No entities extracted from paper' })
    if (!output.relationships || output.relationships.length < 2) warnings.push({ code: 'SPARSE_RELATIONSHIPS', message: 'Limited cross-domain relationships detected' })
    if (output.entities && output.relationships) {
      const entityIds = new Set(output.entities.map((e: any) => e.id))
      const relEntityIds = new Set([...output.relationships.map((r: any) => r.subject), ...output.relationships.map((r: any) => r.object)])
      for (const id of relEntityIds) {
        if (!entityIds.has(id)) errors.push({ code: 'ORPHAN_RELATIONSHIP', message: `Relationship references unknown entity: ${id}`, severity: 'error' })
      }
    }
  }

  private hashOutput(output: unknown): string {
    const str = JSON.stringify(output)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }

  setConfig(config: Partial<ValidationConfig>): void { this.config = { ...this.config, ...config } }
  getConfig(): ValidationConfig { return { ...this.config } }
}

export const scientificOutputValidator = new ScientificOutputValidator()
