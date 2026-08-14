import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'
import { dataBus } from './DataBus'

interface MetricPoint {
  name: string
  value: number
  tags: Record<string, string>
  timestamp: string
}

interface Span {
  id: string
  traceId: string
  parentSpanId: string | null
  name: string
  status: 'ok' | 'error' | 'warning'
  startTime: string
  endTime: string | null
  duration: number | null
  metadata: Record<string, any>
  logs: Array<{ timestamp: string; level: string; message: string; data?: any }>
}

interface Trace {
  id: string
  rootSpanId: string
  spans: Map<string, Span>
  status: 'active' | 'completed' | 'failed'
  startTime: string
  endTime: string | null
}

export class ObservabilityStack {
  private static instance: ObservabilityStack | null = null

  private metrics: MetricPoint[] = []
  private traces: Map<string, Trace> = new Map()
  private activeSpans: Map<string, Span> = new Map()
  private metricLimit = 10000
  private spanLogLimit = 50
  private traceLimit = 5000
  private staleSpanCheckMs = 300000

  private constructor() {
    this.subscribeToEvents()
  }

  static getInstance(): ObservabilityStack {
    if (!ObservabilityStack.instance) ObservabilityStack.instance = new ObservabilityStack()
    return ObservabilityStack.instance
  }

  private subscribeToEvents(): void {
    // DataBus exposes `subscribe(handler, { type })` — not Node's EventEmitter
    // `.on()`. Subscribe defensively to the events that actually exist so the
    // stack never crashes the server at startup. Events that aren't in the
    // BusEventType union are skipped.
    const trySubscribe = (type: string, handler: (data: any) => void): void => {
      try {
        if (typeof (dataBus as any).subscribe === 'function') {
          (dataBus as any).subscribe((ev: any) => handler(ev?.payload ?? ev), { type })
        } else if (typeof (dataBus as any).on === 'function') {
          (dataBus as any).on(type, handler)
        }
      } catch {
        /* best-effort observability — never crash startup */
      }
    }
    trySubscribe('pipeline:build:completed', (data: any) => {
      this.recordMetric('brain_cycle_duration', data?.duration || 0, { cycle: String(data?.cycle ?? '') })
    })
    trySubscribe('pipeline:build:failed', (data: any) => {
      this.recordMetric('brain_emergency_stop', 1, { cycle: String(data?.cycle ?? '') })
    })
  }

  recordMetric(name: string, value: number, tags: Record<string, string> = {}): void {
    const point: MetricPoint = { name, value, tags, timestamp: new Date().toISOString() }
    this.metrics.push(point)
    if (this.metrics.length > this.metricLimit) this.metrics.shift()
  }

  queryMetrics(params: { name?: string; tags?: Record<string, string>; from?: string; to?: string; aggregate?: 'avg' | 'sum' | 'count' }): { points: MetricPoint[]; aggregate: number } {
    let filtered = this.metrics
    if (params.name) filtered = filtered.filter(m => m.name === params.name)
    if (params.tags) {
      filtered = filtered.filter(m => Object.entries(params.tags!).every(([k, v]) => m.tags[k] === v))
    }
    if (params.from) filtered = filtered.filter(m => m.timestamp >= params.from!)
    if (params.to) filtered = filtered.filter(m => m.timestamp <= params.to!)
    let aggregate = 0
    if (filtered.length > 0) {
      switch (params.aggregate || 'avg') {
        case 'avg': aggregate = filtered.reduce((s, m) => s + m.value, 0) / filtered.length; break
        case 'sum': aggregate = filtered.reduce((s, m) => s + m.value, 0); break
        case 'count': aggregate = filtered.length; break
      }
    }
    return { points: filtered.slice(-100), aggregate }
  }

  startTrace(name: string, metadata: Record<string, any> = {}): string {
    const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const spanId = `${traceId}_root`
    const span: Span = {
      id: spanId, traceId, parentSpanId: null, name: `${name}.root`,
      status: 'ok', startTime: new Date().toISOString(), endTime: null, duration: null,
      metadata, logs: [],
    }
    const trace: Trace = { id: traceId, rootSpanId: spanId, spans: new Map([[spanId, span]]), status: 'active', startTime: span.startTime, endTime: null }
    this.traces.set(traceId, trace)
    if (this.traces.size > this.traceLimit) {
      const oldest = Array.from(this.traces.keys()).sort().slice(0, Math.floor(this.traceLimit * 0.2))
      for (const key of oldest) this.traces.delete(key)
    }
    this.activeSpans.set(spanId, span)
    return traceId
  }

