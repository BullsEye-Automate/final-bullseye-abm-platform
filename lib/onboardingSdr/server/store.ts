// Guardado del Onboarding SDR: un registro por SDR (tabla sdr_onboardings,
// migración supabase/20261113_sdr_onboarding_migration.sql). Cada cambio de
// la página llega como una operación (marcar hito, confirmar, cerrar etapa,
// asignar clientes, fecha de ingreso), se valida con las reglas del plan y
// el rol de quien la hace, y queda en sdr_onboarding_log.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCoverage } from "@/lib/academiaSdr/server/source";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { readMaster } from "@/lib/celulasSdr/sheets";
import {
  STAGES,
  canConfirm,
  canMark,
  hitoStatus,
  hitosFor,
  summarize,
  type AcademyScore,
  type CatalogClient,
  type OnboardingState,
  type Role,
} from "../plan";

export type OnboardingRow = {
  id: string;
  sdr_email: string;
  sdr_name: string | null;
  leader_name: string | null;
  ingreso: string | null;
  clientes: string[];
  hechos: OnboardingState["hechos"];
  valida: OnboardingState["valida"];
  etapas: OnboardingState["etapas"];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const COLS = "id, sdr_email, sdr_name, leader_name, ingreso, clientes, hechos, valida, etapas, is_active, created_by, created_at, updated_at";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const stateOf = (r: OnboardingRow): OnboardingState => ({
  ingreso: r.ingreso,
  clientes: r.clientes ?? [],
  hechos: r.hechos ?? {},
  valida: r.valida ?? {},
  etapas: r.etapas ?? {},
});

export async function getByEmail(db: SupabaseClient, email: string): Promise<OnboardingRow | null> {
  const { data, error } = await db.from("sdr_onboardings").select(COLS).eq("sdr_email", email.toLowerCase()).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OnboardingRow | null) ?? null;
}

export async function getById(db: SupabaseClient, id: string): Promise<OnboardingRow | null> {
  const { data, error } = await db.from("sdr_onboardings").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OnboardingRow | null) ?? null;
}

