import { supabaseAdmin } from "@/lib/supabase";
import { fetchHSOwners } from "@/lib/hubspot";
import { batchAssociations, searchAll } from "@/lib/radarAbm/server/hubspot";

// Lo que escriben los SDR en HubSpot durante la semana (solo lectura):
//  - llamadas con texto: el resumen automático de Allo (etiquetas,
//    objeciones, resultado, próximos pasos) y los comentarios a mano del SDR;
//  - notas a mano del SDR ("solo números de central", "llamar en diciembre"…);
//  - minutas de reuniones con clientes cargadas por diio.
// Se descartan las notas automáticas de Lemlist y el puntaje / coaching de
// Allo (no aporta a la prospección). Cada ítem queda con las empresas y
// contactos asociados para repartirlo por cliente.
// El HubSpot de BullsEye se lee una vez por semana y se guarda en
// allo_response_cache (lo comparten las invocaciones de cada cliente).

export type FeedItem = {
  id: string;
  kind: "llamada" | "nota" | "minuta";
  fecha: string;            // AAAA-MM-DD
  sdr: string | null;       // nombre del usuario de HubSpot
  texto: string;
  cos: string[];            // empresas asociadas
  cts: string[];            // contactos asociados
};

const LEMLIST_NOISE = /from campaign|linkedin invite|email (opened|clicked|sent|bounced)|linkedin (like|last post|message|visit|profile)|clicked link/i;
const CUT_FROM = /(score (de|del) desempe[ñn]o|puntaje total|fortaleza principal|coaching para la pr[oó]xima|principal oportunidad de mejora|desglose:)/i;

export function cleanHtml(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<(br|\/p|\/h\d|\/li|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Sin correos ni teléfonos de prospectos
export function scrubPii(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[teléfono]");
}

function trimCall(text: string): string {
  const m = text.search(CUT_FROM);
  const body = m > 0 ? text.slice(0, m) : text;
  return body.trim();
}

const cacheKey = (since: string) => `centro_intel_hs:${since}`;

export async function readWeekFeed(since: string, token?: string): Promise<FeedItem[]> {
  const db = supabaseAdmin();
  if (!token) {
    const { data } = await db.from("allo_response_cache").select("response, expires_at").eq("cache_key", cacheKey(since)).maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now()) return data.response as FeedItem[];
  }
  const sinceMs = String(new Date(`${since}T00:00:00-03:00`).getTime());
  const filter = [{ filters: [{ propertyName: "hs_timestamp", operator: "GTE", value: sinceMs }] }];
  const [calls, notes, owners] = await Promise.all([
    searchAll("calls", [{ filters: [...filter[0].filters, { propertyName: "hs_call_body", operator: "HAS_PROPERTY" }] }], ["hs_call_title", "hs_call_body", "hs_timestamp", "hubspot_owner_id"], token, 4000),
    searchAll("notes", filter, ["hs_note_body", "hs_timestamp", "hubspot_owner_id"], token, 4000),
    fetchHSOwners(token).catch(() => []),
  ]);
  const ownerName = new Map(owners.map((o) => [String(o.id), [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || null]));

  const items: FeedItem[] = [];
  for (const c of calls) {
    const text = trimCall(cleanHtml(c.properties.hs_call_body));
    if (text.replace(/tags:.*$/im, "").trim().length < 20) continue;
    items.push({ id: `c${c.id}`, kind: "llamada", fecha: String(c.properties.hs_timestamp ?? "").slice(0, 10), sdr: ownerName.get(String(c.properties.hubspot_owner_id)) ?? null, texto: scrubPii(text).slice(0, 900), cos: [], cts: [] });
  }
  for (const n of notes) {
    const raw = cleanHtml(n.properties.hs_note_body);
    if (!raw || LEMLIST_NOISE.test(raw.slice(0, 160))) continue;
    const minuta = /cargada por diio/i.test(raw);
    if (!minuta && raw.length < 8) continue;
    items.push({ id: `n${n.id}`, kind: minuta ? "minuta" : "nota", fecha: String(n.properties.hs_timestamp ?? "").slice(0, 10), sdr: ownerName.get(String(n.properties.hubspot_owner_id)) ?? null, texto: scrubPii(raw).slice(0, minuta ? 3500 : 600), cos: [], cts: [] });
  }

  // Empresas y contactos asociados (para repartir por cliente)
  const deadline = Date.now() + 120_000;
  const callIds = items.filter((i) => i.kind === "llamada").map((i) => i.id.slice(1));
  const noteIds = items.filter((i) => i.kind !== "llamada").map((i) => i.id.slice(1));
  const [ccos, ccts, ncos, ncts] = await Promise.all([
    callIds.length ? batchAssociations("calls", "companies", callIds, token, deadline) : new Map<string, string[]>(),
    callIds.length ? batchAssociations("calls", "contacts", callIds, token, deadline) : new Map<string, string[]>(),
    noteIds.length ? batchAssociations("notes", "companies", noteIds, token, deadline) : new Map<string, string[]>(),
    noteIds.length ? batchAssociations("notes", "contacts", noteIds, token, deadline) : new Map<string, string[]>(),
  ]);
  for (const it of items) {
    const id = it.id.slice(1);
    it.cos = (it.kind === "llamada" ? ccos : ncos).get(id) ?? [];
    it.cts = (it.kind === "llamada" ? ccts : ncts).get(id) ?? [];
  }

  if (!token) {
    await db.from("allo_response_cache").upsert({ cache_key: cacheKey(since), response: items, expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() });
  }
  return items;
}
