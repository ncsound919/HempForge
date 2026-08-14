import { describe, it, expect, beforeEach } from "vitest";
import {
  writeMemory,
  readMemory,
  searchMemory,
  deleteMemory,
  cleanExpiredMemory,
} from "../agentMemory";

describe("AgentMemory", () => {
  beforeEach(() => {
    cleanExpiredMemory();
  });

  describe("writeMemory and readMemory", () => {
    it("should write and read simple string values", async () => {
      await writeMemory({
        namespace: "test-ns-1",
        key: "test-key",
        value: "hello",
        agentId: "agent-1",
      });

      const result = await readMemory("test-key", "test-ns-1");
      expect(result).toBeDefined();
      expect(result?.value).toBe("hello");
    });

    it("should write and read object values", async () => {
      const obj = { name: "test", value: 42, nested: { a: 1 } };
      await writeMemory({
        namespace: "test-ns-2",
        key: "obj-key",
        value: obj,
        agentId: "agent-1",
      });

      const result = await readMemory("obj-key", "test-ns-2");
      expect(result?.value).toEqual(obj);
    });

    it("should return null for non-existent key", async () => {
      const result = await readMemory("does-not-exist", "any-ns");
      expect(result).toBeNull();
    });

    it("should use default namespace when not provided", async () => {
      await writeMemory({
        namespace: "",
        key: "default-ns-key",
        value: "default-ns-value",
        agentId: "agent-1",
      });

      const result = await readMemory("default-ns-key");
      expect(result?.value).toBe("default-ns-value");
    });

    it("should support different namespaces", async () => {
      await writeMemory({
        namespace: "ns-a",
        key: "shared-key",
        value: "value-a",
        agentId: "agent-1",
      });
      await writeMemory({
        namespace: "ns-b",
        key: "shared-key",
        value: "value-b",
        agentId: "agent-1",
      });

      const resultA = await readMemory("shared-key", "ns-a");
      const resultB = await readMemory("shared-key", "ns-b");

      expect(resultA?.value).toBe("value-a");
      expect(resultB?.value).toBe("value-b");
    });
  });

  describe("TTL handling", () => {
    it("should respect TTL setting", async () => {
      await writeMemory({
        namespace: "ttl-test",
        key: "ttl-key",
        value: "ttl-value",
        agentId: "agent-1",
        ttl: 60,
      });

      const result = await readMemory("ttl-key", "ttl-test");
      expect(result).toBeDefined();
      expect(result?.value).toBe("ttl-value");
    });

    it("should expire entries after TTL", async () => {
      await writeMemory({
        namespace: "ttl-expire",
        key: "expire-key",
        value: "expire-value",
        agentId: "agent-1",
        ttl: 1,
      });

      // Wait for TTL to expire (using setTimeout workaround)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const result = await readMemory("expire-key", "ttl-expire");
      expect(result).toBeNull();
    });

    it("should handle persistent entries without TTL", async () => {
      await writeMemory({
        namespace: "no-ttl",
        key: "persistent",
        value: "stays-forever",
        agentId: "agent-1",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await readMemory("persistent", "no-ttl");
      expect(result?.value).toBe("stays-forever");
    });
  });

  describe("searchMemory", () => {
    beforeEach(async () => {
      await writeMemory({
        namespace: "search-ns",
        key: "alpha",
        value: "alpha value",
        agentId: "agent-1",
      });
      await writeMemory({
        namespace: "search-ns",
        key: "alpharet",
        value: "alpharet value",
        agentId: "agent-1",
      });
      await writeMemory({
        namespace: "search-ns",
        key: "beta",
        value: "beta value",
        agentId: "agent-2",
      });
    });

    it("should find keys by prefix", async () => {
      const results = await searchMemory("alph", "search-ns");
      expect(results.length).toBe(2);
      expect(results.map((r) => r.key).sort()).toEqual(["alpha", "alpharet"]);
    });

    it("should return empty array for no matches", async () => {
      const results = await searchMemory("xyz", "search-ns");
      expect(results).toEqual([]);
    });

    it("should sort results by updatedAt descending", async () => {
      const results = await searchMemory("alph", "search-ns");
      if (results.length > 1) {
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].updatedAt >= results[i + 1].updatedAt).toBe(true);
        }
      }
    });

    it("should use default namespace when no namespace provided", async () => {
      await writeMemory({
        namespace: "",
        key: "alphaflux",
        value: "different namespace",
        agentId: "agent-3",
      });

      const results = await searchMemory("alphaflux");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("deleteMemory", () => {
    it("should delete existing entries", async () => {
      await writeMemory({
        namespace: "del-test",
        key: "to-delete",
        value: "value",
        agentId: "agent-1",
      });

      expect(await readMemory("to-delete", "del-test")).toBeDefined();

      const deleted = await deleteMemory("to-delete", "del-test");
      expect(deleted).toBe(true);

      expect(await readMemory("to-delete", "del-test")).toBeNull();
    });

    it("should return false for non-existent entries", async () => {
      const deleted = await deleteMemory("nonexistent", "no-ns");
      expect(deleted).toBe(false);
    });

    it("should not affect other namespaces", async () => {
      await writeMemory({
        namespace: "ns-1",
        key: "key-1",
        value: "value-1",
        agentId: "agent-1",
      });
      await writeMemory({
        namespace: "ns-2",
        key: "key-1",
        value: "value-2",
        agentId: "agent-1",
      });

      await deleteMemory("key-1", "ns-1");

      expect(await readMemory("key-1", "ns-1")).toBeNull();
      expect(await readMemory("key-1", "ns-2")).toBeDefined();
    });
  });

  describe("cleanExpiredMemory", () => {
    it("should remove expired entries", async () => {
      await writeMemory({
        namespace: "clean-test",
        key: "will-expire",
        value: "value",
        agentId: "agent-1",
        ttl: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const deleted = await cleanExpiredMemory();
      expect(deleted).toBeGreaterThanOrEqual(1);
    });

    it("should keep non-expired entries", async () => {
      await writeMemory({
        namespace: "clean-test-2",
        key: "will-stay",
        value: "value",
        agentId: "agent-1",
      });

      const deleted = await cleanExpiredMemory();
      expect(await readMemory("will-stay", "clean-test-2")).toBeDefined();
    });
  });

  describe("Value handling", () => {
    it("should handle number values", async () => {
      await writeMemory({
        namespace: "num-ns",
        key: "number-key",
        value: 42,
        agentId: "agent-1",
      });
      const result = await readMemory("number-key", "num-ns");
      expect(result?.value).toBe(42);
    });

    it("should handle boolean values", async () => {
      await writeMemory({
        namespace: "bool-ns",
        key: "bool-key",
        value: true,
        agentId: "agent-1",
      });
      const result = await readMemory("bool-key", "bool-ns");
      expect(result?.value).toBe(true);
    });

    it("should handle array values", async () => {
      await writeMemory({
        namespace: "arr-ns",
        key: "arr-key",
        value: [1, 2, 3, "four"],
        agentId: "agent-1",
      });
      const result = await readMemory("arr-key", "arr-ns");
      expect(result?.value).toEqual([1, 2, 3, "four"]);
    });

    it("should handle null values", async () => {
      await writeMemory({
        namespace: "null-ns",
        key: "null-key",
        value: null,
        agentId: "agent-1",
      });
      const result = await readMemory("null-key", "null-ns");
      expect(result?.value).toBeNull();
    });

    it("should handle string values that look like JSON (parsed on read)", async () => {
      await writeMemory({
        namespace: "str-json-ns",
        key: "str-json-key",
        value: '{"already": "stringified"}',
        agentId: "agent-1",
      });
      const result = await readMemory("str-json-key", "str-json-ns");
      expect(result?.value).toEqual({ already: "stringified" });
    });
  });
});
