import type { SupabaseClient } from "@supabase/supabase-js";

// Dashboard de prospección (nueva forma de trabajar, oct-2026):
//   BullsEye recomienda empresas (client_wishlist origin = bullseye, status
//   proposed) → el cliente las aprueba o rechaza → al aprobarlas van a su
//   Lemlist y el cron busca contactos automáticamente (contacts_status
//   done / few_contacts) → las con pocos contactos pasan a Búsqueda manual,
//   donde el prospector suma contactos a mano (wishlist_contacts origin =
//   manual).
// Con cliente: KPIs del período + evolución mensual + pendientes.
// Sin cliente ("Todos"): una tarjeta por cliente con su estado.

// Empresas aprobadas (por el cliente o pedidas por él) que se prospectan
export const ACTIVE_STATUSES = ["new", "in_lemlist", "in_progress", "contacts_found"];
const MANUAL_OPEN = ["pending", "in_progress"];

type WishlistRow = {
  id: string;
  client_id: string;
  company_name: string;
  origin: string;
  status: string;
  lemlist_status: string | null;
  lemlist_error: string | null;
  contacts_status: string;
  contacts_found: number;
  contacts_searched_at: string | null;
  client_decision_at: string | null;
  manual_status: string;
  created_at: string;
};

type ContactRow = {
  client_id: string;
  wishlist_id: string;
  origin: string;
  status: string;
  enrich_status: string;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export type ProspectingKpis = {
  recommended_ai: number;       // empresas que la IA dejó como recomendación (fit ≥ 60)
  proposed: number;             // propuestas enviadas al cliente en el período
  client_requested: number;     // pedidas directamente por el cliente en su portal
  approved: number;             // aprobadas por el cliente en el período
  rejected: number;             // rechazadas por el cliente en el período
  approval_rate: number | null; // aprobadas / (aprobadas + rechazadas)
  prospected: number;           // empresas con búsqueda automática terminada en el período
  prospected_ok: number;        // … con contactos suficientes
  prospected_few: number;       // … con pocos contactos (→ búsqueda manual)
  auto_contacts: number;        // contactos encontrados automáticamente en esas empresas
  avg_auto_per_company: number | null;
  manual_contacts: number;      // contactos sumados a mano en el período
  contacts_approved: number;    // contactos aprobados (auto + manual) creados en el período
  contacts_with_email: number;
  contacts_with_phone: number;
  // Estado actual (no depende del período)
  pending_approval: number;     // propuestas esperando respuesta del cliente
  pending_approval_oldest_days: number | null;
  pending_prospecting: number;  // aprobadas a la espera de la búsqueda automática
  lemlist_errors: number;       // aprobadas que no llegaron al Lemlist del cliente (no se prospectan)
  manual_queue: number;         // empresas con pocos contactos esperando búsqueda manual
  total_active: number;         // empresas aprobadas en prospección
};

export type MonthPoint = {
  month: string; // YYYY-MM
  proposed: number;
  approved: number;
  prospected: number;
  auto_contacts: number;
  manual_contacts: number;
};

export type LemlistErrorItem = { id: string; company_name: string; error: string | null };

export type ClientDashboard = {
  mode: "client";
  kpis: ProspectingKpis;
  months: MonthPoint[];
  lemlist_errors: LemlistErrorItem[];
  migration_missing: boolean;
};

export type ClientCard = { client_id: string; client_name: string; kpis: ProspectingKpis; last_activity: string | null };

export type AllClientsDashboard = {
  mode: "all";
  totals: ProspectingKpis;
  clients: ClientCard[];
  migration_missing: boolean;
};

// ── Lectura (paginada: Supabase corta en 1.000 filas) ───────────────────

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const WL_BASE = "id, client_id, company_name, origin, status, lemlist_status, lemlist_error, contacts_status, contacts_found, contacts_searched_at, client_decision_at, created_at";
const CT_BASE = "client_id, wishlist_id, status, enrich_status, email, phone, created_at";

// Las columnas manual_status / origin llegan con la migración
// 20261030_prospeccion_v3; sin ella se leen las demás y se asume
// "pendiente" / "automático".
async function loadWishlist(db: SupabaseClient, clientId: string | null): Promise<{ rows: WishlistRow[]; migrationMissing: boolean }> {
  const run = (cols: string) =>
    fetchAll<WishlistRow>((from, to) => {
      let q = db.from("client_wishlist").select(cols).order("created_at", { ascending: true }).range(from, to);
      if (clientId) q = q.eq("client_id", clientId);
      return q as unknown as PromiseLike<{ data: WishlistRow[] | null; error: { message: string } | null }>;
    });
  try {
    return { rows: await run(`${WL_BASE}, manual_status`), migrationMissing: false };
  } catch (err) {
    if (!/manual_status/.test(String(err))) throw err;
    const rows = await run(WL_BASE);
    return { rows: rows.map((r) => ({ ...r, manual_status: "pending" })), migrationMissing: true };
  }
}

async function loadContacts(db: SupabaseClient, clientId: string | null, since: string): Promise<{ rows: ContactRow[]; migrationMissing: boolean }> {
  const run = (cols: string) =>
    fetchAll<ContactRow>((from, to) => {
      let q = db.from("wishlist_contacts").select(cols).gte("created_at", since).order("created_at", { ascending: true }).range(from, to);
      if (clientId) q = q.eq("client_id", clientId);
      return q as unknown as PromiseLike<{ data: ContactRow[] | null; error: { message: string } | null }>;
    });
  try {
    return { rows: await run(`${CT_BASE}, origin`), migrationMissing: false };
  } catch (err) {
    if (!/origin/.test(String(err))) throw err;
    const rows = await run(CT_BASE);
    return { rows: rows.map((r) => ({ ...r, origin: "auto" })), migrationMissing: true };
  }
}

async function loadRecommendations(db: SupabaseClient, clientId: string | null, since: string): Promise<{ client_id: string; created_at: string }[]> {
  return fetchAll((from, to) => {
    let q = db.from("client_recommendations").select("client_id, created_at").gte("created_at", since).range(from, to);
    if (clientId) q = q.eq("client_id", clientId);
    return q as unknown as PromiseLike<{ data: { client_id: string; created_at: string }[] | null; error: { message: string } | null }>;
  });
}

// ── Cálculo ──────────────────────────────────────────────────────────────

const inRange = (iso: string | null, start: number, end: number) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start && t <= end;
};

