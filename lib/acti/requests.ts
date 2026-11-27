import type { SupabaseClient } from "@supabase/supabase-js";
import { listPoolProperties, normalizeDomain } from "@/lib/hubspotPool";
import { markRecommendation, poolCompanyLemlistFields, poolCompanyToCard } from "@/lib/wishlist";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";
import { autoLotId, type LotTag } from "@/lib/wishlistLotes";
import { normalizeName } from "@/lib/syncMeetings";
import { decodeRef } from "@/lib/unifiedSearch";
import { loadQuota, currentMonth } from "@/lib/acti/quota";
import { demandByDomain } from "@/lib/acti/reco";
import type { ActiSession } from "@/lib/acti/server";

// ACTI · Mis solicitudes. "Quiero reunirme con ellos" crea una solicitud en la
// cola ACTI (acti_requests). Un proceso la libera al flujo REAL de prospección
// (client_wishlist, como si el cliente la hubiera subido) por prioridad de
// plan, sin cambiar el orden de la cola de los demás clientes. Desde ahí el
// avance que ve el socio se deriva del flujo de siempre (wishlist, Contactos
// IA, reuniones): no hay un estado paralelo.

export class ActiRequestError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export type Personas = { areas: string[]; levels: string[]; titles: string };

const cleanList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 12) : [];

export function sanitizePersonas(raw: unknown): Personas {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { areas: cleanList(r.areas), levels: cleanList(r.levels), titles: typeof r.titles === "string" ? r.titles.trim().slice(0, 300) : "" };
}

type Origin = "busqueda" | "recomendada" | "guardada" | "manual" | "completada_ia";

