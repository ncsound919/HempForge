import crypto from "crypto";

export interface ResearchPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  doi?: string;
  pmid?: string;
  url: string;
  fullTextUrl?: string;
  source: 'pubmed' | 'europepmc' | 'semanticscholar' | 'openalex' | 'biorxiv' | 'core';
  publishedDate: string;
  journal?: string;
  keywords: string[];
  citationCount?: number;
  isOpenAccess: boolean;
  ingestedAt: string;
  tenantId: string;
}

const HEMP_QUERY_TERMS = [
  'cannabidiol hemp', 'THC pharmacokinetics', 'cannabis safety',
  'cannabinoid receptor', 'hemp phytocannabinoid', 'CBD bioavailability',
  'cannabis toxicology', 'hemp extraction method',
  'hemp terpene profile', 'cannabinoid formulation stability'
];

// Deduplication constants
const TITLE_DEDUP_KEY_LENGTH = 80; // Truncate normalized titles for dedup key generation
const DEFAULT_API_RATE_LIMIT_MS = 200; // Minimum inter-request delay per source to avoid API throttling

// Helper to handle both arrays and objects gracefully from API responses
function ensureArray<T>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

// Reconstruct inverted index abstract from OpenAlex
function reconstructAbstract(inverted: Record<string, number[]>): string {
  if (!inverted || typeof inverted !== 'object') return '';
  const words: string[] = [];
  try {
    for (const [word, positions] of Object.entries(inverted)) {
      if (Array.isArray(positions)) {
        for (const pos of positions) {
          if (typeof pos === 'number') {
            words[pos] = word;
          }
        }
      }
    }
  } catch (e) {
    console.error("Error reconstructing abstract:", e);
  }
  return words.filter(Boolean).join(' ');
}



// ── PubMed ──────────────────────────────────────────────────────────────────
async function fetchPubMed(query: string, maxResults = 20): Promise<ResearchPaper[]> {
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` +
      `?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json` +
      `&email=ncsound919@gmail.com&tool=HempForge`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error(`PubMed search responded with status ${searchRes.status}`);
    const searchData = await searchRes.json();
    const ids: string[] = searchData.esearchresult?.idlist ?? [];
    if (!ids.length) return [];

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
      `?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) throw new Error(`PubMed summary responded with status ${summaryRes.status}`);
    const summaryData = await summaryRes.json();
    
    const results = summaryData.result || {};
    const uids = results.uids || [];

    // Fetch real abstracts for the first 10 results via efetch
    const fetchIds = uids.slice(0, 10);
    const abstractsMap = new Map<string, string>();
    if (fetchIds.length > 0) {
      try {
        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` +
          `?db=pubmed&id=${fetchIds.join(',')}&retmode=xml&rettype=abstract`;
        const fetchRes = await fetch(fetchUrl);
        if (fetchRes.ok) {
          const xml = await fetchRes.text();
          // Simple XML parse to extract abstract text per PMID
          const pmidRegex = /<PubmedArticle>[\s\S]*?<PMID[^>]*>(\d+)<\/PMID>[\s\S]*?<Abstract>[\s\S]*?<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>[\s\S]*?<\/Abstract>[\s\S]*?<\/PubmedArticle>/g;
          let match;
          while ((match = pmidRegex.exec(xml)) !== null) {
            const pmId = match[1];
            const abstractText = match[2]
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (abstractText) {
              abstractsMap.set(pmId, abstractText);
            }
          }
        }
      } catch (efetchErr) {
        console.warn("PubMed efetch failed, falling back to summary-only:", efetchErr);
      }
    }

    return uids.map((pmid: string): ResearchPaper => {
      const article = results[pmid] || {};
      const title = article.title || 'Untitled PubMed Article';
      const authors = (article.authors || []).map((au: any) => au.name).filter(Boolean);
      const journal = article.source || article.fulljournalname || '';
      const year = article.pubdate ? String(article.pubdate).split(' ')[0] : new Date().getFullYear().toString();
      const abstract = abstractsMap.get(pmid) || '';

      return {
        id: `pubmed-${pmid}`,
        title,
        authors,
        abstract,
        pmid,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        source: 'pubmed',
        publishedDate: String(year),
        journal,
        keywords: [],
        citationCount: undefined,
        isOpenAccess: false,
        ingestedAt: new Date().toISOString(),
        tenantId: ''
      };
    });
  } catch (error) {
    console.error("Error fetching from PubMed:", error);
    return [];
  }
}

// ── OpenAlex ────────────────────────────────────────────────────────────────
async function fetchOpenAlex(query: string, maxResults = 20): Promise<ResearchPaper[]> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
      `&per-page=${maxResults}&mailto=ncsound919@gmail.com` +
      `&filter=open_access.is_oa:true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenAlex responded with status ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map((w: any): ResearchPaper => ({
      id: `openalex-${w.id?.split('/').pop()}`,
      title: w.title ?? 'Untitled OpenAlex Work',
      authors: ensureArray(w.authorships).map((a: any) => a.author?.display_name).filter(Boolean),
      abstract: w.abstract_inverted_index
        ? reconstructAbstract(w.abstract_inverted_index)
        : '',
      doi: w.doi?.replace('https://doi.org/', ''),
      url: w.primary_location?.landing_page_url ?? w.doi ?? '',
      fullTextUrl: w.primary_location?.pdf_url ?? undefined,
      source: 'openalex',
      publishedDate: w.publication_date ?? '',
      journal: w.primary_location?.source?.display_name ?? '',
      keywords: ensureArray(w.keywords).map((k: any) => k.display_name || k),
      citationCount: w.cited_by_count ?? 0,
      isOpenAccess: true,
      ingestedAt: new Date().toISOString(),
      tenantId: ''
    }));
  } catch (error) {
    console.error("Error fetching from OpenAlex:", error);
    return [];
  }
}

