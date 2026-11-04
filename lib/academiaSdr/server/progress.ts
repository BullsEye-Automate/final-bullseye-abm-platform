import type { SupabaseClient } from "@supabase/supabase-js";
import { readMaster, type MasterData } from "@/lib/celulasSdr/sheets";
import { normalizeSdrName } from "@/lib/sdrAnalytics";
import { CC_ALWAYS, TEST_RECIPIENT, leaderEmail } from "@/lib/celulasSdr/server/alertsMail";
import { mailProvider, sendMail } from "@/lib/mailer";
import { getModuleDef, MODULE_COUNT } from "../modules";

// Seguimiento de la Academia SDR: ingresos y vueltas completadas por
// usuario (email de la sesión), y correo a la líder de célula del SDR con
// copia a CC_ALWAYS la primera vez que completa cada vuelta.
// Tablas: supabase/20261103_academia_sdr_progress_migration.sql

// ── Quién es el SDR y quién es su líder ─────────────────────────────────

let masterCache: { at: number; data: MasterData } | null = null;

async function loadMaster(): Promise<MasterData | null> {
  if (masterCache && Date.now() - masterCache.at < 10 * 60_000) return masterCache.data;
  const id = process.env.GOOGLE_SHEETS_MEETINGS_ID;
  if (!id) return null;
  try {
    const data = await readMaster(id, []);
    masterCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    console.warn("[academia-sdr] No se pudo leer la Maestra:", e);
    return null;
  }
}

// Los correos del equipo son inicial del nombre + apellido (nnazar@ =
// Nicolle Nazar). Se prueban también nombre+apellido y nombre.apellido.
function emailMatchesName(email: string, name: string): boolean {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const tokens = normalizeSdrName(name).replace(/[^a-z ]/g, "").split(" ").filter(Boolean);
  if (!local || tokens.length < 2) return false;
  const first = tokens[0];
  return tokens.slice(1).some((last) => local === first[0] + last || local === first + last);
}

export type SdrIdentity = { sdrName: string | null; leaderName: string | null };

export async function identifySdr(email: string): Promise<SdrIdentity> {
  const master = await loadMaster();
  if (!master) return { sdrName: null, leaderName: null };
  const names = Array.from(new Set([...master.people.map((p) => p.name), ...master.cells.flatMap((c) => [c.leader, ...c.members])]));
  const matches = names.filter((n) => emailMatchesName(email, n));
  if (matches.length !== 1) return { sdrName: null, leaderName: null };
  const sdrName = matches[0];
  const key = normalizeSdrName(sdrName);
  const cell = master.cells.find((c) => normalizeSdrName(c.leader) === key || c.members.some((m) => normalizeSdrName(m) === key));
  return { sdrName, leaderName: cell?.leader ?? null };
}

// ── Registro ────────────────────────────────────────────────────────────

export async function recordVisit(db: SupabaseClient, clientId: string, email: string): Promise<void> {
  const { sdrName } = await identifySdr(email);
  await db.from("sdr_academy_visits").insert({ client_id: clientId, user_email: email, sdr_name: sdrName });
}

type ProgressRow = {
  module_no: number;
  completed: boolean;
  first_completed_at: string | null;
  quiz_score: number | null;
  quiz_total: number | null;
  quiz_attempts: number;
  notified_at: string | null;
};

async function getRow(db: SupabaseClient, clientId: string, email: string, moduleNo: number): Promise<ProgressRow | null> {
  const { data } = await db
    .from("sdr_academy_progress")
    .select("module_no, completed, first_completed_at, quiz_score, quiz_total, quiz_attempts, notified_at")
    .eq("client_id", clientId)
    .eq("user_email", email)
    .eq("module_no", moduleNo)
    .maybeSingle();
  return (data as ProgressRow | null) ?? null;
}

