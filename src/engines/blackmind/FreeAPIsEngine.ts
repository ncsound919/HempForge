import { eventBus } from './EventBus'
import { knowledgeStore } from './KnowledgeStore'

interface FreeAPIConfig {
  baseUrl: string
  timeout?: number
  retries?: number
}

interface FreeAPIResponse {
  success: boolean
  data?: any
  error?: string
  cached: boolean
  latency: number
}

interface NCBIResponse {
  esearchresult?: {
    idlist: string[]
    count: string
  }
  result?: Record<string, any>
}

interface UniProtResponse {
  results?: Array<{
    accession: string
    id: string
    proteinDescription?: { recommendedName?: { fullName?: { value?: string } } }
    organism?: { scientificName?: string }
    sequence?: { sequence?: string }
    genes?: Array<{ geneName?: { value?: string } }>
    features?: Array<{ type?: string; description?: string }>
  }>
}

interface AlphaFoldResponse {
  uniprotAccession?: string
  uniprotId?: string
  pdbUrl?: string
  cifUrl?: string
  paeImageUrl?: string
  confidenceScore?: number
  modelCreatedDate?: string
  gene?: string
  organismScientificName?: string
}

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const UNIPROT_BASE = 'https://rest.uniprot.org'
const ALPHAFOLD_BASE = 'https://alphafold.ebi.ac.uk/api'

export class FreeAPIsEngine {
  private configs: Map<string, FreeAPIConfig> = new Map()
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private cacheTTL = 5 * 60 * 1000
  private maxCacheSize = 500

  private headers: Record<string, string> = {
    'User-Agent': 'BlackMind-Engine/1.0',
    'Accept': 'application/json',
  }

  constructor() {
    this.configs.set('ncbi', { baseUrl: NCBI_BASE, timeout: 15000, retries: 2 })
    this.configs.set('uniprot', { baseUrl: UNIPROT_BASE, timeout: 10000, retries: 2 })
    this.configs.set('alphafold', { baseUrl: ALPHAFOLD_BASE, timeout: 20000, retries: 1 })
  }

