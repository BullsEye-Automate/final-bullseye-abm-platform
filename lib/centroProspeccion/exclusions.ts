import { readDocs } from "./store";
import { loadClientLinks } from "./portalLink";

// Empresas del Centro de prospección que no se le deben volver a recomendar a
// un cliente (filtro duro, además de lo que la IA lee de la ficha):
//  - cuentas: todas las de la colección "cuentas" de sus fichas, con o sin
//    respuesta del cliente (ya se trabajaron a mano o ya se le propusieron);
//  - exclusiones de la ficha: empresas nombradas en el campo «Exclusiones».
//    El texto es libre, así que se separa por líneas, comas y puntos y comas
//    y cada trozo corto se usa solo como nombre exacto (más dominios web que
//    aparezcan). Un criterio como "sector público" no calza con ninguna
//    empresa por nombre exacto y no excluye nada por error.

export type CentroExclusions = { names: string[]; domains: string[] };

const DOMAIN_RE = /\b((?:[a-z0-9-]+\.)+(?:com|cl|mx|pe|co|ar|br|es|net|org|io|ai|app|tech|com\.[a-z]{2}))\b/gi;
const PREFIX_RE = /^(excluir|excluye|exclusiones?|no (prospectar|contactar|incluir)|evitar|salvo|menos|clientes? actuales?|competidores?|competencia|ya son clientes?)\s*[:\-–]?\s*/i;

export function namesFromFichaText(text: string): { names: string[]; domains: string[] } {
  const domains = Array.from(new Set(Array.from(text.matchAll(DOMAIN_RE)).map((m) => m[1].toLowerCase().replace(/^www\./, ""))));
  const names = new Set<string>();
  for (const raw of text.split(/[\n;,•·|]+|\.\s+| y (?=[A-ZÁÉÍÓÚÑ])/)) {
    let t = raw.replace(/^[\s\-–*•\d.)]+/, "").replace(PREFIX_RE, "").replace(/\(.*?\)/g, "").replace(/[.:]+$/, "").trim();
    t = t.replace(PREFIX_RE, "").trim();
    if (t.length < 2 || t.length > 60) continue;
    if (t.split(/\s+/).length > 6) continue;
    names.add(t);
  }
  return { names: Array.from(names), domains };
}

export async function centroExclusionsFor(clientId: string, opts: { cuentas?: boolean; ficha?: boolean } = {}): Promise<CentroExclusions> {
  const { cuentas = true, ficha = true } = opts;
  const links = await loadClientLinks();
  const fichas = links.fichasByClient.get(clientId) ?? [];
  if (!fichas.length) return { names: [], domains: [] };
  const ids = new Set(fichas.map((f) => f.id));
  const names: string[] = [];
  const domains: string[] = [];
  if (ficha) {
    for (const f of fichas) {
      const r = namesFromFichaText(String(f.data.exclusiones ?? ""));
      names.push(...r.names);
      domains.push(...r.domains);
    }
  }
  if (cuentas) {
    for (const d of await readDocs(["cuentas"])) {
      if (!ids.has(String(d.data?.clienteId ?? ""))) continue;
      const empresa = String(d.data?.empresa ?? "").trim();
      if (empresa) names.push(empresa);
      if (typeof d.data?.web === "string" && d.data.web.trim()) domains.push(d.data.web.trim());
    }
  }
  return { names, domains };
}
