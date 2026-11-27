import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase/server";
import { getPortalUser, PORTAL_ROLE, type PortalUser } from "@/lib/portalAuth";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  PLAN_IDS,
  STATUS_IDS,
  type ActiConfig,
  type ActiPlan,
  type ActiPlanId,
  type ActiStatus,
} from "@/lib/acti/plans";

// ACTI · capa de servidor. Lee y escribe SOLO tablas acti_*; para el resto
// (clientes, usuarios del portal, reuniones) llama a lo existente sin cambiarlo.

export type ActiMember = {
  client_id: string;
  plan: ActiPlanId;
  status: ActiStatus;
  joined_at: string;
  trial_start: string | null;
  trial_end: string | null;
  kam_email: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
};

const MEMBER_COLS = "client_id, plan, status, joined_at, trial_start, trial_end, kam_email, notes, updated_by, updated_at";

// La tabla puede no existir todavía (migración sin correr): se trata como
// "sin socios ACTI" para que nada del portal se caiga.
const missingTable = (msg: string | undefined) => !!msg && /acti_|does not exist|relation/i.test(msg);

// ── Configuración ────────────────────────────────────────────────────────

export async function loadActiConfig(db: SupabaseClient = supabaseAdmin()): Promise<ActiConfig> {
  const { data, error } = await db.from("acti_config").select("value").eq("key", "plans").maybeSingle();
  if (error || !data) return normalizeConfig(DEFAULT_CONFIG);
  return normalizeConfig(data.value);
}

export async function saveActiConfig(raw: unknown, by: string): Promise<ActiConfig> {
  const db = supabaseAdmin();
  const value = normalizeConfig(raw);
  const { error } = await db
    .from("acti_config")
    .upsert({ key: "plans", value, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  await db.from("acti_config_log").insert({ key: "plans", value, changed_by: by });
  return value;
}

// ── Socios ───────────────────────────────────────────────────────────────

export async function getActiMember(clientId: string, db: SupabaseClient = supabaseAdmin()): Promise<ActiMember | null> {
  const { data, error } = await db.from("acti_members").select(MEMBER_COLS).eq("client_id", clientId).maybeSingle();
  if (error) {
    if (!missingTable(error.message)) console.error("acti: getActiMember", error.message);
    return null;
  }
  return (data as ActiMember | null) ?? null;
}

export async function listActiMembers(db: SupabaseClient = supabaseAdmin()): Promise<{ members: ActiMember[]; ready: boolean }> {
  const { data, error } = await db.from("acti_members").select(MEMBER_COLS);
  if (error) return { members: [], ready: !missingTable(error.message) };
  return { members: (data ?? []) as ActiMember[], ready: true };
}

export type MemberInput = {
  is_acti: boolean;
  plan?: string;
  status?: string;
  joined_at?: string | null;
  trial_start?: string | null;
  trial_end?: string | null;
  kam_email?: string | null;
  notes?: string | null;
};

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

// Marca / desmarca a un cliente como socio ACTI. Desmarcar borra la fila:
// el cliente vuelve a ver exactamente el portal de siempre.
export async function saveActiMember(clientId: string, input: MemberInput, by: string): Promise<ActiMember | null> {
  const db = supabaseAdmin();
  const before = await getActiMember(clientId, db);

  if (!input.is_acti) {
    if (before) {
      const { error } = await db.from("acti_members").delete().eq("client_id", clientId);
      if (error) throw new Error(error.message);
      await db.from("acti_members_log").insert({ client_id: clientId, change: { antes: before, despues: null }, changed_by: by });
    }
    await syncPortalUsersFlag(clientId, false);
    return null;
  }

  const plan = (PLAN_IDS as string[]).includes(input.plan ?? "") ? (input.plan as ActiPlanId) : before?.plan ?? "freemium";
  const status = (STATUS_IDS as string[]).includes(input.status ?? "")
    ? (input.status as ActiStatus)
    : before?.status ?? (plan === "freemium" ? "en_prueba" : "activo");
  const today = new Date().toISOString().slice(0, 10);
  const joined = isoDate(input.joined_at) ?? before?.joined_at ?? today;
  // Freemium: la prueba parte al activarse si no se indica otra fecha
  const trialStart = isoDate(input.trial_start) ?? before?.trial_start ?? (plan === "freemium" ? joined : null);

  const row = {
    client_id: clientId,
    plan,
    status,
    joined_at: joined,
    trial_start: trialStart,
    trial_end: isoDate(input.trial_end) ?? (input.trial_end === null ? null : before?.trial_end ?? null),
    kam_email: input.kam_email !== undefined ? (input.kam_email?.trim().toLowerCase() || null) : before?.kam_email ?? null,
    notes: input.notes !== undefined ? (input.notes?.trim().slice(0, 2000) || null) : before?.notes ?? null,
    updated_by: by,
  };
  const { data, error } = await db.from("acti_members").upsert(row, { onConflict: "client_id" }).select(MEMBER_COLS).single();
  if (error) throw new Error(error.message);
  await db.from("acti_members_log").insert({ client_id: clientId, change: { antes: before, despues: data }, changed_by: by });
  await syncPortalUsersFlag(clientId, true);
  return data as ActiMember;
}

// Marca app_metadata.acti en los usuarios del portal del cliente. El
// middleware la usa para llevarlos a /acti sin consultar la base en cada request.
export async function syncPortalUsersFlag(clientId: string, acti: boolean): Promise<void> {
  const db = supabaseAdmin();
  const { data: users } = await db.from("client_users").select("auth_user_id").eq("client_id", clientId);
  for (const u of users ?? []) {
    if (!u.auth_user_id) continue;
    await setUserActiFlag(u.auth_user_id as string, acti).catch((e) => console.error("acti: flag", e));
  }
}

export async function setUserActiFlag(authUserId: string, acti: boolean): Promise<void> {
  const db = supabaseAdmin();
  const { data: au } = await db.auth.admin.getUserById(authUserId);
  if (!au?.user) return;
  const meta = { ...(au.user.app_metadata ?? {}) } as Record<string, unknown>;
  if (meta.role !== PORTAL_ROLE) return; // nunca toca usuarios internos
  if (acti) meta.acti = true;
  else delete meta.acti;
  await db.auth.admin.updateUserById(authUserId, { app_metadata: meta });
}

// ── Sesión ───────────────────────────────────────────────────────────────

export type ActiSession = { user: PortalUser; member: ActiMember; plan: ActiPlan; config: ActiConfig };

export async function getActiSession(): Promise<ActiSession | null> {
  const user = await getPortalUser();
  if (!user) return null;
  const member = await getActiMember(user.clientId);
  if (!member) return null;
  const config = await loadActiConfig();
  return { user, member, plan: config.plans[member.plan], config };
}

// Para route handlers de /api/acti/*: el client_id sale SIEMPRE de la sesión
export async function requireActiUser(): Promise<{ s: ActiSession; response: null } | { s: null; response: NextResponse }> {
  const s = await getActiSession();
  if (!s) return { s: null, response: NextResponse.json({ error: "Sin acceso a ACTI" }, { status: 403 }) };
  return { s, response: null };
}

// Equipo interno de BullsEye (sesión sin rol de portal)
export async function requireInternalUser(): Promise<{ email: string; response: null } | { email: null; response: NextResponse }> {
  const { data } = await supabaseServer().auth.getUser();
  const u = data.user;
  if (!u || u.app_metadata?.role) {
    return { email: null, response: NextResponse.json({ error: "Solo equipo BullsEye" }, { status: 403 }) };
  }
  return { email: (u.email ?? "").toLowerCase(), response: null };
}
