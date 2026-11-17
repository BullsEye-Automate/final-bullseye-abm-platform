import type { SupabaseClient } from "@supabase/supabase-js";
import { loadClientLinks } from "./portalLink";
import { readDocs } from "./store";
import { getClientIcpText } from "@/lib/wishlist";

// Revisión de empresas recomendadas por IA antes de mostrarlas (pedido de
// BullsEye, 17-nov-2026: "confiar en el criterio de lo que se propone").
// Compara cada empresa, con nombre y dominio flexibles, contra todo lo que la
// haría repetida o no apta, y la clasifica en:
//   - "block": coincidencia segura → no se muestra (status "excluded");
//   - "note":  duda → se muestra con una nota para revisarla a mano;
//   - "ok".
// Fuentes: wishlist, lista de exclusión del cliente (empresas y palabras
// clave), omitidas, excluded_companies, companies (flujo anterior), universo
// de Pulso ABM (cuentas que BullsEye ya trabaja en HubSpot), cuentas e
// historial del Centro, recomendaciones ya pendientes del cliente, clientes
// actuales del ICP y textos de la ficha (Exclusiones = seguro, Contexto = duda).

export type AuditLevel = "block" | "note" | "ok";
export type AuditResult = { level: AuditLevel; reasons: string[] };
type Ref = { name: string; dom: string | null; src: string; extra?: string; c: string; p: string; d: string | null; root: string | null; ctry: Set<string> };
type Text = { src: string; strong: boolean; norm: string };

const COUNTRIES = ["chile", "peru", "mexico", "colombia", "argentina", "brasil", "brazil", "ecuador", "uruguay", "paraguay", "bolivia", "panama", "guatemala", "espana", "spain", "usa"];
const LEGAL = new Set([
  "sa", "s", "a", "spa", "ltda", "limitada", "inc", "llc", "sas", "sac", "saa", "srl", "eirl", "corp", "corporation",
  "cv", "de", "rl", "sab", "sl", "ltd", "plc", "gmbh", "cia", "compania", "company", "co", "group", "grupo", "holding",
  "holdings", "latam", "latinoamerica", "the", "y", "e", "la", "el", "los", "las", "en", "del", ...COUNTRIES,
]);
const deaccent = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const words = (s: string) => deaccent(s).replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
export const coreName = (s: string) => {
  const w = words(s);
  const k = w.filter((x) => !LEGAL.has(x));
  return (k.length ? k : w).join("");
};
const phrase = (s: string) => {
  const w = words(s);
  const k = w.filter((x) => !LEGAL.has(x));
  return (k.length ? k : w).join(" ");
};
const countriesOf = (name: string, dom: string | null) => {
  const s = new Set(words(name).filter((w) => COUNTRIES.includes(w)));
  const tld = (dom ?? "").split(".").pop() ?? "";
  const map: Record<string, string> = { cl: "chile", pe: "peru", mx: "mexico", co: "colombia", ar: "argentina", br: "brasil", ec: "ecuador", uy: "uruguay", py: "paraguay", bo: "bolivia", pa: "panama", gt: "guatemala", es: "espana" };
  if (map[tld]) s.add(map[tld]);
  return s;
};
export function fullDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].replace(/^(sitio|web|site|about|co|es|cl)\./, "");
  return d.includes(".") ? d : null;
}
export function domainRoot(raw: string | null | undefined): string | null {
  const d = fullDomain(raw);
  if (!d) return null;
  const parts = d.split(".");
  while (parts.length > 1 && (parts[parts.length - 1].length <= 3 || ["info", "global", "group", "tech", "online"].includes(parts[parts.length - 1]))) parts.pop();
  const root = parts[parts.length - 1];
  if (!root || ["linkedin", "facebook", "google", "gmail", "hotmail", "outlook", "wixsite", "blogspot"].includes(root)) return null;
  return root.length >= 3 ? root : null;
}
const fmtDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" }) : "");