// ── Europe PMC ───────────────────────────────────────────────────────────────
async function fetchEuropePMC(query: string, maxResults = 20): Promise<ResearchPaper[]> {
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search` +
      `?query=${encodeURIComponent(query)}&format=json&pageSize=${maxResults}&resultType=core`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Europe PMC responded with status ${res.status}`);
    const data = await res.json();
    return (data.resultList?.result ?? []).map((r: any): ResearchPaper => ({
      id: `europepmc-${r.id}`,
      title: r.title ?? 'Untitled Europe PMC Article',
      authors: ensureArray(r.authorList?.author).map((a: any) => a.fullName || a.collectiveName).filter(Boolean),
      abstract: r.abstractText ?? '',
      doi: r.doi ?? undefined,
      pmid: r.pmid ?? undefined,
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
      fullTextUrl: r.fullTextUrlList?.fullTextUrl?.find((u: any) => u.documentStyle === 'pdf')?.url,
      source: 'europepmc',
      publishedDate: r.firstPublicationDate ?? '',
      journal: r.journalTitle ?? '',
      keywords: ensureArray(r.keywordList?.keyword),
      citationCount: r.citedByCount ?? 0,
      isOpenAccess: r.isOpenAccess === 'Y',
      ingestedAt: new Date().toISOString(),
      tenantId: ''
    }));
  } catch (error) {
    console.error("Error fetching from Europe PMC:", error);
    return [];
  }
}

// ── Semantic Scholar ─────────────────────────────────────────────────────────
async function fetchSemanticScholar(query: string, maxResults = 20): Promise<ResearchPaper[]> {
  try {
    const fields = 'paperId,title,authors,abstract,year,venue,citationCount,isOpenAccess,openAccessPdf,externalIds';
    const url = `https://api.semanticscholar.org/graph/v1/paper/search` +
      `?query=${encodeURIComponent(query)}&limit=${maxResults}&fields=${fields}`;
    
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    const s2ApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
    if (s2ApiKey) headers['x-api-key'] = s2ApiKey;

    const res = await fetch(url, { headers });
    if (res.status === 429) {
      console.warn("Semantic Scholar rate limited, skipping.");
      return [];
    }
    if (!res.ok) throw new Error(`Semantic Scholar responded with status ${res.status}`);
    const data = await res.json();

    return (data.data ?? []).map((paper: any): ResearchPaper => ({
      id: `s2-${paper.paperId}`,
      title: paper.title ?? 'Untitled Semantic Scholar Paper',
      authors: ensureArray(paper.authors).map((a: any) => a.name).filter(Boolean),
      abstract: paper.abstract ?? '',
      doi: paper.externalIds?.DOI ?? undefined,
      pmid: paper.externalIds?.PubMed ?? undefined,
      url: paper.externalIds?.DOI
        ? `https://doi.org/${paper.externalIds.DOI}`
        : `https://www.semanticscholar.org/paper/${paper.paperId}`,
      fullTextUrl: paper.openAccessPdf?.url ?? undefined,
      source: 'semanticscholar',
      publishedDate: paper.year ? `${paper.year}` : '',
      journal: paper.venue ?? '',
      keywords: [],
      citationCount: paper.citationCount ?? 0,
      isOpenAccess: paper.isOpenAccess ?? false,
      ingestedAt: new Date().toISOString(),
      tenantId: ''
    }));
  } catch (error) {
    console.error("Error fetching from Semantic Scholar:", error);
    return [];
  }
}