  startSpan(traceId: string, name: string, parentSpanId?: string, metadata: Record<string, any> = {}): string {
    const trace = this.traces.get(traceId)
    if (!trace) throw new Error(`Trace not found: ${traceId}`)
    const spanId = `${traceId}_${Math.random().toString(36).slice(2, 8)}`
    const span: Span = {
      id: spanId, traceId, parentSpanId: parentSpanId || trace.rootSpanId, name,
      status: 'ok', startTime: new Date().toISOString(), endTime: null, duration: null,
      metadata, logs: [],
    }
    trace.spans.set(spanId, span)
    this.activeSpans.set(spanId, span)
    return spanId
  }

  endSpan(spanId: string, status: 'ok' | 'error' | 'warning' = 'ok'): void {
    const span = this.activeSpans.get(spanId)
    if (!span) return
    this.collectStaleSpans()
    span.endTime = new Date().toISOString()
    span.duration = new Date(span.endTime).getTime() - new Date(span.startTime).getTime()
    span.status = status
    this.activeSpans.delete(spanId)
    const trace = this.traces.get(span.traceId)
    if (trace && spanId === trace.rootSpanId) {
      trace.status = status === 'error' ? 'failed' : 'completed'
      trace.endTime = span.endTime
    }
  }

  addSpanLog(spanId: string, level: string, message: string, data?: any): void {
    const span = this.activeSpans.get(spanId) || this.findSpanInTraces(spanId)
    if (!span) return
    const log = { timestamp: new Date().toISOString(), level, message, data }
    span.logs.push(log)
    if (span.logs.length > this.spanLogLimit) span.logs.shift()
  }

  private findSpanInTraces(spanId: string): Span | undefined {
    for (const trace of this.traces.values()) {
      const span = trace.spans.get(spanId)
      if (span) return span
    }
    return undefined
  }

  private collectStaleSpans(): void {
    const now = Date.now()
    for (const [spanId, span] of this.activeSpans) {
      if (span.endTime === null && span.startTime) {
        const age = now - new Date(span.startTime).getTime()
        if (age > this.staleSpanCheckMs) {
          span.endTime = new Date().toISOString()
          span.duration = new Date(span.endTime).getTime() - new Date(span.startTime).getTime()
          span.status = 'warning'
          span.logs.push({ timestamp: span.endTime, level: 'warn', message: 'Span auto-closed by stale detector', data: { age } })
          this.activeSpans.delete(spanId)
        }
      }
    }
  }

  getTrace(traceId: string): Trace | undefined { return this.traces.get(traceId) }

  getTraceSummary(traceId: string): { id: string; status: string; duration: number | null; spanCount: number; errorSpans: number; warningSpans: number } | null {
    const trace = this.traces.get(traceId)
    if (!trace) return null
    let errorSpans = 0, warningSpans = 0
    for (const span of trace.spans.values()) {
      if (span.status === 'error') errorSpans++
      if (span.status === 'warning') warningSpans++
    }
    const rootSpan = trace.spans.get(trace.rootSpanId)
    return { id: trace.id, status: trace.status, duration: rootSpan?.duration || null, spanCount: trace.spans.size, errorSpans, warningSpans }
  }

  getRecentTraces(limit = 10): Array<{ id: string; status: string; duration: number | null; startTime: string; name: string }> {
    return Array.from(this.traces.values())
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
      .slice(0, limit)
      .map(t => {
        const rootSpan = t.spans.get(t.rootSpanId)
        return { id: t.id, status: t.status, duration: rootSpan?.duration || null, startTime: t.startTime, name: rootSpan?.name || 'unknown' }
      })
  }

  getStats(): { totalTraces: number; activeSpans: number; metricCount: number; tracesByStatus: Record<string, number> } {
    const tracesByStatus: Record<string, number> = {}
    for (const trace of this.traces.values()) {
      tracesByStatus[trace.status] = (tracesByStatus[trace.status] || 0) + 1
    }
    return { totalTraces: this.traces.size, activeSpans: this.activeSpans.size, metricCount: this.metrics.length, tracesByStatus }
  }
}

export const observabilityStack = ObservabilityStack.getInstance()
