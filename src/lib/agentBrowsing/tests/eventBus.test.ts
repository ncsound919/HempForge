import { describe, it, expect, beforeEach, vi } from "vitest";
import { agentEventBus } from "../eventBus";

describe("AgentEventBus", () => {
  beforeEach(() => {
    agentEventBus.clearAllListeners();
  });

  describe("emit", () => {
    it("should emit and return an event", () => {
      const event = agentEventBus.emit(
        "discovery",
        "test-source",
        { key: "value" }
      );

      expect(event).toMatchObject({
        type: "discovery",
        source: "test-source",
        payload: { key: "value" },
      });
      expect(event.id).toBeTruthy();
      expect(event.timestamp).toBeTruthy();
    });

    it("should store events in recent history", () => {
      agentEventBus.emit("discovery", "src-1", { id: 1 });
      agentEventBus.emit("discovery", "src-2", { id: 2 });

      const recent = agentEventBus.getRecent();
      expect(recent.length).toBeGreaterThanOrEqual(2);
    });

    it("should limit recent events to MAX_RECENT", () => {
      for (let i = 0; i < 600; i++) {
        agentEventBus.emit("discovery", "test", { i });
      }
      const recent = agentEventBus.getRecent(undefined, 1000);
      expect(recent.length).toBeLessThanOrEqual(500);
    });

    it("should support all valid event types", () => {
      const types = [
        "discovery",
        "alert",
        "artifact",
        "decision",
        "error",
        "state_change",
        "agent:started",
        "agent:completed",
        "agent:failed",
        "memory:write",
        "pipeline:started",
        "pipeline:completed",
        "pipeline:failed",
      ] as const;

      for (const type of types) {
        const event = agentEventBus.emit(type, "test", {});
        expect(event.type).toBe(type);
      }
    });
  });

  describe("on / subscribe", () => {
    it("should call handler when event is emitted", () => {
      const handler = vi.fn();
      agentEventBus.on("discovery", handler);

      agentEventBus.emit("discovery", "test", { x: 1 });

      expect(handler).toHaveBeenCalledOnce();
    });

    it("should call handler with correct event data", () => {
      const handler = vi.fn();
      agentEventBus.on("discovery", handler);

      const event = agentEventBus.emit("discovery", "my-source", {
        foo: "bar",
      });

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should support unsubscribe", () => {
      const handler = vi.fn();
      const unsubscribe = agentEventBus.on("discovery", handler);

      agentEventBus.emit("discovery", "test", {});
      expect(handler).toHaveBeenCalledOnce();

      unsubscribe();

      agentEventBus.emit("discovery", "test", {});
      expect(handler).toHaveBeenCalledOnce();
    });

    it("should support wildcard subscription", () => {
      const handler = vi.fn();
      agentEventBus.on("*", handler);

      agentEventBus.emit("discovery", "src", {});
      agentEventBus.emit("alert", "src", {});

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should support multiple subscribers for same event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      agentEventBus.on("discovery", handler1);
      agentEventBus.on("discovery", handler2);

      agentEventBus.emit("discovery", "src", {});

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it("should handle handler errors gracefully", () => {
      const errorHandler = vi.fn(() => {
        throw new Error("handler error");
      });

      agentEventBus.on("discovery", errorHandler);
      expect(() => {
        agentEventBus.emit("discovery", "src", {});
      }).not.toThrow();
    });
  });

  describe("getRecent", () => {
    beforeEach(() => {
      agentEventBus.emit("discovery", "src-1", { id: 1 });
      agentEventBus.emit("alert", "src-2", { id: 2 });
      agentEventBus.emit("discovery", "src-3", { id: 3 });
      agentEventBus.emit("error", "src-4", { id: 4 });
    });

    it("should return all events when no filter", () => {
      const events = agentEventBus.getRecent();
      expect(events.length).toBeGreaterThanOrEqual(4);
    });

    it("should filter by event type", () => {
      const discoveryEvents = agentEventBus.getRecent("discovery");
      expect(discoveryEvents.length).toBeGreaterThanOrEqual(2);
      expect(discoveryEvents.every((e) => e.type === "discovery")).toBe(true);
    });

    it("should respect limit parameter", () => {
      const events = agentEventBus.getRecent(undefined, 1);
      expect(events.length).toBeLessThanOrEqual(1);
    });

    it("should return most recent events first", () => {
      const events = agentEventBus.getRecent();
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].timestamp >= events[i + 1].timestamp).toBe(true);
      }
    });
  });

  describe("replay", () => {
    beforeEach(async () => {
      agentEventBus.emit("discovery", "src", { old: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
      agentEventBus.emit("alert", "src", { newer: true });
    });

    it("should return all events when no filter", async () => {
      const events = await agentEventBus.replay();
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter by event type", async () => {
      const events = await agentEventBus.replay("discovery");
      expect(events.every((e) => e.type === "discovery")).toBe(true);
    });

    it("should filter by timestamp", async () => {
      const cutoff = new Date();
      await new Promise((resolve) => setTimeout(resolve, 10));
      agentEventBus.emit("discovery", "src", { newest: true });

      const events = await agentEventBus.replay(undefined, cutoff);
      expect(events.every((e) => new Date(e.timestamp) >= cutoff)).toBe(true);
    });

    it("should combine type and timestamp filters", async () => {
      const events = await agentEventBus.replay("discovery", new Date(0));
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.every((e) => e.type === "discovery")).toBe(true);
    });
  });

  describe("clearAllListeners", () => {
    it("should remove all listeners", () => {
      const handler = vi.fn();
      agentEventBus.on("discovery", handler);

      agentEventBus.clearAllListeners();

      agentEventBus.emit("discovery", "src", {});
      expect(handler).not.toHaveBeenCalled();
    });

    it("should clear recent events", () => {
      agentEventBus.emit("discovery", "src", {});
      agentEventBus.clearAllListeners();

      const recent = agentEventBus.getRecent();
      expect(recent.length).toBe(0);
    });
  });

  describe("Event payload handling", () => {
    it("should preserve payload data", () => {
      const payload = {
        complex: { nested: { value: 42 } },
        array: [1, 2, 3],
        str: "test",
      };

      const event = agentEventBus.emit("discovery", "src", payload);
      expect(event.payload).toEqual(payload);
    });

    it("should support durable flag", () => {
      const event = agentEventBus.emit("discovery", "src", {}, true);
      expect(event.durable).toBe(true);
    });

    it("should default durable to false", () => {
      const event = agentEventBus.emit("discovery", "src", {});
      expect(event.durable).toBe(false);
    });
  });
});