export async function recordLap(opts: {
  db: SupabaseClient;
  clientId: string;
  clientName: string;
  email: string;
  moduleNo: number;
  done: boolean;
}): Promise<{ notified: boolean; mailError?: string }> {
  const { db, clientId, email, moduleNo, done } = opts;
  const now = new Date().toISOString();
  const [prev, who] = await Promise.all([getRow(db, clientId, email, moduleNo), identifySdr(email)]);

  const { error } = await db.from("sdr_academy_progress").upsert(
    {
      client_id: clientId,
      user_email: email,
      module_no: moduleNo,
      sdr_name: who.sdrName,
      leader_name: who.leaderName,
      completed: done,
      first_completed_at: prev?.first_completed_at ?? (done ? now : null),
      completed_at: done ? now : null,
      updated_at: now,
    },
    { onConflict: "client_id,user_email,module_no" }
  );
  if (error) throw new Error(error.message);

  // Correo solo la primera vez que completa la vuelta (marcar y desmarcar no reenvía).
  if (!done || prev?.notified_at) return { notified: false };
  try {
    await sendLapMail({ db, clientId, clientName: opts.clientName, email, moduleNo, who });
    await db
      .from("sdr_academy_progress")
      .update({ notified_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("user_email", email)
      .eq("module_no", moduleNo);
    return { notified: true };
  } catch (e) {
    console.warn("[academia-sdr] No se pudo enviar el correo de vuelta:", e);
    return { notified: false, mailError: (e as Error).message };
  }
}

export async function recordQuiz(db: SupabaseClient, clientId: string, email: string, moduleNo: number, score: number, total: number): Promise<void> {
  const [prev, who] = await Promise.all([getRow(db, clientId, email, moduleNo), identifySdr(email)]);
  // Se guarda el mejor puntaje y cuántas veces lo intentó.
  const best = prev?.quiz_score != null && prev.quiz_score > score ? { s: prev.quiz_score, t: prev.quiz_total } : { s: score, t: total };
  const { error } = await db.from("sdr_academy_progress").upsert(
    {
      client_id: clientId,
      user_email: email,
      module_no: moduleNo,
      sdr_name: who.sdrName,
      leader_name: who.leaderName,
      completed: prev?.completed ?? false,
      first_completed_at: prev?.first_completed_at ?? null,
      quiz_score: best.s,
      quiz_total: best.t,
      quiz_attempts: (prev?.quiz_attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,user_email,module_no" }
  );
  if (error) throw new Error(error.message);
}

// ── Correo a la líder ───────────────────────────────────────────────────

function escHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendLapMail(opts: { db: SupabaseClient; clientId: string; clientName: string; email: string; moduleNo: number; who: SdrIdentity }) {
  const { db, clientId, clientName, email, moduleNo, who } = opts;
  const { data: rows } = await db
    .from("sdr_academy_progress")
    .select("module_no, completed, quiz_score, quiz_total")
    .eq("client_id", clientId)
    .eq("user_email", email);
  const doneCount = ((rows ?? []) as { completed: boolean }[]).filter((r) => r.completed).length;
  const quiz = ((rows ?? []) as { quiz_score: number | null; quiz_total: number | null }[]).find((r) => r.quiz_score != null);

  const def = getModuleDef(moduleNo);
  const person = who.sdrName ?? email;
  const finished = doneCount >= MODULE_COUNT;
  const subject = finished
    ? `🏁 ${person} terminó la Academia SDR de ${clientName}`
    : `${person} completó la vuelta ${moduleNo} de la Academia SDR de ${clientName}`;

  // Destinatario: la líder de la célula del SDR, con copia a CC_ALWAYS.
  // Sin líder identificada (o si quien avanza es la líder) va solo en copia.
  const live = process.env.CELULAS_ALERTS_MODE !== "test";
  const leaderTo = who.leaderName && normalizeSdrName(who.leaderName) !== normalizeSdrName(who.sdrName ?? "") ? leaderEmail(who.leaderName) : null;
  const to = live ? (leaderTo ? [leaderTo] : CC_ALWAYS) : [TEST_RECIPIENT];
  const cc = live ? CC_ALWAYS.filter((c) => !to.includes(c)) : [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com";
  const notes: string[] = [];
  if (!who.sdrName) notes.push(`No se pudo identificar al SDR en la Maestra IA a partir de su correo (${email}).`);
  else if (!leaderTo && live) notes.push(`No se encontró la líder de célula de ${who.sdrName} (o no tiene correo configurado).`);

  const html = `<div style="font-family:Arial,sans-serif;color:#1d1640;max-width:560px">
    <div style="background:#251762;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">Bulls<span style="color:#62E0D8">Eye</span> · Academia SDR</div>
    <div style="border:1px solid #e4e0f2;border-top:0;padding:20px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 12px"><b>${escHtml(person)}</b> ${finished ? "terminó todas las vueltas" : `completó la <b>vuelta ${moduleNo}: ${escHtml(def?.title ?? "")}</b>`} de la capacitación de <b>${escHtml(clientName)}</b>.</p>
      <p style="margin:0 0 6px">Avance: <b>${doneCount} de ${MODULE_COUNT} vueltas</b></p>
      ${quiz ? `<p style="margin:0 0 6px">Quiz final: <b>${quiz.quiz_score} de ${quiz.quiz_total}</b>${quiz.quiz_total && quiz.quiz_score! >= Math.ceil(quiz.quiz_total * 0.8) ? " (aprobado)" : " (aún no aprueba)"}</p>` : ""}
      ${notes.map((n) => `<p style="margin:8px 0 0;color:#a3365c;font-size:13px">${escHtml(n)}</p>`).join("")}
      <p style="margin:16px 0 0"><a href="${appUrl}/sdr/academia?tab=seguimiento" style="color:#251762">Ver el seguimiento en la plataforma</a></p>
    </div></div>`;

  const from = process.env.CELULAS_ALERTS_FROM || (mailProvider() === "resend" ? "onboarding@resend.dev" : "ihincapie@bullseye-abm.com");
  await sendMail({ from, fromName: "BullsEye · Academia SDR", to, cc, subject: live ? subject : `[PRUEBA → ${leaderTo ?? "sin líder"}] ${subject}`, html });
}

// ── Lectura ─────────────────────────────────────────────────────────────

export async function loadMyProgress(db: SupabaseClient, clientId: string, email: string): Promise<number[]> {
  const { data } = await db
    .from("sdr_academy_progress")
    .select("module_no")
    .eq("client_id", clientId)
    .eq("user_email", email)
    .eq("completed", true);
  return ((data ?? []) as { module_no: number }[]).map((r) => r.module_no);
}

export type TrackingRow = {
  email: string;
  sdrName: string | null;
  leaderName: string | null;
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  completed: number[];
  lastCompletedAt: string | null;
  quizScore: number | null;
  quizTotal: number | null;
  quizAttempts: number;
};

export async function loadTracking(db: SupabaseClient, clientId: string): Promise<TrackingRow[]> {
  const [{ data: visits }, { data: progress }] = await Promise.all([
    db.from("sdr_academy_visits").select("user_email, sdr_name, visited_at").eq("client_id", clientId).order("visited_at", { ascending: true }).limit(20000),
    db.from("sdr_academy_progress").select("user_email, module_no, sdr_name, leader_name, completed, completed_at, quiz_score, quiz_total, quiz_attempts").eq("client_id", clientId),
  ]);
  const by = new Map<string, TrackingRow>();
  const row = (email: string): TrackingRow => {
    let r = by.get(email);
    if (!r) {
      r = { email, sdrName: null, leaderName: null, visits: 0, firstVisit: null, lastVisit: null, completed: [], lastCompletedAt: null, quizScore: null, quizTotal: null, quizAttempts: 0 };
      by.set(email, r);
    }
    return r;
  };
  for (const v of (visits ?? []) as { user_email: string; sdr_name: string | null; visited_at: string }[]) {
    const r = row(v.user_email);
    r.visits++;
    r.firstVisit = r.firstVisit ?? v.visited_at;
    r.lastVisit = v.visited_at;
    r.sdrName = r.sdrName ?? v.sdr_name;
  }
  for (const p of (progress ?? []) as {
    user_email: string; module_no: number; sdr_name: string | null; leader_name: string | null; completed: boolean;
    completed_at: string | null; quiz_score: number | null; quiz_total: number | null; quiz_attempts: number;
  }[]) {
    const r = row(p.user_email);
    r.sdrName = p.sdr_name ?? r.sdrName;
    r.leaderName = p.leader_name ?? r.leaderName;
    if (p.completed) {
      r.completed.push(p.module_no);
      if (p.completed_at && (!r.lastCompletedAt || p.completed_at > r.lastCompletedAt)) r.lastCompletedAt = p.completed_at;
    }
    if (p.quiz_score != null) {
      r.quizScore = p.quiz_score;
      r.quizTotal = p.quiz_total;
      r.quizAttempts = p.quiz_attempts;
    }
  }
  return Array.from(by.values())
    .map((r) => ({ ...r, completed: r.completed.sort((a, b) => a - b) }))
    .sort((a, b) => b.completed.length - a.completed.length || (b.lastVisit ?? "").localeCompare(a.lastVisit ?? ""));
}