export async function createOnboarding(
  db: SupabaseClient,
  opts: { email: string; name?: string | null; leader?: string | null; ingreso?: string | null; clientes?: string[]; by: string }
): Promise<OnboardingRow> {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Correo inválido");
  const existing = await getByEmail(db, email);
  if (existing) {
    // Reactivar uno archivado en vez de duplicarlo.
    if (!existing.is_active) await db.from("sdr_onboardings").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return { ...existing, is_active: true };
  }
  const who = await identifySdr(email);
  const ingreso = opts.ingreso && DATE_RE.test(opts.ingreso) ? opts.ingreso : null;
  const { data, error } = await db
    .from("sdr_onboardings")
    .insert({
      sdr_email: email,
      sdr_name: who.sdrName ?? (opts.name?.trim() || null),
      leader_name: opts.leader?.trim() || who.leaderName,
      ingreso,
      clientes: (opts.clientes ?? []).slice(0, 2),
      created_by: opts.by,
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as OnboardingRow;
}

// Datos del SDR que corrige la líder / RRHH / administradora desde la tabla
// del Equipo: nombre, líder directo y fecha de ingreso.
export async function updateMeta(
  db: SupabaseClient,
  id: string,
  meta: { name?: string | null; leader?: string | null; ingreso?: string | null },
  actor: string,
  role: string
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (meta.name !== undefined) patch.sdr_name = String(meta.name ?? "").trim() || null;
  if (meta.leader !== undefined) patch.leader_name = String(meta.leader ?? "").trim() || null;
  if (meta.ingreso !== undefined) {
    if (meta.ingreso && !DATE_RE.test(meta.ingreso)) throw new OpError("Fecha inválida");
    patch.ingreso = meta.ingreso || null;
  }
  const { error } = await db.from("sdr_onboardings").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await db.from("sdr_onboarding_log").insert({ onboarding_id: id, actor_email: actor, actor_role: role, op: { kind: "meta", ...meta } });
}

// Líderes de célula de la Maestra IA (para elegir el líder directo).
let leadersCache: { at: number; list: string[] } | null = null;
export async function listLeaders(): Promise<string[]> {
  if (leadersCache && Date.now() - leadersCache.at < 10 * 60_000) return leadersCache.list;
  const id = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!id) return [];
  try {
    const m = await readMaster(id, []);
    const list = Array.from(new Set(m.cells.map((c) => c.leader).filter(Boolean))).sort();
    leadersCache = { at: Date.now(), list };
    return list;
  } catch (e) {
    console.warn("[onboarding-sdr] No se pudieron leer las líderes de la Maestra:", e);
    return [];
  }
}

export async function setActive(db: SupabaseClient, id: string, active: boolean): Promise<void> {
  const { error } = await db.from("sdr_onboardings").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Clientes y entrenamientos ───────────────────────────────────────────

// Clientes activos para asignar: los que tienen Entrenamiento cliente se
// pueden elegir; los demás quedan marcados `off` (si ya estaban asignados se
// siguen mostrando).
export async function loadCatalog(db: SupabaseClient, appUrl: string): Promise<(CatalogClient & { off?: boolean })[]> {
  const cov = await loadCoverage(db);
  return cov.map((c) => ({
    id: c.id,
    n: c.name,
    u: c.origin ? `${appUrl}/sdr/entrenamiento?client_id=${c.id}` : null,
    ...(c.origin ? {} : { off: true }),
  }));
}

// Avance en el Entrenamiento cliente (vueltas y mejor quiz) por correo y
// cliente, desde sdr_academy_progress. quiz = puntaje llevado a escala de 10.
export async function loadAcademies(db: SupabaseClient, emails: string[]): Promise<Map<string, Record<string, AcademyScore>>> {
  const out = new Map<string, Record<string, AcademyScore>>();
  if (!emails.length) return out;
  const { data } = await db
    .from("sdr_academy_progress")
    .select("user_email, client_id, completed, quiz_score, quiz_total")
    .in("user_email", emails);
  for (const r of (data ?? []) as { user_email: string; client_id: string; completed: boolean; quiz_score: number | null; quiz_total: number | null }[]) {
    const byClient = out.get(r.user_email) ?? {};
    const a = byClient[r.client_id] ?? { quiz: null, score: null, total: null, laps: 0 };
    if (r.completed) a.laps++;
    if (r.quiz_score != null && r.quiz_total) {
      const q = Math.round((r.quiz_score / r.quiz_total) * 100) / 10;
      if (a.quiz == null || q > a.quiz) Object.assign(a, { quiz: q, score: r.quiz_score, total: r.quiz_total });
    }
    byClient[r.client_id] = a;
    out.set(r.user_email, byClient);
  }
  return out;
}

// ── Cambios ─────────────────────────────────────────────────────────────

export type Op =
  | { kind: "hecho"; id: string; on: boolean }
  | { kind: "valida"; id: string; on: boolean }
  | { kind: "etapa"; i: number; on: boolean }
  | { kind: "clientes"; ids: string[] }
  | { kind: "ingreso"; date: string };

export class OpError extends Error {}

function apply(
  s: OnboardingState,
  op: Op,
  role: Role,
  actor: string,
  ctx: { names: Map<string, string>; validClients: Set<string>; academias: Record<string, AcademyScore> }
): OnboardingState {
  const next: OnboardingState = { ...s, hechos: { ...s.hechos }, valida: { ...s.valida }, etapas: { ...s.etapas } };
  const stamp = { at: new Date().toISOString(), by: role, email: actor };
  const hs = hitosFor(s.clientes.map((id) => ({ id, n: ctx.names.get(id) ?? id })));
  const find = (id: string) => {
    const h = hs.find((x) => x.id === id);
    if (!h) throw new OpError("Hito desconocido");
    return h;
  };
  switch (op.kind) {
    case "hecho": {
      const h = find(op.id);
      if (!canMark(h, role)) throw new OpError(h.rh ? "Este hito lo confirma RRHH." : h.g === "pit" ? "Este hito lo marca un editor." : "Este hito lo marca la líder de célula.");
      if (op.on) next.hechos[h.id] = stamp;
      else {
        delete next.hechos[h.id];
        delete next.valida[h.id];
        delete next.etapas[String(h.e)];
      }
      return next;
    }
    case "valida": {
      const h = find(op.id);
      if (!canConfirm(h, role)) throw new OpError("Tu rol no confirma este hito.");
      if (op.on) {
        if (!next.hechos[h.id]) throw new OpError("El hito aún no está marcado.");
        next.valida[h.id] = stamp;
      } else {
        delete next.valida[h.id];
        delete next.etapas[String(h.e)];
      }
      return next;
    }
    case "etapa": {
      const i = Math.trunc(op.i);
      if (!STAGES[i]?.conf) throw new OpError("Etapa inválida");
      if (role !== "lider") throw new OpError("La etapa la confirma la líder de célula.");
      if (op.on) {
        const pending = hs.filter((h) => h.e === i && hitoStatus(next, h, ctx.academias) !== "ok");
        if (pending.length) throw new OpError(`Faltan ${pending.length} hitos de esta etapa.`);
        next.etapas[String(i)] = stamp;
      } else delete next.etapas[String(i)];
      return next;
    }
    case "clientes": {
      if (role === "sdr") throw new OpError("Los clientes los asigna la líder.");
      const ids = Array.from(new Set((op.ids ?? []).map(String))).slice(0, 2);
      if (ids.some((id) => !ctx.validClients.has(id))) throw new OpError("Cliente inválido");
      next.clientes = ids;
      return next;
    }
    case "ingreso": {
      if (!DATE_RE.test(op.date ?? "")) throw new OpError("Fecha inválida");
      next.ingreso = op.date;
      return next;
    }
  }
  throw new OpError("Operación inválida");
}

export async function applyOp(
  db: SupabaseClient,
  id: string,
  op: Op,
  role: Role,
  actor: string,
  appUrl: string
): Promise<OnboardingRow> {
  const catalog = await loadCatalog(db, appUrl);
  const names = new Map(catalog.map((c) => [c.id, c.n]));
  const validClients = new Set(catalog.map((c) => c.id));
  // Lectura → cambio → escritura condicionada a que nadie haya guardado entre
  // medio (si pasó, se reintenta sobre lo nuevo).
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await getById(db, id);
    if (!row) throw new OpError("Onboarding no encontrado");
    for (const c of row.clientes ?? []) validClients.add(c); // un cliente ya asignado sigue siendo válido
    const academias = (await loadAcademies(db, [row.sdr_email])).get(row.sdr_email) ?? {};
    const next = apply(stateOf(row), op, role, actor, { names, validClients, academias });
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("sdr_onboardings")
      .update({ ingreso: next.ingreso, clientes: next.clientes, hechos: next.hechos, valida: next.valida, etapas: next.etapas, updated_at: now })
      .eq("id", id)
      .eq("updated_at", row.updated_at)
      .select(COLS);
    if (error) throw new Error(error.message);
    if (data && data.length) {
      await db.from("sdr_onboarding_log").insert({ onboarding_id: id, actor_email: actor, actor_role: role, op });
      return data[0] as OnboardingRow;
    }
  }
  throw new Error("Otra persona estaba guardando al mismo tiempo. Intenta de nuevo.");
}

// ── Equipo ──────────────────────────────────────────────────────────────

export type TeamRow = {
  id: string;
  email: string;
  name: string | null;
  leader: string | null;
  ingreso: string | null;
  clientes: string[];
  active: boolean;
  updatedAt: string;
} & ReturnType<typeof summarize>;

export async function loadTeam(db: SupabaseClient, catalog: CatalogClient[], includeArchived: boolean): Promise<TeamRow[]> {
  let q = db.from("sdr_onboardings").select(COLS).order("ingreso", { ascending: false, nullsFirst: false });
  if (!includeArchived) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as OnboardingRow[];
  const acad = await loadAcademies(db, rows.map((r) => r.sdr_email));
  const names = new Map(catalog.map((c) => [c.id, c.n]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows.map((r) => {
    const cl = (r.clientes ?? []).map((id) => ({ id, n: names.get(id) ?? id }));
    return {
      id: r.id,
      email: r.sdr_email,
      name: r.sdr_name,
      leader: r.leader_name,
      ingreso: r.ingreso,
      clientes: cl.map((c) => c.n),
      active: r.is_active,
      updatedAt: r.updated_at,
      ...summarize(stateOf(r), cl, acad.get(r.sdr_email) ?? {}, today),
    };
  });
}