export async function createRequest(
  db: SupabaseClient,
  s: ActiSession,
  input: { ref?: unknown; manual?: { name?: unknown; website?: unknown }; personas?: unknown; comment?: unknown; origin?: unknown; fit?: unknown }
) {
  const clientId = s.user.clientId;
  const quota = await loadQuota(db, clientId, s.member, s.plan, s.config.params);
  if (quota.blocked) throw new ActiRequestError(quota.reason ?? "No puedes pedir más empresas por ahora.");

  let hsId: string | null = null;
  let name: string;
  let domain: string | null;
  const id = decodeRef(input.ref);
  if (id) {
    if (id.source !== "hubspot") throw new ActiRequestError("Empresa inválida", 400);
    const { data: row } = await db.from("hubspot_company_pool").select("hs_id, name, domain").eq("hs_id", id.key).maybeSingle();
    if (!row) throw new ActiRequestError("Empresa no encontrada", 404);
    hsId = row.hs_id as string;
    name = row.name as string;
    domain = (row.domain as string | null) ?? null;
  } else {
    name = typeof input.manual?.name === "string" ? input.manual.name.trim().slice(0, 200) : "";
    domain = normalizeDomain(typeof input.manual?.website === "string" ? input.manual.website.slice(0, 300) : null);
    if (!name) throw new ActiRequestError("Indica el nombre de la empresa", 400);
    if (!domain) throw new ActiRequestError("Indica el sitio web de la empresa", 400);
  }

  // Freemium no puede pedir en el mes una empresa que ya pidió un socio pagado
  if (s.plan.priority === 0 && domain) {
    const demand = (await demandByDomain(db, clientId, [domain])).get(domain);
    if (demand?.paidOthers) {
      throw new ActiRequestError("Otro socio de la red ya está trabajando esta empresa este mes. Elige otra o pasa a un plan pagado.");
    }
  }

  const origin: Origin = (["busqueda", "recomendada", "guardada", "manual", "completada_ia"] as const).includes(input.origin as Origin)
    ? (input.origin as Origin)
    : id ? "busqueda" : "manual";
  const { data, error } = await db
    .from("acti_requests")
    .insert({
      client_id: clientId,
      hs_id: hsId,
      company_name: name,
      domain,
      month: currentMonth(),
      personas: sanitizePersonas(input.personas),
      comment: typeof input.comment === "string" ? input.comment.trim().slice(0, 500) || null : null,
      origin,
      fit_score: typeof input.fit === "number" ? Math.max(0, Math.min(100, Math.round(input.fit))) : null,
      priority: s.plan.priority,
      requested_by: s.user.email,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") throw new ActiRequestError("Ya pediste esta empresa.");
    throw new Error(error.message);
  }
  // Si venía de las recomendaciones IA, ya no se muestra como pendiente
  if (hsId) await markRecommendation(db, clientId, "hubspot", hsId, "added");
  return { id: data.id as string };
}

export async function cancelRequest(db: SupabaseClient, clientId: string, requestId: string) {
  const { data, error } = await db
    .from("acti_requests")
    .update({ status: "cancelada" })
    .eq("id", requestId)
    .eq("client_id", clientId)
    .eq("status", "en_cola")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ActiRequestError("Solo puedes cancelar solicitudes que siguen en cola.");
}

// ── Liberación a la prospección (cron /api/cron/acti-cola) ───────────────

export async function releaseQueue(db: SupabaseClient, max: number) {
  const { data } = await db
    .from("acti_requests")
    .select("id, client_id, hs_id, company_name, domain, personas, comment, origin, fit_score, priority, requested_by, created_at")
    .eq("status", "en_cola")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(max);
  const queue = (data ?? []) as {
    id: string; client_id: string; hs_id: string | null; company_name: string; domain: string | null; personas: Personas;
    comment: string | null; origin: Origin; fit_score: number | null; priority: number; requested_by: string | null; created_at: string;
  }[];
  if (!queue.length) return { released: 0, errors: 0 };
  const props = await listPoolProperties(db);
  let released = 0;
  let errors = 0;

  for (const r of queue) {
    try {
      let facts: { label: string; value: string }[] = [];
      let lemlistFields = {};
      let linkedin: string | null = null;
      if (r.hs_id) {
        const { data: row } = await db.from("hubspot_company_pool").select("hs_id, name, domain, properties").eq("hs_id", r.hs_id).maybeSingle();
        if (row) {
          const card = poolCompanyToCard(row, props);
          facts = card.facts;
          linkedin = card.linkedin_url;
          lemlistFields = poolCompanyLemlistFields(row, props);
        }
      }
      const at = new Date().toISOString();
      const batch: LotTag = { id: autoLotId("cliente", at, r.requested_by), kind: "cliente", name: "ACTI", by: r.requested_by, at };
      const ins = await db
        .from("client_wishlist")
        .insert({
          client_id: r.client_id,
          company_name: r.company_name,
          domain: r.domain,
          linkedin_url: linkedin,
          source: r.hs_id ? "hubspot" : "manual",
          source_ref: r.hs_id,
          mode: r.origin === "recomendada" || r.origin === "completada_ia" ? "ai" : "manual",
          fit_score: r.fit_score,
          snapshot: {
            facts,
            lemlist_fields: lemlistFields,
            batch,
            ...(r.comment ? { client_comment: r.comment } : {}),
            acti: { request_id: r.id, personas: r.personas, priority: r.priority },
          },
          status: "new",
          origin: "client",
          lemlist_status: "pendiente",
          requested_by_email: r.requested_by,
        })
        .select("id")
        .single();

      let wishlistId: string | null = ins.data?.id ?? null;
      if (ins.error) {
        if (ins.error.code !== "23505") throw new Error(ins.error.message);
        // Ya estaba en la wishlist del socio (otro canal): se enlaza a esa
        const q = db.from("client_wishlist").select("id").eq("client_id", r.client_id).limit(1);
        const { data: existing } = r.domain ? await q.eq("domain", r.domain) : await q.ilike("company_name", r.company_name);
        wishlistId = existing?.[0]?.id ?? null;
      }
      await db.from("acti_requests").update({ status: "liberada", wishlist_id: wishlistId, released_at: at, release_error: null }).eq("id", r.id);
      // Envío a Lemlist (mismo paso que el portal). Si falla, queda en la
      // wishlist y prospección lo ve / reintenta en el Dashboard.
      if (ins.data?.id) await pushWishlistItemToLemlist(db, ins.data.id).catch(() => null);
      released++;
    } catch (e) {
      errors++;
      await db.from("acti_requests").update({ release_error: (e as Error).message.slice(0, 300) }).eq("id", r.id);
    }
  }
  return { released, errors };
}

// ── Tablero del socio ────────────────────────────────────────────────────

export type Stage = "cola" | "research" | "contacto" | "reunion" | "sin_respuesta";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "cola", label: "En cola" },
  { key: "research", label: "En research" },
  { key: "contacto", label: "En contacto" },
  { key: "reunion", label: "Reunión agendada" },
  { key: "sin_respuesta", label: "Sin respuesta" },
];

