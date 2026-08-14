import type { BusEventType, BusDomain, BusEvent, BusHandler } from './types'
import { logger } from '../../lib/structuredLogger'

export class DataBus {
  private subs: Map<string, { handler: BusHandler; domain?: BusDomain; type?: BusEventType }> = new Map()
  private history: BusEvent[] = []
  private static readonly MAX_HISTORY = 1000

  publish<T>(type: BusEventType, domain: BusDomain, payload: T, source: string, correlationId?: string): BusEvent<T> {
    const event: BusEvent<T> = {
      id: `bus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type, domain, payload,
      timestamp: new Date().toISOString(),
      source, correlationId,
    }
    this.history.push(event as BusEvent)
    if (this.history.length > DataBus.MAX_HISTORY) this.history = this.history.slice(-DataBus.MAX_HISTORY)

    for (const sub of this.subs.values()) {
      if (sub.type && sub.type !== type) continue
      if (sub.domain && sub.domain !== domain) continue
      try { sub.handler(event) } catch { }
    }
    return event
  }

  emit(type: string, data?: any): void {
    logger.debug(`databus.emit:${type}`, { data })
  }

  subscribe(handler: BusHandler, opts?: { domain?: BusDomain; type?: BusEventType }): () => void {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.subs.set(id, { handler, domain: opts?.domain, type: opts?.type })
    return () => this.subs.delete(id)
  }

  getHistory(opts?: { domain?: BusDomain; type?: BusEventType; limit?: number }): BusEvent[] {
    let events = this.history
    if (opts?.domain) events = events.filter(e => e.domain === opts.domain)
    if (opts?.type) events = events.filter(e => e.type === opts.type)
    return events.slice(-(opts?.limit || 50))
  }

  clearHistory(): void { this.history = [] }
}

export const dataBus = new DataBus()
