import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'

interface AdapterConfig {
  baseUrl: string
  apiKey?: string
  timeout?: number
  retries?: number
  rateLimit?: { maxRequests: number; windowMs: number }
}

interface AdapterResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  statusCode: number
  latency: number
  cached: boolean
}

abstract class BaseAdapter {
  protected config: AdapterConfig
  private rateLimitQueue: Array<number> = []
  private isRateLimited = false

  constructor(config: AdapterConfig) {
    this.config = config
  }

  protected async request<T>(endpoint: string, options: RequestInit = {}): Promise<AdapterResponse<T>> {
    await this.enforceRateLimit()
    const start = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout || 10000)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'BlackMind-ProductionAdapter/1.0',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        ...(options.headers as Record<string, string> || {}),
      }
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, { ...options, headers, signal: controller.signal })
      clearTimeout(timeoutId)
      const statusCode = response.status
      if (!response.ok) {
        if (response.status === 429) { this.isRateLimited = true; setTimeout(() => { this.isRateLimited = false }, 60000) }
        return { success: false, error: `HTTP ${response.status}`, statusCode, latency: Date.now() - start, cached: false }
      }
      const data = await response.json() as T
      return { success: true, data, statusCode, latency: Date.now() - start, cached: false }
    } catch (err) {
      clearTimeout(timeoutId)
      return { success: false, error: err instanceof Error ? err.message : String(err), statusCode: 0, latency: Date.now() - start, cached: false }
    }
  }

  private async enforceRateLimit(): Promise<void> {
    if (!this.config.rateLimit) return
    const now = Date.now()
    this.rateLimitQueue = this.rateLimitQueue.filter(t => now - t < this.config.rateLimit!.windowMs)
    if (this.isRateLimited || this.rateLimitQueue.length >= this.config.rateLimit!.maxRequests) {
      const waitTime = this.rateLimitQueue.length > 0
        ? this.config.rateLimit!.windowMs - (now - this.rateLimitQueue[0])
        : this.config.rateLimit!.windowMs
      if (waitTime > 0) await new Promise(r => setTimeout(r, Math.min(waitTime, 5000)))
    }
    this.rateLimitQueue.push(now)
  }

  protected async searchWithRetry<T>(endpoint: string, options: RequestInit = {}, attempt = 0): Promise<AdapterResponse<T>> {
    const result = await this.request<T>(endpoint, options)
    if (!result.success && attempt < (this.config.retries || 2)) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
      return this.searchWithRetry<T>(endpoint, options, attempt + 1)
    }
    return result
  }

  abstract get name(): string
}

class NCBIAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils', timeout: 15000, retries: 2 })
  }

  get name(): string { return 'ncbi' }

  async searchPubMed(query: string, maxResults = 10): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`)
  }

  async fetchArticle(pmid: string): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`)
  }
}

class UniProtAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'https://rest.uniprot.org', timeout: 10000, retries: 2, rateLimit: { maxRequests: 10, windowMs: 1000 } })
  }

  get name(): string { return 'uniprot' }

  async searchProteins(query: string, maxResults = 10): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/uniprotkb/search?query=${encodeURIComponent(query)}&size=${maxResults}&format=json`)
  }

  async getProtein(accession: string): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/uniprotkb/${accession}?format=json`)
  }
}

class AlphaFoldAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'https://alphafold.ebi.ac.uk/api', timeout: 20000, retries: 1 })
  }

  get name(): string { return 'alphafold' }

  async getPrediction(uniprotAccession: string): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/prediction/${uniprotAccession}`)
  }

  async searchByGene(geneName: string): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/search?gene=${encodeURIComponent(geneName)}`)
  }
}

class OpenTargetsAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'https://api.platform.opentargets.org/api/v4', timeout: 15000, retries: 2 })
  }

  get name(): string { return 'opentargets' }

  async searchTargets(query: string): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/search?q=${encodeURIComponent(query)}&pageSize=10`)
  }

  async getTargetDisease(targetId: string): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/graphql`, {
      method: 'POST',
      body: JSON.stringify({
        query: `query ($ensemblId: String!) { target(ensemblId: $ensemblId) { id approvedSymbol approvedName associatedDiseases { count rows { disease { id name } } } } }`,
        variables: { ensemblId: targetId },
      }),
    })
  }
}

class DGIdbAdapter extends BaseAdapter {
  constructor() {
    super({ baseUrl: 'https://dgidb.org/api/v2', timeout: 10000, retries: 2 })
  }

  get name(): string { return 'dgidb' }

  async searchInteractions(genes: string[]): Promise<AdapterResponse<any>> {
    return this.searchWithRetry(`/interactions.json?genes=${genes.join(',')}`)
  }
}

export class ExternalScienceAdapters {
  ncbi: NCBIAdapter
  uniprot: UniProtAdapter
  alphafold: AlphaFoldAdapter
  opentargets: OpenTargetsAdapter
  dgidb: DGIdbAdapter
  private adapters: Map<string, BaseAdapter>

  constructor() {
    this.ncbi = new NCBIAdapter()
    this.uniprot = new UniProtAdapter()
    this.alphafold = new AlphaFoldAdapter()
    this.opentargets = new OpenTargetsAdapter()
    this.dgidb = new DGIdbAdapter()
    this.adapters = new Map()
    for (const adapter of [this.ncbi, this.uniprot, this.alphafold, this.opentargets, this.dgidb]) {
      this.adapters.set(adapter.name, adapter)
    }
  }

  getAdapter(name: string): BaseAdapter | undefined { return this.adapters.get(name) }

  async searchAll(query: string): Promise<{
    ncbi: AdapterResponse | null; uniprot: AdapterResponse | null; alphafold: AdapterResponse | null
  }> {
    const [ncbi, uniprot, alphafold] = await Promise.allSettled([
      this.ncbi.searchPubMed(query),
      this.uniprot.searchProteins(query),
      this.alphafold.getPrediction(query),
    ])
    return {
      ncbi: ncbi.status === 'fulfilled' ? ncbi.value : null,
      uniprot: uniprot.status === 'fulfilled' ? uniprot.value : null,
      alphafold: alphafold.status === 'fulfilled' ? alphafold.value : null,
    }
  }

  getStats(): { adapterCount: number; adapterNames: string[] } {
    return { adapterCount: this.adapters.size, adapterNames: Array.from(this.adapters.keys()) }
  }
}

export const externalScienceAdapters = new ExternalScienceAdapters()
