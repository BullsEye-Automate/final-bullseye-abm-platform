import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { searchAlloCallsPage, type AlloCallItem } from "@/lib/allo";
import { pick } from "@/lib/lemlist";
import { clientReplySources } from "@/lib/respuestasLemlist/lemlist";
import { listReplyClients } from "@/lib/respuestasLemlist/process";
import { classifyPhone } from "./phones";

// Calidad de los datos de la Base de contactos (pedido de BullsEye 25-nov-2026):
// marca cada celular y correo como bueno, sospechoso o malo, y a la persona que
// ya no está en la empresa, con las señales que ya tenemos. SOLO en nuestra base
// (decisión de BullsEye): no se escribe nada en HubSpot ni en Lemlist.
//
// Celular (Allo, llamadas salientes):
//   · malo       = el resumen de la llamada dice número equivocado / no existe / no es la persona
//   · verificado = contestó y conversó (≥ 60 s)
//   · sospechoso = 6+ intentos en 3+ días distintos sin contestar nunca
// Correo malo = rebote en Lemlist (emailsBounced) o rebote duro en HubSpot (lo marca el sync).
// Dejó la empresa = la llamada o la respuesta de Lemlist dice «ya no trabaja ahí».

export const QUALITY_MIGRATION_HINT = "Falta ejecutar la migración supabase/20261126_contact_base_quality_migration.sql en Supabase.";
const STATE_KEY = "base_contactos:quality_state";
const BACKFILL_DAYS = 90;
const SUSPECT = { calls: 6, days: 3 };

export type PhoneQ = { st?: "ok" | "sospechoso" | "malo"; why?: string; src?: string; at?: string; calls: number; days: number; conn: number; last?: string };
export type EmailQ = { st: "malo"; why: string; src: string; at: string };
export type LeftQ = { at: string; why: string; src: string };
type QState = { alloDay: string | null; backfillDone: boolean; lemlistSince: string | null; repliesSince: string | null; at?: string; error?: string | null };

const WRONG_NUMBER = /(n[uú]mero (equivocado|incorrecto|err[oó]neo|errado|no corresponde|no existe|inexistente|fuera de servicio|no v[aá]lido|deshabilitado)|equivocad[oa] de n[uú]mero|wrong number|no (corresponde|pertenece) a (la persona|el contacto|quien|nombre)|no (es|era) (la persona|el contacto|quien buscaba)|no conoce a|nadie con ese nombre|fuera de servicio|no existe el n[uú]mero)/i;
const LEFT_COMPANY = /(ya no (trabaja|labora|est[aá] trabajando|forma parte|pertenece)|dej[oó] (la empresa|de trabajar|la compa[nñ][ií]a)|ya no (trabajo|laboro) (en|para)|no longer (work|with)|left the company|se (retir[oó]|desvincul[oó]|fue de la empresa))/i;

export async function readQualityState(): Promise<QState> {
  return (await readMonthCache<QState>(STATE_KEY)) ?? { alloDay: null, backfillDone: false, lemlistSince: null, repliesSince: null };
}
const saveState = (s: QState) => writeMonthCache(STATE_KEY, s, 400 * 86400_000);

const chileDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d);
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isSundayInChile = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short" }).format(new Date()) === "Sun";

export async function qualityColumnsReady(): Promise<boolean> {
  const { error } = await supabaseAdmin().from("contact_base").select("phone_quality").limit(1);
  return !error;
}

type Row = { person_key: string; mobiles: string[]; mobiles_maybe: string[]; emails: string[]; phone_quality: Record<string, PhoneQ> | null; email_quality: Record<string, EmailQ> | null; left_company: LeftQ | null };

async function rowsFor(column: "mobiles" | "mobiles_maybe" | "emails", values: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += 150) {
    const { data, error } = await supabaseAdmin().from("contact_base")
      .select("person_key, mobiles, mobiles_maybe, emails, phone_quality, email_quality, left_company")
      .overlaps(column, values.slice(i, i + 150));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Row[]));
  }
  return out;
}

async function saveRows(rows: Row[]) {
  const db = supabaseAdmin();
  for (let i = 0; i < rows.length; i += 20) {
    await Promise.all(rows.slice(i, i + 20).map((r) =>
      db.from("contact_base").update({ phone_quality: r.phone_quality ?? {}, email_quality: r.email_quality ?? {}, left_company: r.left_company }).eq("person_key", r.person_key)
    ));
  }
}

