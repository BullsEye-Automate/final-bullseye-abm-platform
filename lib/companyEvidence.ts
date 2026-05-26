const STOP_WORDS = new Set([
  "the","and","for","with","from","that","this","are","has","was","its",
  "inc","llc","corp","ltd","sa","sas","spa","srl","de","del","la","los",
  "las","el","en","un","una","por","con","sin"
]);

export function citationNamesCompany(
  citation: { title?: string; url?: string },
  companyName: string
): boolean {
  const sigWords = companyName
    .toLowerCase()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 2);
  if (sigWords.length === 0) return false;
  const text = `${citation.title ?? ""} ${citation.url ?? ""}`.toLowerCase();
  return sigWords.every(w => text.includes(w));
}

export function evidenceQuality(
  companyName: string,
  citations: Array<{ title?: string; url?: string }>
): "specific" | "generic" | "none" {
  if (!citations || citations.length === 0) return "none";
  const named = citations.filter(c => citationNamesCompany(c, companyName));
  return named.length > 0 ? "specific" : "generic";
}

export function validateCompanyEvidence(company: Record<string, any>) {
  const quality = evidenceQuality(company.company_name, company.research_sources ?? []);
  if (quality === "specific") return { ...company, evidence_quality: "specific" };
  return {
    ...company,
    fit_signals: null,
    cad_software: null,
    scanner_technology: null,
    fit_score: "low",
    evidence_quality: quality
  };
}
