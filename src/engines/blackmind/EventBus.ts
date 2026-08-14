import { type CanonicalEventEnvelope, type EventType, type SourceSystem, type EventStatus, createCanonicalEnvelope, computePayloadHash } from './types'
import { dataBus } from './DataBus'
import { logger } from '../../lib/structuredLogger'

export type EventHandler = (event: CanonicalEventEnvelope) => Promise<void> | void

export interface TopicSubscription {
  topic: string
  handler: EventHandler
  filter?: {
    source_system?: SourceSystem[]
    domain?: string[]
    status?: EventStatus[]
  }
}

export interface DeadLetterEntry {
  event: CanonicalEventEnvelope
  error: string
  attempts: number
  lastAttempt: string
  nextRetryAt?: string
}

export interface EventBusConfig {
  maxRetries: number
  baseRetryDelayMs: number
  maxRetryDelayMs: number
  enableDeadLetter: boolean
  enableReplay: boolean
  enableIdempotency: boolean
  idempotencyWindowMs: number
  maxHistorySize: number
  persistToStorage: boolean
  storageKey: string
}

const DEFAULT_CONFIG: EventBusConfig = {
  maxRetries: 5,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 60000,
  enableDeadLetter: true,
  enableReplay: true,
  enableIdempotency: true,
  idempotencyWindowMs: 300000,
  maxHistorySize: 50000,
  persistToStorage: false,
  storageKey: 'bm_event_bus',
}

export class EventBus {
  private static instance: EventBus | null = null