const PAGE = 1000;
async function all<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; f < 100_000; f += PAGE) {
    const { data, error } = await q(f, f + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
const field = (text: string, label: string) => {
  const out: string[] = [];
  const re = new RegExp(`\\[${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*([\\s\\S]*?)(?=\\n\\[|\\n===|$)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out.join("\n");
};

export type AuditContext = { refs: Ref[]; keywords: string[]; texts: Text[]; add(name: string, dom: string | null, src: string, extra?: string): void };

/** Todo lo que se compara para un cliente. `skipPendingIds`: recomendaciones que no se cargan (la que se está revisando). */
export async function loadAuditContext(db: SupabaseClient, clientId: string, opts: { pending?: boolean } = {}): Promise<AuditContext> {
  const refs: Ref[] = [];
  const keywords: string[] = [];
  const add = (name: string, dom: string | null, src: string, extra?: string) => {
    if (!name?.trim() && !dom) return;
    const n = name?.trim() || dom || "";
    refs.push({ name: n, dom, src, extra, c: coreName(n), p: ` ${phrase(n)} `, d: fullDomain(dom), root: domainRoot(dom), ctry: countriesOf(n, fullDomain(dom)) });
  };
  const links = await loadClientLinks();
  const fichas = links.fichasByClient.get(clientId) ?? [];
  const fichaIds = new Set(fichas.map((f) => f.id));
  const [wl, exc, cex, omi, co, snap, centroDocs, icp, pend] = await Promise.all([
    all<{ company_name: string; domain: string | null; status: string }>((a, b) => db.from("client_wishlist").select("company_name, domain, status").eq("client_id", clientId).range(a, b)),
    all<{ company_name: string; company_website: string | null }>((a, b) => db.from("excluded_companies").select("company_name, company_website").eq("client_id", clientId).range(a, b)),
    all<{ kind: string; company_name: string | null; domain: string | null; keyword: string | null; reason: string | null }>((a, b) => db.from("client_exclusions").select("kind, company_name, domain, keyword, reason").eq("client_id", clientId).range(a, b)),
    all<{ company_name: string; domain: string | null }>((a, b) => db.from("client_omitted_companies").select("company_name, domain").eq("client_id", clientId).range(a, b)),
    all<{ company_name: string; company_website: string | null }>((a, b) => db.from("companies").select("company_name, company_website").eq("client_id", clientId).range(a, b)),
    db.from("radar_abm_snapshots").select("companies:dataset->client->companies").eq("client_id", clientId).maybeSingle(),
    readDocs(["cuentas", "historial"]),
    getClientIcpText(db, clientId).catch(() => ""),
    opts.pending === false
      ? Promise.resolve([] as { company_name: string; domain: string | null }[])
      : all<{ company_name: string; domain: string | null }>((a, b) => db.from("client_recommendations").select("company_name, domain").eq("client_id", clientId).eq("status", "pending").range(a, b)),
  ]);
  for (const r of wl) add(r.company_name, r.domain, "ya está en la wishlist del cliente", r.status);
  for (const r of exc) add(r.company_name, r.company_website, "empresas excluidas");
  for (const r of cex) {
    if (r.kind === "keyword" && r.keyword) keywords.push(r.keyword);
    else add(r.company_name ?? "", r.domain, "lista de exclusión del cliente", r.reason ?? undefined);
  }
  for (const r of omi) add(r.company_name, r.domain, "descartada antes");
  for (const r of co) add(r.company_name, r.company_website, "ya trabajada (Empresas, flujo anterior)");
  const worked = (Array.isArray((snap.data as any)?.companies) ? (snap.data as any).companies : []) as { n?: string; dom?: string }[];
  for (const c of worked) if (c.n) add(c.n, c.dom ?? null, "ya la trabaja BullsEye en HubSpot (Pulso ABM)");
  for (const d of centroDocs) {
    if (!fichaIds.has(String(d.data?.clienteId ?? ""))) continue;
    if (d.collection === "cuentas" && d.data?.empresa) add(String(d.data.empresa), typeof d.data.web === "string" ? d.data.web : null, "cuentas del Centro", String(d.data.respuesta ?? ""));
    if (d.collection === "historial" && Array.isArray(d.data?.empresas)) {
      for (const e of d.data.empresas as unknown[]) if (Array.isArray(e) && e[1]) add(String(e[1]), null, "historial del Centro (ya trabajada)", fmtDate(String(e[2] ?? "")));
    }
  }
  for (const r of pend) add(r.company_name, r.domain, "ya recomendada (pendiente)");
  const mk = (src: string, strong: boolean, t: string): Text => ({ src, strong, norm: ` ${words(t).join(" ")} ` });
  const texts: Text[] = [
    mk("el ICP la nombra como cliente actual o pasado", true, field(icp, "Mejores clientes actuales o pasados")),
    mk("el ICP la nombra como mal fit", true, field(icp, "Peores clientes / mal fit")),
    ...fichas.map((f) => mk("aparece en Exclusiones de la ficha", true, String(f.data.exclusiones ?? ""))),
    ...fichas.map((f) => mk("aparece en el Contexto de la ficha", false, String(f.data.contexto ?? ""))),
  ];
  return { refs, keywords, texts, add };
}

/** Clasifica una empresa. Las coincidencias seguras bloquean; las parecidas dejan nota. */
export function auditCompany(ctx: AuditContext, name: string, domain: string | null): AuditResult {
  const c = coreName(name), pp = ` ${phrase(name)} `, d = fullDomain(domain), root = domainRoot(domain), p = phrase(name), ctry = countriesOf(name, d);
  const block: string[] = [];
  const note: string[] = [];
  const label = (x: Ref) => `«${x.name}» (${x.src}${x.extra ? `: ${x.extra}` : ""})`;
  for (const x of ctx.refs) {
    const sameName = !!c && c === x.c;
    // parecida: una contiene a la otra por palabras completas ("Camanchaca" ⊂ "Salmones Camanchaca")
    const similar = !sameName && pp.length >= 7 && x.p.length >= 7 && (pp.includes(x.p) || x.p.includes(pp));
    const sameRoot = !!root && root === x.root;
    const otherCountry = ctry.size > 0 && x.ctry.size > 0 && ![...ctry].some((k) => x.ctry.has(k));
    if ((d && x.d && d === x.d) || sameName || (sameRoot && similar)) {
      if (otherCountry) note.push(`Misma marca en otro país que ${label(x)}`);
      else block.push(`Coincide con ${label(x)}`);
    } else if (sameRoot || similar) note.push(`Parecida a ${label(x)}`);
  }
  const nn = ` ${words(name).join(" ")} `;
  for (const k of ctx.keywords) {
    const kw = words(k).join(" ");
    if (kw && nn.includes(` ${kw} `)) block.push(`Contiene «${k}» (palabra clave de la lista de exclusión del cliente)`);
  }
  if (p.length >= 4) {
    for (const t of ctx.texts) if (t.norm.includes(` ${p} `)) (t.strong ? block : note).push(`${t.src[0].toUpperCase()}${t.src.slice(1)}`);
  }
  const uniq = (xs: string[]) => Array.from(new Set(xs)).slice(0, 3);
  if (block.length) return { level: "block", reasons: uniq(block) };
  if (note.length) return { level: "note", reasons: uniq(note) };
  return { level: "ok", reasons: [] };
}

/** Marca dentro de `facts` (la tarjeta la muestra como nota y no la envía al cliente). */
export const REVIEW_FACT = "__revisar";
export const BLOCK_FACT = "__bloqueo";
export function withAuditFact(facts: { label: string; value: string }[], r: AuditResult): { label: string; value: string }[] {
  const clean = facts.filter((f) => f.label !== REVIEW_FACT && f.label !== BLOCK_FACT);
  if (r.level === "ok") return clean;
  return [...clean, { label: r.level === "block" ? BLOCK_FACT : REVIEW_FACT, value: r.reasons.join(" · ").slice(0, 400) }];
}
