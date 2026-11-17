import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { readDocs } from "@/lib/centroProspeccion/store";
import { getClientIcpText } from "@/lib/wishlist";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Auditoría de las empresas recomendadas por IA (pedido de BullsEye,
// 17-nov-2026). Solo lectura: revisa cada recomendación creada desde `desde`
// contra todo lo que podría hacerla repetida o no apta, con comparación
// flexible (sin razón social ni país en el nombre, dominio sin extensión),
// más amplia que el filtro exacto que se aplica al generarlas:
//   wishlist del cliente (cualquier estado), lista de exclusión del cliente
//   (empresas y palabras clave), omitidas, excluded_companies, companies
//   (flujo anterior), universo de Pulso ABM (cuentas que BullsEye ya trabaja),
//   cuentas e historial del Centro, empresas nombradas en el ICP como
//   clientes actuales y menciones en Exclusiones / Contexto de la ficha;
//   además repetidas dentro del mismo cliente y entre clientes.

type Ref = { name: string; dom?: string | null; src: string; extra?: string };

const LEGAL = new Set([
  "sa", "s", "a", "spa", "ltda", "limitada", "inc", "llc", "sas", "sac", "saa", "srl", "eirl", "corp", "corporation",
  "cv", "de", "rl", "sab", "sl", "ltd", "plc", "gmbh", "cia", "compania", "company", "co", "group", "grupo", "holding",
  "holdings", "chile", "peru", "mexico", "colombia", "argentina", "latam", "latinoamerica", "the", "y", "e", "la", "el", "los", "las",
]);
const deaccent = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const words = (s: string) => deaccent(s).replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const core = (s: string) => {
  const w = words(s);
  const k = w.filter((x) => !LEGAL.has(x));
  return (k.length ? k : w).join("");
};
const phrase = (s: string) => {
  const w = words(s);
  const k = w.filter((x) => !LEGAL.has(x));
  return (k.length ? k : w).join(" ");
};
function domRoot(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (!d.includes(".")) return null;
  const parts = d.split(".");
  // quita extensiones: .com, .cl, .com.mx, .co, …
  while (parts.length > 1 && (parts[parts.length - 1].length <= 3 || ["info", "global", "group", "tech", "online"].includes(parts[parts.length - 1]))) parts.pop();
  const root = parts[parts.length - 1];
  if (!root || ["linkedin", "facebook", "google", "gmail", "hotmail", "outlook", "wixsite", "blogspot"].includes(root)) return null;
  return root.length >= 3 ? root : null;
}

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

export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const desde = req.nextUrl.searchParams.get("desde") ?? "2026-11-15";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return NextResponse.json({ error: "desde inválido" }, { status: 400 });
  const db = supabaseAdmin();

  try {
    const recos = await all<{ id: string; client_id: string; company_name: string; domain: string | null; fit_score: number; status: string; created_at: string; fit_reason: string }>((a, b) =>
      db.from("client_recommendations").select("id, client_id, company_name, domain, fit_score, status, created_at, fit_reason").gte("created_at", `${desde}T03:00:00Z`).order("created_at").range(a, b)
    );
    const links = await loadClientLinks();
    const centroDocs = await readDocs(["cuentas", "historial"]);
    const clientName = new Map(links.clients.map((c) => [c.id, c.name]));
    const byClient = new Map<string, typeof recos>();
    for (const r of recos) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);

    // Entre clientes: misma empresa recomendada a más de uno
    const crossKey = new Map<string, Set<string>>();
    for (const r of recos) {
      const k = domRoot(r.domain) ?? core(r.company_name);
      crossKey.set(k, new Set([...(crossKey.get(k) ?? []), r.client_id]));
    }

    const clientsOut = [];
    for (const [clientId, list] of byClient) {
      const fichas = links.fichasByClient.get(clientId) ?? [];
      const fichaIds = new Set(fichas.map((f) => f.id));
      const refs: Ref[] = [];
      const keywords: string[] = [];

      const [wl, exc, cex, omi, snap] = await Promise.all([
        all<{ company_name: string; domain: string | null; status: string }>((a, b) => db.from("client_wishlist").select("company_name, domain, status").eq("client_id", clientId).range(a, b)),
        all<{ company_name: string; company_website: string | null; reason?: string | null }>((a, b) => db.from("excluded_companies").select("company_name, company_website").eq("client_id", clientId).range(a, b)),
        all<{ kind: string; company_name: string | null; domain: string | null; keyword: string | null; reason?: string | null }>((a, b) => db.from("client_exclusions").select("kind, company_name, domain, keyword").eq("client_id", clientId).range(a, b)),
        all<{ company_name: string; domain: string | null }>((a, b) => db.from("client_omitted_companies").select("company_name, domain").eq("client_id", clientId).range(a, b)),
        db.from("radar_abm_snapshots").select("companies:dataset->client->companies").eq("client_id", clientId).maybeSingle(),
      ]);
      for (const r of wl) refs.push({ name: r.company_name, dom: r.domain, src: "Wishlist del cliente", extra: r.status });
      for (const r of exc) refs.push({ name: r.company_name, dom: r.company_website, src: "Empresas excluidas (interna)" });
      for (const r of cex) {
        if (r.kind === "keyword" && r.keyword) keywords.push(r.keyword);
        else if (r.company_name || r.domain) refs.push({ name: r.company_name ?? r.domain ?? "", dom: r.domain, src: "Lista de exclusión del cliente" });
      }
      for (const r of omi) refs.push({ name: r.company_name, dom: r.domain, src: "Omitidas" });
      const co = await all<{ company_name: string; company_website: string | null; status: string | null }>((a, b) => db.from("companies").select("company_name, company_website, status").eq("client_id", clientId).range(a, b));
      for (const r of co) refs.push({ name: r.company_name, dom: r.company_website, src: "Empresas (flujo anterior)", extra: r.status ?? "" });
      const worked = (Array.isArray((snap.data as any)?.companies) ? (snap.data as any).companies : []) as { n?: string; dom?: string }[];
      for (const c of worked) if (c.n) refs.push({ name: c.n, dom: c.dom, src: "Ya trabajada por BullsEye (Pulso ABM / HubSpot)" });
      for (const d of centroDocs) {
        if (!fichaIds.has(String(d.data?.clienteId ?? ""))) continue;
        if (d.collection === "cuentas" && d.data?.empresa) refs.push({ name: String(d.data.empresa), dom: typeof d.data.web === "string" ? d.data.web : null, src: "Cuentas del Centro", extra: String(d.data.respuesta ?? d.data.estadoTrabajo ?? "") });
        if (d.collection === "historial" && Array.isArray(d.data?.empresas)) {
          for (const e of d.data.empresas as unknown[]) if (Array.isArray(e) && e[1]) refs.push({ name: String(e[1]), src: "Historial del Centro (ya trabajada)", extra: String(e[2] ?? "") });
        }
      }

      // Textos: ICP (clientes actuales) y ficha (exclusiones / contexto)
      const icp = await getClientIcpText(db, clientId).catch(() => "");
      const texts = [
        { src: "ICP: clientes actuales o pasados del cliente", t: field(icp, "Mejores clientes actuales o pasados") },
        { src: "ICP: peores clientes / mal fit", t: field(icp, "Peores clientes / mal fit") },
        { src: "ICP: industrias excluidas / descalificadores", t: field(icp, "Industrias excluidas") + "\n" + field(icp, "Señales negativas / descalificadores") },
        ...fichas.map((f) => ({ src: "Ficha del Centro: Exclusiones", t: String(f.data.exclusiones ?? "") })),
        ...fichas.map((f) => ({ src: "Ficha del Centro: Contexto", t: String(f.data.contexto ?? "") })),
      ].map((x) => ({ ...x, norm: ` ${words(x.t).join(" ")} ` }));

      const idx = refs.map((r) => ({ ...r, c: core(r.name), d: domRoot(r.dom) }));
      const seen = new Map<string, string>();
      const flagged = [];
      for (const r of list) {
        const c = core(r.company_name), d = domRoot(r.domain), p = phrase(r.company_name);
        const hits: { tipo: string; fuente: string; coincide: string; detalle?: string }[] = [];
        for (const x of idx) {
          let tipo = "";
          if (d && x.d && d === x.d) tipo = "mismo dominio";
          else if (c && x.c && c === x.c) tipo = "mismo nombre";
          else if (c.length >= 6 && x.c.length >= 6 && (c.includes(x.c) || x.c.includes(c))) tipo = "nombre parecido";
          if (tipo) hits.push({ tipo, fuente: x.src, coincide: `${x.name}${x.dom ? ` (${x.dom})` : ""}`, detalle: x.extra || undefined });
        }
        const nn = words(r.company_name).join(" ");
        for (const k of keywords) if (nn.includes(words(k).join(" "))) hits.push({ tipo: "palabra clave", fuente: "Lista de exclusión del cliente", coincide: k });
        if (p.length >= 4) {
          for (const t of texts) {
            const i = t.norm.indexOf(` ${p} `);
            if (i >= 0) hits.push({ tipo: "mencionada", fuente: t.src, coincide: r.company_name, detalle: t.norm.slice(Math.max(0, i - 60), i + p.length + 60).trim() });
          }
        }
        if (/\[CLIENTE_ACTUAL\]|cliente actual|ya es cliente/i.test(r.fit_reason)) hits.push({ tipo: "la IA la marcó como cliente", fuente: "Razón del fit", coincide: r.fit_reason.slice(0, 160) });
        const k = d ?? c;
        if (seen.has(k)) hits.push({ tipo: "repetida", fuente: "Recomendaciones del mismo cliente", coincide: seen.get(k)! });
        else seen.set(k, r.company_name);
        const otros = Array.from(crossKey.get(d ?? c) ?? []).filter((x) => x !== clientId).map((x) => clientName.get(x) ?? x);
        if (otros.length) hits.push({ tipo: "también recomendada a otro cliente", fuente: "Recomendaciones", coincide: otros.join(", ") });
        // dedupe
        const uniq = Array.from(new Map(hits.map((h) => [`${h.tipo}|${h.fuente}|${h.coincide}`, h])).values()).slice(0, 12);
        if (uniq.length) flagged.push({ empresa: r.company_name, dominio: r.domain, fit: r.fit_score, estado: r.status, creada: r.created_at, hallazgos: uniq });
      }
      clientsOut.push({
        cliente: clientName.get(clientId) ?? clientId, clientId, total: list.length,
        estados: list.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}),
        fuentesRevisadas: { wishlist: wl.length, excluidas: exc.length, exclusionCliente: cex.length, omitidas: omi.length, companies: co.length, pulso: worked.length, icp: icp.length > 0, fichas: fichas.length },
        conHallazgos: flagged.length, flagged,
      });
    }
    clientsOut.sort((a, b) => b.conHallazgos - a.conHallazgos);
    return NextResponse.json({ desde, total: recos.length, clientes: clientsOut }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
