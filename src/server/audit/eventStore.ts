/**
 * HempForge Event Store Service
 * 
 * Append-only event store for reconstructable domain history.
 * Item 8: Every state change is captured as an immutable event with full provenance.
 */

import crypto from "crypto";
import type { DomainEvent, DomainEventType } from "../../shared/types";

// In-memory event store (backed by Firestore in production)
const eventStore: DomainEvent[] = [];

/**
 * Append a new domain event to the store.
 * Events are immutable once stored — no updates or deletes.
 */
export function appendEvent(params: {
  type: DomainEventType;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  userId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
}): DomainEvent {
  const existingEvents = eventStore.filter(
    (e) => e.aggregateId === params.aggregateId && e.aggregateType === params.aggregateType
  );
  const version = existingEvents.length + 1;

  const event: DomainEvent = {
    id: `evt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    type: params.type,
    aggregateId: params.aggregateId,
    aggregateType: params.aggregateType,
    tenantId: params.tenantId,
    userId: params.userId,
    timestamp: new Date().toISOString(),
    payload: params.payload,
    metadata: {
      correlationId: params.correlationId,
      causationId: params.causationId,
      version,
    },
  };

  eventStore.push(event);
  return event;
}

/**
 * Query events for a specific aggregate.
 */
export function getEventsForAggregate(
  aggregateId: string,
  aggregateType: string
): DomainEvent[] {
  return eventStore
    .filter((e) => e.aggregateId === aggregateId && e.aggregateType === aggregateType)
    .sort((a, b) => a.metadata.version - b.metadata.version);
}

/**
 * Query events by type within a tenant.
 */
export function getEventsByType(
  tenantId: string,
  type: DomainEventType,
  options?: { since?: string; limit?: number }
): DomainEvent[] {
  let results = eventStore.filter((e) => e.tenantId === tenantId && e.type === type);

  if (options?.since) {
    const sinceTime = new Date(options.since).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() > sinceTime);
  }

  results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Get all events for a tenant within a time range.
 */
export function getEventStream(
  tenantId: string,
  options?: { since?: string; until?: string; limit?: number; types?: DomainEventType[] }
): DomainEvent[] {
  let results = eventStore.filter((e) => e.tenantId === tenantId);

  if (options?.types && options.types.length > 0) {
    results = results.filter((e) => options.types!.includes(e.type));
  }

  if (options?.since) {
    const sinceTime = new Date(options.since).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() > sinceTime);
  }

  if (options?.until) {
    const untilTime = new Date(options.until).getTime();
    results = results.filter((e) => new Date(e.timestamp).getTime() <= untilTime);
  }

  results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Get event count for a tenant (useful for pagination).
 */
export function getEventCount(tenantId: string, type?: DomainEventType): number {
  if (type) {
    return eventStore.filter((e) => e.tenantId === tenantId && e.type === type).length;
  }
  return eventStore.filter((e) => e.tenantId === tenantId).length;
}

/**
 * Replay events to reconstruct aggregate state.
 * Applies a reducer function over the event stream.
 */
export function replayAggregate<T>(
  aggregateId: string,
  aggregateType: string,
  reducer: (state: T, event: DomainEvent) => T,
  initialState: T
): T {
  const events = getEventsForAggregate(aggregateId, aggregateType);
  return events.reduce(reducer, initialState);
}