// Empresa ya prospectada automáticamente
const isProspected = (w: WishlistRow) => w.contacts_status === "done" || w.contacts_status === "few_contacts";
// Aprobada por el cliente (o pedida por él): todo lo que no es propuesta / rechazada / descartada
const isApprovedNow = (w: WishlistRow) => ACTIVE_STATUSES.includes(w.status);

// Empresas que necesitan búsqueda manual: la búsqueda automática encontró
// menos de FEW_CONTACTS contactos fit (contacts_status = few_contacts) y el
// prospector todavía no la cerró.
export function needsManualSearch(w: Pick<WishlistRow, "status" | "contacts_status" | "manual_status">): boolean {
  return ACTIVE_STATUSES.includes(w.status) && w.contacts_status === "few_contacts" && MANUAL_OPEN.includes(w.manual_status);
}

function computeKpis(
  wl: WishlistRow[],
  contacts: ContactRow[],
  recos: { created_at: string }[],
  start: number,
  end: number,
  now: number
): ProspectingKpis {
  const prospected = wl.filter((w) => isProspected(w) && inRange(w.contacts_searched_at, start, end));
  const autoContacts = prospected.reduce((s, w) => s + (w.contacts_found ?? 0), 0);
  const approved = wl.filter((w) => w.origin === "bullseye" && isApprovedNow(w) && inRange(w.client_decision_at, start, end)).length;
  const rejected = wl.filter((w) => w.status === "rejected_by_client" && inRange(w.client_decision_at, start, end)).length;
  const periodContacts = contacts.filter((c) => inRange(c.created_at, start, end));
  const approvedContacts = periodContacts.filter((c) => c.status === "approved");
  const pendingApproval = wl.filter((w) => w.status === "proposed");
  const oldest = pendingApproval.reduce<number | null>((min, w) => {
    const t = new Date(w.created_at).getTime();
    return min == null || t < min ? t : min;
  }, null);

  return {
    recommended_ai: recos.filter((r) => inRange(r.created_at, start, end)).length,
    proposed: wl.filter((w) => w.origin === "bullseye" && inRange(w.created_at, start, end)).length,
    client_requested: wl.filter((w) => w.origin === "client" && inRange(w.created_at, start, end)).length,
    approved,
    rejected,
    approval_rate: approved + rejected > 0 ? (approved / (approved + rejected)) * 100 : null,
    prospected: prospected.length,
    prospected_ok: prospected.filter((w) => w.contacts_status === "done").length,
    prospected_few: prospected.filter((w) => w.contacts_status === "few_contacts").length,
    auto_contacts: autoContacts,
    avg_auto_per_company: prospected.length ? autoContacts / prospected.length : null,
    manual_contacts: periodContacts.filter((c) => c.origin === "manual").length,
    contacts_approved: approvedContacts.length,
    contacts_with_email: approvedContacts.filter((c) => !!c.email).length,
    contacts_with_phone: approvedContacts.filter((c) => !!c.phone).length,
    pending_approval: pendingApproval.length,
    pending_approval_oldest_days: oldest == null ? null : Math.floor((now - oldest) / 86_400_000),
    pending_prospecting: wl.filter((w) => isApprovedNow(w) && w.contacts_status === "pending" && w.lemlist_status === "ok").length,
    lemlist_errors: wl.filter((w) => isApprovedNow(w) && (w.lemlist_status === "error" || w.lemlist_status === "sin_key")).length,
    manual_queue: wl.filter(needsManualSearch).length,
    total_active: wl.filter(isApprovedNow).length,
  };
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function lastMonths(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// ── Entradas públicas ────────────────────────────────────────────────────

export async function computeClientDashboard(db: SupabaseClient, clientId: string, start: Date, end: Date): Promise<ClientDashboard> {
  const now = new Date();
  const months = lastMonths(6, now);
  // Los contactos se leen desde el más antiguo entre el período y la evolución (6 meses)
  const since = new Date(Math.min(start.getTime(), new Date(`${months[0]}-01T00:00:00Z`).getTime())).toISOString();
  const [{ rows: wl, migrationMissing: m1 }, { rows: contacts, migrationMissing: m2 }, recos] = await Promise.all([
    loadWishlist(db, clientId),
    loadContacts(db, clientId, since),
    loadRecommendations(db, clientId, start.toISOString()),
  ]);

  const series = new Map<string, MonthPoint>(months.map((m) => [m, { month: m, proposed: 0, approved: 0, prospected: 0, auto_contacts: 0, manual_contacts: 0 }]));
  for (const w of wl) {
    if (w.origin === "bullseye") {
      const p = series.get(monthKey(w.created_at));
      if (p) p.proposed++;
    }
    if (w.origin === "bullseye" && isApprovedNow(w) && w.client_decision_at) {
      const p = series.get(monthKey(w.client_decision_at));
      if (p) p.approved++;
    }
    if (isProspected(w) && w.contacts_searched_at) {
      const p = series.get(monthKey(w.contacts_searched_at));
      if (p) {
        p.prospected++;
        p.auto_contacts += w.contacts_found ?? 0;
      }
    }
  }
  for (const c of contacts) {
    if (c.origin !== "manual") continue;
    const p = series.get(monthKey(c.created_at));
    if (p) p.manual_contacts++;
  }

  return {
    mode: "client",
    kpis: computeKpis(wl, contacts, recos, start.getTime(), end.getTime(), now.getTime()),
    months: [...series.values()],
    lemlist_errors: wl
      .filter((w) => isApprovedNow(w) && (w.lemlist_status === "error" || w.lemlist_status === "sin_key"))
      .slice(0, 50)
      .map((w) => ({ id: w.id, company_name: w.company_name, error: w.lemlist_error })),
    migration_missing: m1 || m2,
  };
}

export async function computeAllClientsDashboard(db: SupabaseClient, start: Date, end: Date): Promise<AllClientsDashboard> {
  const now = new Date();
  const [{ data: clients }, { rows: wl, migrationMissing: m1 }, { rows: contacts, migrationMissing: m2 }, recos] = await Promise.all([
    db.from("clients").select("id, name, is_active").order("name"),
    loadWishlist(db, null),
    loadContacts(db, null, start.toISOString()),
    loadRecommendations(db, null, start.toISOString()),
  ]);

  const group = <T extends { client_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const arr = m.get(r.client_id);
      if (arr) arr.push(r);
      else m.set(r.client_id, [r]);
    }
    return m;
  };
  const wlBy = group(wl);
  const ctBy = group(contacts);
  const recoBy = group(recos);

  const cards: ClientCard[] = [];
  for (const c of clients ?? []) {
    const cw = wlBy.get(c.id) ?? [];
    // Solo clientes que usan la wishlist (o activos con recomendaciones)
    if (!cw.length && !recoBy.get(c.id)?.length) continue;
    const kpis = computeKpis(cw, ctBy.get(c.id) ?? [], recoBy.get(c.id) ?? [], start.getTime(), end.getTime(), now.getTime());
    const last = cw.reduce<string | null>((max, w) => {
      const d = [w.created_at, w.client_decision_at, w.contacts_searched_at].filter(Boolean).sort().pop() ?? null;
      return d && (!max || d > max) ? d : max;
    }, null);
    cards.push({ client_id: c.id, client_name: c.name, kpis, last_activity: last });
  }
  // Primero los que tienen algo que hacer (pendientes) y más actividad
  cards.sort(
    (a, b) =>
      b.kpis.pending_approval + b.kpis.manual_queue + b.kpis.lemlist_errors - (a.kpis.pending_approval + a.kpis.manual_queue + a.kpis.lemlist_errors) ||
      b.kpis.prospected - a.kpis.prospected ||
      a.client_name.localeCompare(b.client_name)
  );

  return {
    mode: "all",
    totals: computeKpis(wl, contacts, recos, start.getTime(), end.getTime(), now.getTime()),
    clients: cards,
    migration_missing: m1 || m2,
  };
}