  private subscribers: Map<string, Set<EventHandler>> = new Map()
  private deadLetterQueue: DeadLetterEntry[] = []
  private eventHistory: CanonicalEventEnvelope[] = []
  private config: EventBusConfig
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  private constructor(config: Partial<EventBusConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.setupDataBusIntegration()
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) EventBus.instance = new EventBus()
    return EventBus.instance
  }

  private dataBusUnsubscribe: (() => void) | null = null

  private setupDataBusIntegration(): void {
    this.dataBusUnsubscribe = dataBus.subscribe((event: any) => {
      if (event.type === 'science:research:completed') {
        this.publish({
          event_type: 'analysis.completed',
          source_system: 'open_deep_researcher',
          domain: ['research'],
          subject_id: event.payload?.id || 'unknown',
          payload_ref: `memory://${event.payload?.id}`,
        })
      } else if (event.type === 'science:ai-scientist:completed') {
        this.publish({
          event_type: 'experiment.run.completed',
          source_system: 'ai_scientist',
          domain: ['machine_learning', 'research'],
          subject_id: event.payload?.id || 'unknown',
          payload_ref: `memory://${event.payload?.id}`,
        })
      } else if (event.type === 'science:cosmos:completed') {
        this.publish({
          event_type: 'agent.insight.generated',
          source_system: 'cosmos',
          domain: ['ai_studio'],
          subject_id: event.payload?.id || 'unknown',
          payload_ref: `memory://${event.payload?.id}`,
        })
      }
    })
  }

  publish(params: {
    event_type: EventType
    source_system: SourceSystem
    domain: string[]
    subject_id: string
    payload_ref?: string
    status?: EventStatus
    security_class?: 'public' | 'internal' | 'confidential' | 'restricted'
    experiment_id?: string
    run_id?: string
    sample_id?: string
    simulation_id?: string
    lineage_parent_ids?: string[]
    tags?: string[]
    metadata?: Record<string, unknown>
    payload?: unknown
    idempotency_key?: string
  }): CanonicalEventEnvelope {
    const envelope = createCanonicalEnvelope({
      event_type: params.event_type,
      source_system: params.source_system,
      domain: params.domain,
      subject_id: params.subject_id,
      payload_ref: params.payload_ref || `memory://${params.subject_id}`,
      status: params.status || 'pending',
      security_class: params.security_class || 'internal',
      experiment_id: params.experiment_id,
      run_id: params.run_id,
      sample_id: params.sample_id,
      simulation_id: params.simulation_id,
      lineage_parent_ids: params.lineage_parent_ids,
      tags: params.tags,
      metadata: params.metadata,
    })
    if (params.payload) envelope.payload_hash = computePayloadHash(params.payload)

    this.eventHistory.push(envelope)
    if (this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-Math.floor(this.config.maxHistorySize / 2))
    }
    this.routeEvent(envelope)
    return envelope
  }

  private routeEvent(event: CanonicalEventEnvelope): void {
    const topic = this.getTopicFromEventType(event.event_type)
    const handlers = this.subscribers.get(topic) || new Set()
    const wildcardHandlers = this.subscribers.get('*') || new Set()
    const allHandlers = [...handlers, ...wildcardHandlers]
    for (const handler of allHandlers) {
      Promise.resolve(handler(event)).catch((err) => this.handleHandlerError(event, err))
    }
  }

  /**
   * Convenience alias used by the engine components. Maps the
   * `emit(topic, { domain, source_system, subject_id, payload, metadata })`
   * shape onto `publish`'s canonical envelope.
   */
  emit(
    topic: EventType,
    params: {
      domain: string[]
      source_system: SourceSystem
      subject_id: string
      payload?: unknown
      metadata?: Record<string, unknown>
      status?: EventStatus
      tags?: string[]
    }
  ): CanonicalEventEnvelope {
    return this.publish({
      event_type: topic,
      source_system: params.source_system,
      domain: params.domain,
      subject_id: params.subject_id,
      payload: params.payload,
      metadata: params.metadata,
      status: params.status,
      tags: params.tags,
    })
  }

  private handleHandlerError(event: CanonicalEventEnvelope, error: Error): void {
    const existing = this.deadLetterQueue.find(e => e.event.event_id === event.event_id)
    if (existing) {
      existing.attempts++
      existing.error = error.message
      existing.lastAttempt = new Date().toISOString()
    } else {
      this.deadLetterQueue.push({ event, error: error.message, attempts: 1, lastAttempt: new Date().toISOString() })
    }
    if (existing && existing.attempts >= this.config.maxRetries) {
      event.status = 'failed'
      this.publishDeadLetter(event, error.message)
    } else {
      this.scheduleRetry(event, existing?.attempts || 1)
    }
  }

  private scheduleRetry(event: CanonicalEventEnvelope, attempt: number): void {
    const delay = Math.min(this.config.baseRetryDelayMs * Math.pow(2, attempt - 1), this.config.maxRetryDelayMs)
    const timerKey = event.event_id
    if (this.retryTimers.has(timerKey)) clearTimeout(this.retryTimers.get(timerKey))
    const timer = setTimeout(() => {
      this.retryTimers.delete(timerKey)
      const entry = this.deadLetterQueue.find(e => e.event.event_id === event.event_id)
      if (entry && entry.attempts < this.config.maxRetries) this.routeEvent(entry.event)
    }, delay)
    this.retryTimers.set(timerKey, timer)
    const entry = this.deadLetterQueue.find(e => e.event.event_id === event.event_id)
    if (entry) entry.nextRetryAt = new Date(Date.now() + delay).toISOString()
  }

  private publishDeadLetter(event: CanonicalEventEnvelope, error: string): void {
    this.publish({
      event_type: 'governance.audit',
      source_system: 'blackmind',
      domain: ['system'],
      subject_id: event.event_id,
      payload_ref: `deadletter://${event.event_id}`,
      tags: ['dead_letter', 'failed', 'max_retries_exceeded'],
      metadata: { original_error: error, original_event_type: event.event_type, source_system: event.source_system, failed_at: new Date().toISOString() },
    })
  }

  subscribe(topic: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(topic)) this.subscribers.set(topic, new Set())
    this.subscribers.get(topic)!.add(handler)
    return () => this.subscribers.get(topic)?.delete(handler)
  }

  subscribeWithFilter(subscription: TopicSubscription): () => void {
    const wrappedHandler: EventHandler = async (event) => {
      if (subscription.filter) {
        if (subscription.filter.source_system && !subscription.filter.source_system.includes(event.source_system)) return
        if (subscription.filter.domain && !subscription.filter.domain.some(d => event.domain.includes(d))) return
        if (subscription.filter.status && !subscription.filter.status.includes(event.status)) return
      }
      return subscription.handler(event)
    }
    return this.subscribe(subscription.topic, wrappedHandler)
  }

  getTopicFromEventType(eventType: EventType): string {
    const parts = eventType.split('.')
    return parts.slice(0, 2).join('.') + '.*'
  }

  query(params: {
    event_type?: EventType[]
    source_system?: SourceSystem[]
    domain?: string[]
    status?: EventStatus[]
    from_timestamp?: string
    limit?: number
    offset?: number
  }): CanonicalEventEnvelope[] {
    let results = [...this.eventHistory]
    if (params.event_type) results = results.filter(e => params.event_type!.includes(e.event_type))
    if (params.source_system) results = results.filter(e => params.source_system!.includes(e.source_system))
    if (params.domain) results = results.filter(e => e.domain.some(d => params.domain!.includes(d)))
    if (params.status) results = results.filter(e => params.status!.includes(e.status))
    if (params.from_timestamp) results = results.filter(e => e.timestamp_utc >= params.from_timestamp!)
    results.sort((a, b) => new Date(b.timestamp_utc).getTime() - new Date(a.timestamp_utc).getTime())
    const offset = params.offset || 0
    return results.slice(offset, offset + (params.limit || 100))
  }

  getDeadLetterQueue(): DeadLetterEntry[] { return [...this.deadLetterQueue] }

  retryDeadLetter(eventId: string): boolean {
    const entry = this.deadLetterQueue.find(e => e.event.event_id === eventId)
    if (!entry) return false
    entry.attempts = 0
    entry.nextRetryAt = undefined
    this.routeEvent(entry.event)
    return true
  }

  retryAllDeadLetters(): number {
    let count = 0
    for (const entry of this.deadLetterQueue) {
      entry.attempts = 0
      entry.nextRetryAt = undefined
      this.routeEvent(entry.event)
      count++
    }
    return count
  }

  purgeDeadLetter(eventId: string): boolean {
    const index = this.deadLetterQueue.findIndex(e => e.event.event_id === eventId)
    if (index === -1) return false
    this.deadLetterQueue.splice(index, 1)
    return true
  }

  replay(params: { from_timestamp?: string; event_type?: EventType[]; limit?: number; source_system?: SourceSystem[] }): { replayed: number; eventIds: string[] } {
    const events = this.query({ event_type: params.event_type, source_system: params.source_system, from_timestamp: params.from_timestamp, limit: params.limit || 1000 })
    const eventIds: string[] = []
    for (const event of events) {
      this.routeEvent({ ...event, event_id: `replay_${event.event_id}` })
      eventIds.push(event.event_id)
    }
    return { replayed: eventIds.length, eventIds }
  }

  checkSchemaCompatibility(event: CanonicalEventEnvelope): { compatible: boolean; warnings: string[] } {
    const warnings: string[] = []
    let compatible = true
    if (event.schema_version !== '1.0.0') warnings.push(`Unknown schema version: ${event.schema_version}`)
    if (!event.event_id) { compatible = false; warnings.push('Missing event_id') }
    if (!event.event_type) { compatible = false; warnings.push('Missing event_type') }
    if (!event.source_system) { compatible = false; warnings.push('Missing source_system') }
    if (!event.timestamp_utc) { compatible = false; warnings.push('Missing timestamp_utc') }
    return { compatible, warnings }
  }

  getStats(): { totalEvents: number; subscriberCount: number; deadLetterSize: number; topics: string[]; bySource: Record<string, number>; byType: Record<string, number>; byStatus: Record<string, number> } {
    const bySource: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    for (const event of this.eventHistory) {
      bySource[event.source_system] = (bySource[event.source_system] || 0) + 1
      byType[event.event_type] = (byType[event.event_type] || 0) + 1
      byStatus[event.status] = (byStatus[event.status] || 0) + 1
    }
    return {
      totalEvents: this.eventHistory.length,
      subscriberCount: Array.from(this.subscribers.values()).reduce((sum, s) => sum + s.size, 0),
      deadLetterSize: this.deadLetterQueue.length,
      topics: Array.from(this.subscribers.keys()), bySource, byType, byStatus,
    }
  }

  clearHistory(): void { this.eventHistory = [] }

  reset(): void {
    this.subscribers.clear()
    this.deadLetterQueue = []
    this.eventHistory = []
    this.retryTimers.forEach(t => clearTimeout(t))
    this.retryTimers.clear()
    if (this.dataBusUnsubscribe) { this.dataBusUnsubscribe(); this.dataBusUnsubscribe = null }
  }
}

export const eventBus = EventBus.getInstance()