export type BoardItem = {
  id: string;
  company: string;
  domain: string | null;
  stage: Stage;
  detail: string;
  personas: Personas;
  requestedAt: string;
  canCancel: boolean;
  meetingDate: string | null;
};

type Wl = { id: string; status: string; contacts_status: string | null; contacts_found: number | null };

// Etapa a partir del flujo real. "Sin respuesta" hoy = descartada en
// prospección o sin contactos; el criterio de 6 intentos en 10 días hábiles
// se conecta con el estado de cada cuenta en el portal (pendiente con Ingri).
export function stageOf(req: { status: string }, wl: Wl | null, approvedContacts: number, meetingDate: string | null): { stage: Stage; detail: string } {
  if (meetingDate) return { stage: "reunion", detail: "Reunión agendada" };
  if (req.status === "en_cola") return { stage: "cola", detail: "Esperando turno en la prospección" };
  if (!wl) return { stage: "research", detail: "En revisión del equipo" };
  if (wl.status === "discarded" || wl.status === "rejected_by_client") return { stage: "sin_respuesta", detail: "Descartada en la prospección" };
  if (approvedContacts > 0) return { stage: "contacto", detail: `${approvedContacts} ${approvedContacts === 1 ? "perfil" : "perfiles"} en contacto` };
  if (wl.contacts_status === "few_contacts") return { stage: "research", detail: "Buscando más perfiles" };
  if (wl.contacts_status === "done") return { stage: "research", detail: "Perfiles en revisión" };
  return { stage: "research", detail: "Buscando los perfiles que pediste" };
}

export async function loadBoard(db: SupabaseClient, clientId: string): Promise<BoardItem[]> {
  const { data } = await db
    .from("acti_requests")
    .select("id, company_name, domain, personas, status, wishlist_id, created_at")
    .eq("client_id", clientId)
    .neq("status", "cancelada")
    .order("created_at", { ascending: false })
    .limit(500);
  const reqs = (data ?? []) as { id: string; company_name: string; domain: string | null; personas: Personas; status: string; wishlist_id: string | null; created_at: string }[];
  const wlIds = reqs.map((r) => r.wishlist_id).filter((x): x is string => !!x);

  const [{ data: wls }, { data: contacts }, { data: meetings }] = await Promise.all([
    wlIds.length ? db.from("client_wishlist").select("id, status, contacts_status, contacts_found").in("id", wlIds) : Promise.resolve({ data: [] }),
    wlIds.length ? db.from("wishlist_contacts").select("wishlist_id").in("wishlist_id", wlIds).eq("status", "approved") : Promise.resolve({ data: [] }),
    db.from("meetings").select("empresa, correo, fecha_reunion, realizado").eq("client_id", clientId).gte("fecha_reunion", reqs.at(-1)?.created_at.slice(0, 10) ?? "2000-01-01"),
  ]);
  const wlById = new Map(((wls ?? []) as Wl[]).map((w) => [w.id, w]));
  const approved = new Map<string, number>();
  for (const c of (contacts ?? []) as { wishlist_id: string }[]) approved.set(c.wishlist_id, (approved.get(c.wishlist_id) ?? 0) + 1);
  // Reunión de la planilla por nombre de empresa normalizado o dominio del correo
  const mByName = new Map<string, string>();
  const mByDomain = new Map<string, string>();
  for (const m of (meetings ?? []) as { empresa: string; correo: string | null; fecha_reunion: string | null; realizado: string | null }[]) {
    if (!m.fecha_reunion || m.realizado === "No") continue;
    mByName.set(normalizeName(m.empresa), m.fecha_reunion);
    const d = m.correo?.split("@")[1]?.toLowerCase();
    if (d) mByDomain.set(d, m.fecha_reunion);
  }

  return reqs.map((r) => {
    const meeting = (r.domain && mByDomain.get(r.domain)) || mByName.get(normalizeName(r.company_name)) || null;
    const wl = r.wishlist_id ? wlById.get(r.wishlist_id) ?? null : null;
    const { stage, detail } = stageOf(r, wl, (r.wishlist_id && approved.get(r.wishlist_id)) || 0, meeting);
    return {
      id: r.id,
      company: r.company_name,
      domain: r.domain,
      stage,
      detail,
      personas: r.personas ?? { areas: [], levels: [], titles: "" },
      requestedAt: r.created_at,
      canCancel: r.status === "en_cola",
      meetingDate: meeting,
    };
  });
}
