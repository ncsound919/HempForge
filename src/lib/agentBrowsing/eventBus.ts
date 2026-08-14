import { EventEmitter } from "events"

export type EventType = "discovery" | "alert" | "artifact" | "decision" | "error" | "state_change" | "agent:started" | "agent:completed" | "agent:failed" | "memory:write" | "pipeline:started" | "pipeline:completed" | "pipeline:failed" | "trigger:content-from-intel" | "trigger:business-from-content" | "trigger:business-from-insights"

export interface AgentEvent {
  id: string
  type: EventType
  source: string
  timestamp: string
  payload: Record<string, unknown>
  durable: boolean
}

type EventHandler = (event: AgentEvent) => void

class AgentEventBus {
  private emitter = new EventEmitter()
  private recentEvents: AgentEvent[] = []
  private readonly MAX_RECENT = 500

  emit(type: EventType, source: string, payload: Record<string, unknown>, durable = false): AgentEvent {
    const event: AgentEvent = {
      id: crypto.randomUUID(),
      type,
      source,
      timestamp: new Date().toISOString(),
      payload,
      durable,
    }

    this.recentEvents.unshift(event)
    if (this.recentEvents.length > this.MAX_RECENT) {
      this.recentEvents = this.recentEvents.slice(0, this.MAX_RECENT)
    }

    try {
      this.emitter.emit(type, event)
    } catch {
    }
    this.emitter.emit("*", event)

    return event
  }

  on(type: EventType | "*", handler: EventHandler): () => void {
    const wrapped = (event: AgentEvent) => {
      if (type === "*" || event.type === type) {
        handler(event)
      }
    }
    this.emitter.on(type, wrapped)
    return () => {
      this.emitter.off(type, wrapped)
    }
  }

  async replay(type?: EventType, since?: Date): Promise<AgentEvent[]> {
    let filtered = this.recentEvents
    if (type) filtered = filtered.filter(e => e.type === type)
    if (since) filtered = filtered.filter(e => new Date(e.timestamp) >= since)
    return filtered
  }

  getRecent(type?: EventType, limit = 50): AgentEvent[] {
    if (type) {
      return this.recentEvents.filter(e => e.type === type).slice(0, limit)
    }
    return this.recentEvents.slice(0, limit)
  }

  clearAllListeners(): void {
    this.emitter.removeAllListeners()
    this.recentEvents = []
  }
}

export const agentEventBus = new AgentEventBus()