// Estado de un celular con sus contadores acumulados
function decide(q: PhoneQ): PhoneQ {
  if (q.st === "malo") return q; // una vez malo queda malo (criterio conservador)
  if (q.conn > 0) return { ...q, st: "ok", why: "Contestó y conversó en Allo", src: "allo" };
  if (q.calls >= SUSPECT.calls && q.days >= SUSPECT.days) return { ...q, st: "sospechoso", why: `${q.calls} llamadas en ${q.days} días sin contestar`, src: "allo" };
  return q;
}

// Un día de llamadas salientes de Allo → contadores por celular de la base
async function processAlloDay(day: string, deadline: number): Promise<boolean> {
  const calls: AlloCallItem[] = [];
  for (let page = 1; page < 400; page++) {
    if (Date.now() > deadline) return false;
    const r = await searchAlloCallsPage({ date_from: day, date_to: day, page, direction: "OUTBOUND" });
    calls.push(...r.items);
    if (!r.hasMore) break;
  }
  type Agg = { calls: number; conn: number; wrong: string | null; left: string | null; last: string };
  const byNum = new Map<string, Agg>();
  for (const c of calls) {
    const p = classifyPhone(c.contact_number);
    if (!p || p.kind === "other") continue;
    const a = byNum.get(p.number) ?? { calls: 0, conn: 0, wrong: null, left: null, last: c.date };
    a.calls++;
    const answered = (c.result === "ANSWERED" || c.result === "TRANSFERRED") && c.duration >= 60;
    const s = c.summary ?? "";
    if (WRONG_NUMBER.test(s)) a.wrong = (s.match(WRONG_NUMBER)?.[0] ?? "número equivocado").toLowerCase();
    else if (answered) a.conn++;
    if (LEFT_COMPANY.test(s)) a.left = (s.match(LEFT_COMPANY)?.[0] ?? "ya no trabaja ahí").toLowerCase();
    if (c.date > a.last) a.last = c.date;
    byNum.set(p.number, a);
  }
  if (!byNum.size) return true;
  const nums = Array.from(byNum.keys());
  const rows = new Map<string, Row>();
  for (const r of [...(await rowsFor("mobiles", nums)), ...(await rowsFor("mobiles_maybe", nums))]) rows.set(r.person_key, r);
  const at = new Date().toISOString();
  for (const r of Array.from(rows.values())) {
    const pq = { ...(r.phone_quality ?? {}) };
    for (const n of [...r.mobiles, ...r.mobiles_maybe]) {
      const a = byNum.get(n);
      if (!a) continue;
      // Sin estado hasta tener una señal clara
      let q: PhoneQ = pq[n] ?? { calls: 0, days: 0, conn: 0 };
      q = { ...q, calls: q.calls + a.calls, days: q.days + 1, conn: q.conn + a.conn, last: a.last };
      if (a.wrong) q = { ...q, st: "malo", why: `Allo: «${a.wrong}»`, src: "allo", at };
      pq[n] = decide(q);
    }
    r.phone_quality = pq;
    if (!r.left_company) {
      const leftHit = [...r.mobiles, ...r.mobiles_maybe].map((n) => byNum.get(n)?.left).find(Boolean);
      if (leftHit) r.left_company = { at, why: `Allo: «${leftHit}»`, src: "allo" };
    }
  }
  await saveRows(Array.from(rows.values()));
  return true;
}

