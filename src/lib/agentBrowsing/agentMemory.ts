export interface MemoryEntry {
  namespace: string
  key: string
  value: unknown
  agentId: string
  ttl?: number
}

export interface MemoryReadResult {
  namespace: string
  key: string
  value: unknown
  agentId: string
  updatedAt: string
}

interface StoredEntry {
  namespace: string
  key: string
  value: string
  agentId: string
  updatedAt: Date
  expiresAt: Date | null
}

const DEFAULT_NS = "default"
const store = new Map<string, StoredEntry>()

function makeKey(namespace: string, key: string): string {
  return `${namespace}::${key}`
}

function computeExpiresAt(ttl: number | undefined): Date | null {
  if (ttl === undefined || ttl === null) return null
  return new Date(Date.now() + ttl * 1000)
}

function isExpired(entry: { expiresAt: Date | null }): boolean {
  if (!entry.expiresAt) return false
  return Date.now() >= entry.expiresAt.getTime()
}

export async function cleanExpiredMemory(): Promise<number> {
  let deleted = 0
  for (const [k, entry] of store) {
    if (isExpired(entry)) {
      store.delete(k)
      deleted++
    }
  }
  return deleted
}

export async function writeMemory(opts: MemoryEntry): Promise<void> {
  const value = typeof opts.value === "string" ? opts.value : JSON.stringify(opts.value)
  const ns = opts.namespace || DEFAULT_NS
  const key = makeKey(ns, opts.key)
  store.set(key, {
    namespace: ns,
    key: opts.key,
    value,
    agentId: opts.agentId,
    updatedAt: new Date(),
    expiresAt: computeExpiresAt(opts.ttl),
  })
}

export async function readMemory(
  key: string,
  namespace?: string,
): Promise<MemoryReadResult | null> {
  const ns = namespace || DEFAULT_NS
  const entry = store.get(makeKey(ns, key))
  if (!entry) return null
  if (isExpired(entry)) {
    store.delete(makeKey(ns, key))
    return null
  }
  return {
    namespace: entry.namespace,
    key: entry.key,
    value: tryParse(entry.value),
    agentId: entry.agentId,
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export async function searchMemory(
  prefix: string,
  namespace?: string,
): Promise<MemoryReadResult[]> {
  const ns = namespace || DEFAULT_NS
  const results: MemoryReadResult[] = []
  for (const [k, entry] of store) {
    if (!k.startsWith(makeKey(ns, "")) || !entry.key.startsWith(prefix)) continue
    if (isExpired(entry)) {
      store.delete(k)
      continue
    }
    results.push({
      namespace: entry.namespace,
      key: entry.key,
      value: tryParse(entry.value),
      agentId: entry.agentId,
      updatedAt: entry.updatedAt.toISOString(),
    })
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteMemory(key: string, namespace?: string): Promise<boolean> {
  const ns = namespace || DEFAULT_NS
  return store.delete(makeKey(ns, key))
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