  private getCacheKey(api: string, endpoint: string, params: any): string {
    return `${api}:${endpoint}:${JSON.stringify(params)}`
  }

  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) return entry.data
    this.cache.delete(key)
    return null
  }

  private setCache(key: string, data: any): void {
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  private async fetchWithRetry(url: string, config: FreeAPIConfig, attempt = 0): Promise<FreeAPIResponse> {
    const start = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.timeout || 10000)
    try {
      const response = await fetch(url, { headers: this.headers, signal: controller.signal })
      clearTimeout(timeoutId)
      if (!response.ok) {
        if (response.status === 429 && attempt < (config.retries || 2)) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
          return this.fetchWithRetry(url, config, attempt + 1)
        }
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, cached: false, latency: Date.now() - start }
      }
      const data = await response.json()
      return { success: true, data, cached: false, latency: Date.now() - start }
    } catch (err) {
      clearTimeout(timeoutId)
      if (attempt < (config.retries || 2)) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
        return this.fetchWithRetry(url, config, attempt + 1)
      }
      return { success: false, error: err instanceof Error ? err.message : String(err), cached: false, latency: Date.now() - start }
    }
  }

  async searchPubMed(query: string, maxResults = 10): Promise<FreeAPIResponse> {
    const cacheKey = this.getCacheKey('ncbi', 'esearch', { query, maxResults })
    const cached = this.getFromCache(cacheKey)
    if (cached) return { success: true, data: cached, cached: true, latency: 0 }
    const config = this.configs.get('ncbi')!
    const searchUrl = `${config.baseUrl}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`
    const searchResult = await this.fetchWithRetry(searchUrl, config)
    if (!searchResult.success || !searchResult.data?.esearchresult?.idlist?.length) {
      return { ...searchResult, data: [] }
    }
    const ids = searchResult.data.esearchresult.idlist
    const fetchUrl = `${config.baseUrl}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`
    const fetchResult = await this.fetchWithRetry(fetchUrl, config)
    if (fetchResult.success) {
      this.setCache(cacheKey, { articles: ids, raw: fetchResult.data })
    }
    return { success: true, data: { articles: ids, raw: fetchResult.data }, cached: false, latency: searchResult.latency + fetchResult.latency }
  }

  async searchUniProt(query: string, maxResults = 10): Promise<FreeAPIResponse> {
    const cacheKey = this.getCacheKey('uniprot', 'search', { query, maxResults })
    const cached = this.getFromCache(cacheKey)
    if (cached) return { success: true, data: cached, cached: true, latency: 0 }
    const config = this.configs.get('uniprot')!
    const url = `${config.baseUrl}/uniprotkb/search?query=${encodeURIComponent(query)}&size=${maxResults}&format=json`
    const result = await this.fetchWithRetry(url, config)
    if (result.success) this.setCache(cacheKey, result.data)
    return result
  }

  async getProteinStructure(uniprotAccession: string): Promise<FreeAPIResponse> {
    const cacheKey = this.getCacheKey('alphafold', 'structure', { uniprotAccession })
    const cached = this.getFromCache(cacheKey)
    if (cached) return { success: true, data: cached, cached: true, latency: 0 }
    const config = this.configs.get('alphafold')!
    const url = `${config.baseUrl}/prediction/${uniprotAccession}`
    const result = await this.fetchWithRetry(url, config)
    if (result.success) this.setCache(cacheKey, result.data)
    return result
  }

  async searchAll(query: string, maxResults = 5): Promise<{
    pubMed: FreeAPIResponse
    uniProt: FreeAPIResponse
    alphaFold: FreeAPIResponse
  }> {
    const [pubMed, uniProt, alphaFold] = await Promise.all([
      this.searchPubMed(query, maxResults),
      this.searchUniProt(query, maxResults),
      this.getProteinStructure(query),
    ])
    return { pubMed, uniProt, alphaFold }
  }

  async deepSearch(query: string): Promise<{
    entities: Array<{ type: string; id: string; name: string; source: string }>
    papers: Array<{ id: string; title: string; pmcid?: string }>
    proteins: Array<{ accession: string; function: string; organism: string; confidence: number }>
    structures: Array<{ accession: string; pdbUrl?: string; confidence?: number }>
  }> {
    const allResults = await this.searchAll(query, 20)
    const entities: Array<{ type: string; id: string; name: string; source: string }> = []
    const papers: Array<{ id: string; title: string; pmcid?: string }> = []
    const proteins: Array<{ accession: string; function: string; organism: string; confidence: number }> = []
    const structures: Array<{ accession: string; pdbUrl?: string; confidence?: number }> = []
    if (allResults.uniProt.success && allResults.uniProt.data?.results) {
      for (const r of allResults.uniProt.data.results) {
        entities.push({ type: 'protein', id: r.accession, name: r.id, source: 'uniprot' })
        proteins.push({
          accession: r.accession,
          function: r.proteinDescription?.recommendedName?.fullName?.value || 'Unknown',
          organism: r.organism?.scientificName || 'Unknown',
          confidence: r.features?.length ? Math.min(1, r.features.length / 10) : 0.5,
        })
      }
    }
    if (allResults.alphaFold.success && allResults.alphaFold.data) {
      const entries = Array.isArray(allResults.alphaFold.data) ? allResults.alphaFold.data : [allResults.alphaFold.data]
      for (const entry of entries) {
        entities.push({ type: 'structure', id: entry.uniprotAccession || entry.uniprotId, name: entry.uniprotId || entry.uniprotAccession, source: 'alphafold' })
        structures.push({
          accession: entry.uniprotAccession || entry.uniprotId,
          pdbUrl: entry.pdbUrl || entry.cifUrl,
          confidence: entry.confidenceScore ? entry.confidenceScore / 100 : undefined,
        })
      }
    }
    if (allResults.pubMed.success && allResults.pubMed.data?.articles) {
      for (const id of allResults.pubMed.data.articles) {
        papers.push({ id, title: `PubMed Article ${id}` })
        entities.push({ type: 'paper', id, name: `PubMed ${id}`, source: 'pubmed' })
      }
    }
    eventBus.emit('scientific_search.completed', { domain: ['scientific_research'], source_system: 'free_apis_engine', subject_id: `deep_search_${query}`, payload: { query, entities, papers, proteins, structures }, metadata: { query, entityCount: entities.length } })
    return { entities, papers, proteins, structures }
  }

  clearCache(): void { this.cache.clear() }
}

export const freeAPIsEngine = new FreeAPIsEngine()