// Rebotes de Lemlist de las campañas de cada cliente activo
async function lemlistBounces(since: string | null, deadline: number): Promise<number> {
  const db = supabaseAdmin();
  const { clients } = await listReplyClients();
  const sinceMs = since ? new Date(since).getTime() : Date.now() - BACKFILL_DAYS * 86400_000;
  const bounced = new Map<string, string>();
  const seenCampaign = new Set<string>();
  for (const c of clients) {
    if (Date.now() > deadline) break;
    const src = await clientReplySources(db, c.id).catch(() => null);
    if (!src?.apiKey) continue;
    const auth = `Basic ${Buffer.from(`:${src.apiKey}`).toString("base64")}`;
    for (const camp of src.campaigns) {
      if (seenCampaign.has(camp.id) || Date.now() > deadline) continue;
      seenCampaign.add(camp.id);
      for (let offset = 0; offset < 1000; offset += 100) {
        const res = await fetch(`https://api.lemlist.com/api/activities?type=emailsBounced&campaignId=${encodeURIComponent(camp.id)}&limit=100&offset=${offset}`, { headers: { Authorization: auth } }).catch(() => null);
        if (!res?.ok) break;
        const data = await res.json().catch(() => null);
        const items: Record<string, unknown>[] = Array.isArray(data) ? data : ((data as any)?.data ?? (data as any)?.activities ?? []);
        let older = false;
        for (const a of items) {
          const email = pick(a, "leadEmail", "email").toLowerCase();
          const at = String(a.createdAt ?? a.date ?? "");
          if (at && new Date(at).getTime() < sinceMs) { older = true; continue; }
          if (email) bounced.set(email, at || new Date().toISOString());
        }
        if (items.length < 100 || older) break;
      }
    }
  }
  if (!bounced.size) return 0;
  const rows = await rowsFor("emails", Array.from(bounced.keys()));
  for (const r of rows) {
    const eq = { ...(r.email_quality ?? {}) };
    for (const e of r.emails) { const at = bounced.get(e); if (at) eq[e] = { st: "malo", why: "Rebotó en Lemlist", src: "lemlist", at }; }
    r.email_quality = eq;
  }
  await saveRows(rows);
  return bounced.size;
}

// Respuestas de Lemlist ya clasificadas: «ya no trabajo aquí»
async function leftFromReplies(since: string | null): Promise<number> {
  let q = supabaseAdmin().from("lemlist_replies").select("lead_email, reply_text, replied_at, created_at").eq("category", "fuera_oficina").limit(5000);
  if (since) q = q.gte("created_at", since);
  const { data } = await q;
  const left = new Map<string, { at: string; why: string }>();
  for (const r of (data ?? []) as { lead_email: string | null; reply_text: string | null; replied_at: string | null; created_at: string }[]) {
    const m = (r.reply_text ?? "").match(LEFT_COMPANY);
    if (m && r.lead_email) left.set(r.lead_email.toLowerCase(), { at: r.replied_at ?? r.created_at, why: `Lemlist: «${m[0].toLowerCase()}»` });
  }
  if (!left.size) return 0;
  const rows = await rowsFor("emails", Array.from(left.keys()));
  const changed = rows.filter((r) => !r.left_company);
  for (const r of changed) { const hit = r.emails.map((e) => left.get(e)).find(Boolean)!; r.left_company = { at: hit.at, why: hit.why, src: "lemlist" }; }
  await saveRows(changed);
  return changed.length;
}

// Un tramo de la revisión de calidad. Primera vez: últimos 90 días. Después,
// los domingos, lo que pasó en la semana (junto con la actualización semanal).
export async function qualityChunk(opts: { deadline: number; force?: boolean }) {
  if (!(await qualityColumnsReady())) return { skipped: true, reason: QUALITY_MIGRATION_HINT };
  const state = await readQualityState();
  const yesterday = addDays(chileDay(), -1);
  if (state.backfillDone && !isSundayInChile() && !opts.force) return { skipped: true, reason: "Solo los domingos", state };
  let day = state.alloDay ? addDays(state.alloDay, 1) : addDays(yesterday, -BACKFILL_DAYS + 1);
  const errors: string[] = [];
  try {
    while (day <= yesterday && Date.now() < opts.deadline - 20_000) {
      const ok = await processAlloDay(day, opts.deadline - 20_000);
      if (!ok) break;
      state.alloDay = day;
      await saveState(state);
      day = addDays(day, 1);
    }
  } catch (e) {
    errors.push(`Allo: ${(e as Error).message.slice(0, 200)}`);
  }
  const alloDone = !state.alloDay || state.alloDay >= yesterday;
  let bounces = 0, left = 0;
  if (alloDone && Date.now() < opts.deadline - 15_000) {
    const now = new Date().toISOString();
    try { bounces = await lemlistBounces(state.lemlistSince, opts.deadline - 5_000); state.lemlistSince = now; } catch (e) { errors.push(`Lemlist: ${(e as Error).message.slice(0, 200)}`); }
    try { left = await leftFromReplies(state.repliesSince); state.repliesSince = now; } catch (e) { errors.push(`Respuestas: ${(e as Error).message.slice(0, 200)}`); }
    if (state.lemlistSince === now) state.backfillDone = true;
  }
  state.at = new Date().toISOString();
  state.error = errors.length ? errors.join(" · ") : null;
  await saveState(state);
  return { skipped: false, done: alloDone && state.backfillDone, alloDay: state.alloDay, bounces, left, errors };
}
