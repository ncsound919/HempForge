/**
 * src/notebook/sourceSpans.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Source span extraction. Deterministic sentence/paragraph tokenizer with
 * metadata tagging (compounds, methods, regulatory, numerical claims).
 *
 * Each span is a stable, citable unit of evidence with byte offsets so the UI
 * can render "jump to source" affordances.
 */

export interface SourceSpan {
  id: string;
  /** Source id this span came from. */
  sourceId: string;
  /** 0-based paragraph index inside the source. */
  paragraphIndex: number;
  /** 0-based sentence index inside the paragraph. */
  sentenceIndex: number;
  /** Plain text of the span. */
  text: string;
  /** Character offset into the joined text. */
  charStart: number;
  charEnd: number;
  /** Detected tags. */
  tags: SpanTags;
  /** Numerical claims like "0.877", "145°C", "120 min". */
  numericalClaims: string[];
}

export interface SpanTags {
  compounds: string[];
  methods: string[];
  regulatory: string[];
  numerical: boolean;
}

const COMPOUND_NAMES = [
  "THCa","THC","Delta-9-THC","Δ9-THC","CBD","CBDa","CBG","CBGa","CBN","CBC","THCV",
  "Myrcene","Limonene","Linalool","Pinene","Caryophyllene","Humulene",
  "Quercetin","Apigenin","Cannaflavin A","Terpinolene","Ocimene",
];

const METHOD_NAMES = [
  "HPLC","GC-MS","GC/MS","mass spectrometry","NMR","chromatography",
  "decarboxylation","decarb","distillation","short-path","wiped film",
  "supercritical CO2","ethanol extraction","hydrocarbon extraction","rosin press",
  "Arrhenius","kinetics","spectroscopy","titration","gravimetric",
];

const REGULATORY_TERMS = [
  "compliant","non-compliant","at risk","threshold","0.3%","0.25%","0.4 mg",
  "FDA","USDA","NCGS","North Carolina","dry weight","serving","capsule",
  "infused edible","industrial hemp","cannabis sativa","certificate of analysis",
  "audit","ALCOA","GxP","compliance",
];

const NUMBER_RE = /(?:\d+(?:\.\d+)?\s*(?:%|°C|°F|mg\/g|mg\/mL|ppm|min|hr|h|kg|g|mg|mL|μL|uL))/g;

function uniquePush(arr: string[], val: string, max = 25): void {
  if (arr.length >= max) return;
  if (!arr.includes(val)) arr.push(val);
}

function findAll(haystack: string, needle: string, max = 25): string[] {
  const out: string[] = [];
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    out.push(m[0]);
    if (out.length >= max) break;
  }
  return out;
}

function tagSpan(text: string): SpanTags {
  const lower = text.toLowerCase();
  const compounds: string[] = [];
  for (const c of COMPOUND_NAMES) {
    const hits = findAll(lower, c);
    if (hits.length) uniquePush(compounds, c);
  }
  const methods: string[] = [];
  for (const m of METHOD_NAMES) {
    const hits = findAll(lower, m);
    if (hits.length) uniquePush(methods, m);
  }
  const regulatory: string[] = [];
  for (const r of REGULATORY_TERMS) {
    const hits = findAll(lower, r);
    if (hits.length) uniquePush(regulatory, r);
  }
  return {
    compounds,
    methods,
    regulatory,
    numerical: NUMBER_RE.test(text),
  };
}

/**
 * Tokenize a source into spans. We split on blank lines (paragraphs) and
 * sentence-ending punctuation. Each span carries tag metadata for retrieval
 * and synthesis.
 */
export function extractSpans(
  sourceId: string,
  text: string
): SourceSpan[] {
  const out: SourceSpan[] = [];
  const paragraphs = (text || "").split(/\n\s*\n+/);
  let charCursor = 0;

  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p].trim();
    if (!para) continue;
    const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z0-9Δ])/).map((s) => s.trim()).filter(Boolean);
    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      const tags = tagSpan(sentence);
      const numericalClaims = (sentence.match(NUMBER_RE) ?? []);
      const id = `${sourceId}:p${p}:s${s}`;
      out.push({
        id,
        sourceId,
        paragraphIndex: p,
        sentenceIndex: s,
        text: sentence,
        charStart: charCursor,
        charEnd: charCursor + sentence.length,
        tags,
        numericalClaims,
      });
      charCursor += sentence.length + 1;
    }
  }
  return out;
}

export function spanSummary(span: SourceSpan): string {
  const parts: string[] = [];
  if (span.tags.compounds.length) parts.push(`compounds: ${span.tags.compounds.slice(0, 3).join(", ")}`);
  if (span.tags.methods.length) parts.push(`methods: ${span.tags.methods.slice(0, 3).join(", ")}`);
  if (span.tags.regulatory.length) parts.push(`regulatory: ${span.tags.regulatory.slice(0, 3).join(", ")}`);
  if (span.tags.numerical && span.numericalClaims.length) parts.push(`values: ${span.numericalClaims.slice(0, 4).join(", ")}`);
  return parts.join(" · ") || "(no tags)";
}