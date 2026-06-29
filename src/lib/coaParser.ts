export interface ExtractionResult {
  extracted: boolean;
  value: any;
  confidence: number;
}

export function extractStrain(text: string): ExtractionResult {
  const m = text.match(/(?:strain|cultivar|sample name|product)\s*[:\-]\s*([\w\s]+)/i);
  if (m) {
    return { extracted: true, value: m[1].trim(), confidence: 0.9 };
  }
  return { extracted: false, value: null, confidence: 0 };
}

export function extractThca(text: string): ExtractionResult {
  const m = text.match(/\b(?:THCa|THCA|thca)\s*[:\-]?\s*([0-9]+\.?[0-9]*)\s*%?/i);
  if (m) {
    const val = parseFloat(m[1]);
    if (val >= 0 && val <= 100) return { extracted: true, value: val, confidence: 1 };
  }
  return { extracted: false, value: 0, confidence: 0 };
}

export function extractD9Thc(text: string): ExtractionResult {
  let m = text.match(/\b(?:Delta-9|D9|Δ9|delta9|d9-thc|delta-9-thc)\s*[-\s]?(?:THC)?\s*[:\-]?\s*([0-9]+\.?[0-9]*)\s*%?/i);
  if (!m) {
    m = text.match(/\bthc\s*[:\-]\s*([0-9]+\.?[0-9]*)/i);
  }
  if (m) {
    const val = parseFloat(m[1]);
    if (val >= 0 && val <= 100) return { extracted: true, value: val, confidence: 1 };
  }
  return { extracted: false, value: 0, confidence: 0 };
}

export function extractBatchId(text: string): ExtractionResult {
  let m = text.match(/(?:Batch\s*(?:ID|#|No\.?)?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]+)/i);
  if (!m) {
    m = text.match(/(?:Batch\s*#\s*[:\-]?)\s*([A-Z0-9][A-Z0-9\-]+)/i);
  }
  if (m) {
    return { extracted: true, value: m[1], confidence: 1 };
  }
  return { extracted: false, value: null, confidence: 0 };
}

export function parseCOAWithRegex(text: string, fallbackBatchId: string) {
  const strainRes = extractStrain(text);
  const thcaRes = extractThca(text);
  const d9thcRes = extractD9Thc(text);
  const batchIdRes = extractBatchId(text);
  
  let confidence = 0;
  if (strainRes.extracted) confidence += 0.25;
  if (thcaRes.extracted) confidence += 0.25;
  if (d9thcRes.extracted) confidence += 0.25;
  if (batchIdRes.extracted) confidence += 0.25;

  const thca = thcaRes.extracted ? thcaRes.value : 0;
  const d9thc = d9thcRes.extracted ? d9thcRes.value : 0;
  const totalThc = parseFloat(((thca * 0.877) + d9thc).toFixed(3));
  
  let status: 'Compliant' | 'At Risk' | 'Non-Compliant' = 'Compliant';
  if (totalThc > 0.3) status = 'Non-Compliant';
  else if (totalThc >= 0.25) status = 'At Risk';
  
  return {
    batchId: batchIdRes.extracted ? batchIdRes.value : fallbackBatchId,
    strain: strainRes.extracted ? strainRes.value : 'Unknown',
    thca,
    d9thc,
    totalThc,
    status,
    confidence,
    extractionDetails: {
      strainExtracted: strainRes.extracted,
      thcaExtracted: thcaRes.extracted,
      d9thcExtracted: d9thcRes.extracted,
      batchIdExtracted: batchIdRes.extracted
    }
  };
}