// ── Rate-limited fetcher (per-source queue + minimum delay) ──────────────────
const sourceDelays = new Map<string, number>();
const sourceQueues = new Map<string, Promise<void>>();

async function rateLimitedFetch<T>(
  sourceName: string,
  fetcher: () => Promise<T>,
  minDelayMs = DEFAULT_API_RATE_LIMIT_MS
): Promise<T> {
  const prev = sourceQueues.get(sourceName) || Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });

  const queued = prev.then(() => gate);
  sourceQueues.set(sourceName, queued);

  await prev;
  try {
    const lastCall = sourceDelays.get(sourceName) || 0;
    const elapsed = Date.now() - lastCall;
    if (elapsed < minDelayMs) {
      await new Promise(resolve => setTimeout(resolve, minDelayMs - elapsed));
    }
    sourceDelays.set(sourceName, Date.now());
    return await fetcher();
  } finally {
    release();
    if (sourceQueues.get(sourceName) === queued) {
      sourceQueues.delete(sourceName);
    }
  }
}

// ── Main export: fetch all sources for a query ────────────────────────────
export async function ingestLiterature(query: string, tenantId: string): Promise<ResearchPaper[]> {
  const [pubmed, openalex, europepmc, semanticscholar] = await Promise.allSettled([
    rateLimitedFetch('pubmed', () => fetchPubMed(query)),
    rateLimitedFetch('openalex', () => fetchOpenAlex(query)),
    rateLimitedFetch('europepmc', () => fetchEuropePMC(query)),
    rateLimitedFetch('semanticscholar', () => fetchSemanticScholar(query)),
  ]);

  const all: ResearchPaper[] = [
    ...(pubmed.status === 'fulfilled' ? pubmed.value : []),
    ...(openalex.status === 'fulfilled' ? openalex.value : []),
    ...(europepmc.status === 'fulfilled' ? europepmc.value : []),
    ...(semanticscholar.status === 'fulfilled' ? semanticscholar.value : []),
  ].map(p => ({ ...p, tenantId }));

  // Multi-key deduplication: check DOI, PMID, normalized title, and URL
  const doiSeen = new Set<string>();
  const pmidSeen = new Set<string>();
  const titleSeen = new Set<string>();
  const urlSeen = new Set<string>();

  const deduped = all.filter(p => {
    const doiNorm = p.doi?.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim();
    const pmidNorm = p.pmid?.trim();
    const titleKey = p.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, TITLE_DEDUP_KEY_LENGTH);
    const urlHash = p.url ? crypto.createHash('md5').update(p.url).digest('hex').slice(0, 16) : '';

    // Check all identity keys independently for cross-source dedup
    if (doiNorm && doiSeen.has(doiNorm)) return false;
    if (pmidNorm && pmidSeen.has(pmidNorm)) return false;
    if (titleKey && titleSeen.has(titleKey)) return false;
    if (urlHash && urlSeen.has(urlHash)) return false;

    if (doiNorm) doiSeen.add(doiNorm);
    if (pmidNorm) pmidSeen.add(pmidNorm);
    if (titleKey) titleSeen.add(titleKey);
    if (urlHash) urlSeen.add(urlHash);
    return true;
  });

  return deduped;
}

export { HEMP_QUERY_TERMS };
