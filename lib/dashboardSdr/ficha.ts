import { hsFetchWithRetry, hsHeaders, fetchHSOwners } from "@/lib/hubspot";
import { CO_ORDER, CT_ORDER } from "@/lib/radarAbm/dictionaries";
import { batchAssociations, batchRead, detectProperties, loadPropertyCatalog, normLabel, type DetectedProperty } from "@/lib/radarAbm/server/hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig, subMapping, universeMode } from "@/lib/radarAbm/server/store";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/mailer";
import { readMasterPeople, resolveSdr } from "@/lib/respuestasLemlist/directory";

// Dashboard SDR → ficha de empresa (26-nov-2026, etapa 1 de «trabajar desde la
// app»): historial de actividades de la empresa y sus contactos leído en vivo
// de HubSpot, y registro de notas, actividades (WhatsApp / LinkedIn / correo)
// y seguimientos (tareas) que se escriben en HubSpot a nombre del SDR
// (propietario = su usuario de HubSpot, por correo). HubSpot sigue siendo la
// base: Pulso ABM, workflows e informes leen de ahí.
// No se muestran teléfonos ni correos de los contactos (solo si tienen); el
// cuerpo de los correos tampoco (solo el asunto).

const HS = "https://api.hubapi.com";
const MAX_CONTACTS = 60;
const MAX_ITEMS = 120;
const BODY_MAX = 1200;

export type FichaKind = "note" | "call" | "email" | "whatsapp" | "linkedin" | "comm" | "task" | "meeting";
export type FichaItem = {
  id: string; kind: FichaKind; at: string | null; owner: string | null; contacts: string[];
  title: string; body: string; done?: boolean; due?: string | null; dir?: string | null; outcome?: string | null;
};
export type FichaContact = { hs: string; n: string; cargo: string; st: string | null; ph: boolean; ml: boolean; lk: boolean };
export type Ficha = {
  company: { hs: string; n: string; st: string | null; dom: string | null };
  contacts: FichaContact[];
  items: FichaItem[];
  tasks: FichaItem[];           // seguimientos pendientes (tareas sin completar)
  writable: boolean; reason: string | null;
  at: string;
};

const canon = (s: string) => normLabel(s.replace(/\p{Extended_Pictographic}/gu, ""));
const compact = (x: string) => normLabel(x).replace(/ /g, "");
const labeler = (p: DetectedProperty | undefined) => {
  const m = new Map((p?.options ?? []).map((o) => [o.value, o.label]));
  return (v: string | null | undefined) => (v ? v.split(";").map((x) => m.get(x) ?? x).join("; ") : null);
};
const strip = (html: string | null | undefined) =>
  (html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
const cut = (s: string) => (s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}…` : s);

type Ctx = {
  token: string | undefined; writable: boolean; reason: string | null; own: boolean;
  P: Record<string, DetectedProperty>; ctClientProp: string | null; ctClientOpt: string | null;
  coAliases: Record<string, string>; ctAliases: Record<string, string>;
};

async function context(clientId: string, sub: string | null): Promise<Ctx> {
  const { data: client } = await supabaseAdmin().from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Cliente no encontrado");
  const [cfg, settings] = await Promise.all([loadRadarConfig(), loadClientSettings(clientId)]);
  const token = await hubspotTokenFor(clientId, settings.hubspot_source);
  const { catalog } = await loadPropertyCatalog(token);
  const mapping = sub ? subMapping(cfg, settings, sub) : effectiveProperties(cfg, settings);
  const P = Object.fromEntries(detectProperties(mapping, catalog, sub || client.name).map((d) => [d.key, d]));
  // Contactos de la cuenta: «Cliente BullsEye» del contacto = el cliente (como Pulso ABM)
  const uniCt = (catalog.contacts ?? []).find((x) => x.name === (settings.properties?.universeContactClient || "cliente_bullseye"));
  const uniValue = (sub ? "" : (settings.hubspot_client_value ?? "").trim()) || sub || client.name;
  const c = compact(uniValue);
  const opt = (uniCt?.options ?? []).find((o) => compact(o.label) === c || compact(o.value) === c)
    ?? (c.length >= 4 ? (uniCt?.options ?? []).find((o) => { const l = compact(o.label); return l.length >= 4 && (l.startsWith(c) || c.startsWith(l)); }) : undefined);
  const own = settings.hubspot_source === "client";
  return {
    token, P,
    // HubSpot propio del cliente: se intenta escribir; si su token es de solo lectura, HubSpot responde 403 y se avisa
    writable: true, own,
    reason: null,
    ctClientProp: uniCt && opt ? uniCt.name : null, ctClientOpt: opt?.value ?? null,
    coAliases: universeMode(settings, client.name) === "client" ? {} : cfg.companyAliases ?? {},
    ctAliases: cfg.contactAliases ?? {},
  };
}

function canonical(label: string | null, official: string[], aliases: Record<string, string>): string | null {
  if (!label) return null;
  const map = new Map(official.map((o) => [canon(o), o]));
  for (const [from, to] of Object.entries(aliases)) map.set(canon(from), to);
  return map.get(canon(label)) ?? label;
}

const ENG_TYPES = ["notes", "calls", "emails", "communications", "tasks", "meetings"] as const;
const ENG_PROPS: Record<(typeof ENG_TYPES)[number], string[]> = {
  notes: ["hs_timestamp", "hs_note_body", "hubspot_owner_id"],
  calls: ["hs_timestamp", "hs_call_title", "hs_call_body", "hs_call_disposition", "hs_call_direction", "hs_call_duration", "hubspot_owner_id", "hs_activity_type"],
  emails: ["hs_timestamp", "hs_email_subject", "hs_email_direction", "hubspot_owner_id"],
  communications: ["hs_timestamp", "hs_communication_channel_type", "hs_communication_body", "hubspot_owner_id"],
  tasks: ["hs_timestamp", "hs_task_subject", "hs_task_body", "hs_task_status", "hs_task_type", "hubspot_owner_id"],
  meetings: ["hs_timestamp", "hs_meeting_title", "hs_meeting_start_time", "hs_meeting_outcome", "hubspot_owner_id"],
};

async function dispositions(token?: string): Promise<Map<string, string>> {
  try {
    const r = await hsFetchWithRetry(`${HS}/calling/v1/dispositions`, { headers: hsHeaders(token) });
    if (!r.ok) return new Map();
    const d = (await r.json()) as { id: string; label: string }[];
    return new Map(d.map((x) => [x.id, x.label]));
  } catch { return new Map(); }
}

export async function loadFicha(clientId: string, sub: string | null, hsCompanyId: string): Promise<Ficha> {
  if (!/^\d+$/.test(hsCompanyId)) throw new Error("Id de HubSpot inválido.");
  const x = await context(clientId, sub);
  const { token, P } = x;
  const stProp = P.companyStatus?.property ?? null, ctStProp = P.contactStatus?.property ?? null;
  const [coRow] = await batchRead("companies", [hsCompanyId], ["name", "domain", ...(stProp ? [stProp] : [])], token);
  if (!coRow) throw new Error("No se encontró la empresa en HubSpot.");

  // Contactos de la empresa (solo los de esta cuenta si se puede saber)
  const ctIds = (await batchAssociations("companies", "contacts", [hsCompanyId], token)).get(hsCompanyId) ?? [];
  const ctProps = ["firstname", "lastname", "jobtitle", "phone", "mobilephone", "email", "hs_linkedin_url", ...(ctStProp ? [ctStProp] : []), ...(x.ctClientProp ? [x.ctClientProp] : [])];
  const ctRows = ctIds.length ? await batchRead("contacts", ctIds.slice(0, 500), ctProps, token) : [];
  const ctLabel = labeler(P.contactStatus);
  const contacts: FichaContact[] = ctRows
    .filter((r) => {
      const own = x.ctClientProp && x.ctClientOpt ? (r.properties[x.ctClientProp] ?? "").split(";").map((s) => s.trim()).includes(x.ctClientOpt) : true;
      return own || (ctStProp ? !!r.properties[ctStProp] : false);
    })
    .slice(0, MAX_CONTACTS)
    .map((r) => {
      const p = r.properties;
      return {
        hs: r.id, n: [p.firstname, p.lastname].filter(Boolean).join(" ").trim() || `Contacto ${r.id}`, cargo: p.jobtitle ?? "",
        st: canonical(ctStProp ? ctLabel(p[ctStProp]) : null, CT_ORDER, x.ctAliases),
        ph: !!(p.phone || p.mobilephone), ml: !!p.email?.includes("@"), lk: !!p.hs_linkedin_url,
      };
    });
  const ctName = new Map(contacts.map((c) => [c.hs, c.n]));

  // Actividades de la empresa y de sus contactos (una sola vez por id)
  const fromIds = [hsCompanyId];
  const byType = new Map<string, Map<string, Set<string>>>(); // tipo → id actividad → contactos
  await Promise.all(ENG_TYPES.map(async (t) => {
    const m = new Map<string, Set<string>>();
    const coAs = await batchAssociations("companies", t, fromIds, token).catch(() => new Map<string, string[]>());
    for (const id of coAs.get(hsCompanyId) ?? []) m.set(id, m.get(id) ?? new Set());
    if (contacts.length) {
      const ctAs = await batchAssociations("contacts", t, contacts.map((c) => c.hs), token).catch(() => new Map<string, string[]>());
      for (const [ct, ids] of ctAs) for (const id of ids) { const s = m.get(id) ?? new Set<string>(); s.add(ct); m.set(id, s); }
    }
    byType.set(t, m);
  }));
  const [owners, disp] = await Promise.all([fetchHSOwners(token).catch(() => []), dispositions(token)]);
  const ownerName = new Map(owners.map((o) => [String(o.id), [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.id)]));
  const items: FichaItem[] = [];
  await Promise.all(ENG_TYPES.map(async (t) => {
    const m = byType.get(t)!;
    if (!m.size) return;
    const rows = await batchRead(t, [...m.keys()].slice(0, 300), ENG_PROPS[t], token).catch(() => []);
    for (const r of rows) {
      const p = r.properties;
      const cts = [...(m.get(r.id) ?? [])].map((c) => ctName.get(c)).filter(Boolean) as string[];
      const base = { id: `${t}:${r.id}`, at: p.hs_timestamp ?? null, owner: p.hubspot_owner_id ? ownerName.get(p.hubspot_owner_id) ?? null : null, contacts: cts };
      if (t === "notes") items.push({ ...base, kind: "note", title: "Nota", body: cut(strip(p.hs_note_body)) });
      else if (t === "calls") {
        const typ = normLabel(p.hs_activity_type ?? "");
        const kind: FichaKind = typ.includes("whatsapp") ? "whatsapp" : typ.includes("linkedin") ? "linkedin" : "call";
        const dur = Number(p.hs_call_duration ?? 0);
        items.push({ ...base, kind, title: p.hs_call_title || (kind === "call" ? "Llamada" : kind === "whatsapp" ? "WhatsApp" : "LinkedIn"), body: cut(strip(p.hs_call_body)),
          dir: p.hs_call_direction ?? null, outcome: [p.hs_call_disposition ? disp.get(p.hs_call_disposition) ?? null : null, dur ? `${Math.round(dur / 1000)} s` : null].filter(Boolean).join(" · ") || null });
      } else if (t === "emails") items.push({ ...base, kind: "email", title: p.hs_email_subject || "Correo", body: "", dir: p.hs_email_direction ?? null });
      else if (t === "communications") {
        const ch = (p.hs_communication_channel_type ?? "").toUpperCase();
        const kind: FichaKind = ch.includes("WHATS") ? "whatsapp" : ch.includes("LINKEDIN") ? "linkedin" : "comm";
        items.push({ ...base, kind, title: kind === "whatsapp" ? "WhatsApp" : kind === "linkedin" ? "LinkedIn" : "Mensaje", body: cut(strip(p.hs_communication_body)) });
      } else if (t === "tasks") items.push({ ...base, kind: "task", title: p.hs_task_subject || "Tarea", body: cut(strip(p.hs_task_body)), done: p.hs_task_status === "COMPLETED", due: p.hs_timestamp ?? null });
      else if (t === "meetings") items.push({ ...base, at: p.hs_meeting_start_time ?? p.hs_timestamp ?? null, kind: "meeting", title: p.hs_meeting_title || "Reunión", body: "", outcome: p.hs_meeting_outcome ?? null });
    }
  }));
  const tasks = items.filter((i) => i.kind === "task" && !i.done).sort((a, b) => String(a.due ?? "").localeCompare(String(b.due ?? "")));
  const history = items.filter((i) => !(i.kind === "task" && !i.done)).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? ""))).slice(0, MAX_ITEMS);
  return {
    company: { hs: hsCompanyId, n: coRow.properties.name || `Empresa ${hsCompanyId}`, st: canonical(stProp ? labeler(P.companyStatus)(coRow.properties[stProp]) : null, CO_ORDER, x.coAliases), dom: coRow.properties.domain ?? null },
    contacts, items: history, tasks, writable: x.writable, reason: x.reason, at: new Date().toISOString(),
  };
}

// ── Registrar ─────────────────────────────────────────────────────────────
export type NewActivity = {
  clientId: string; sub: string | null; hsCompanyId: string; contactHs?: string | null;
  kind: "note" | "whatsapp" | "linkedin" | "email" | "task";
  body: string; subject?: string; due?: string | null;      // due = YYYY-MM-DDTHH:MM (hora de Chile) para tareas
  taskType?: "CALL" | "TODO"; byEmail: string;
};

// Fecha y hora de Chile → ISO (America/Santiago cambia de horario)
function chileToIso(local: string): string {
  const [d, t = "09:00"] = local.split("T");
  for (const off of ["-03:00", "-04:00"]) {
    const iso = new Date(`${d}T${t}:00${off}`);
    const back = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(iso).replace(" ", "T");
    if (back === `${d}T${t}`) return iso.toISOString();
  }
  return new Date(`${d}T${t}:00-03:00`).toISOString();
}

async function hsWrite(url: string, method: string, token: string | undefined, body?: unknown, own = false) {
  const r = await hsFetchWithRetry(url, { method, headers: hsHeaders(token), ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (r.status === 403) throw new Error(own
      ? "El token del HubSpot de este cliente es de solo lectura: para registrar desde la app, el cliente debe darnos un token de su app privada con permiso de escritura de notas, tareas y comunicaciones (Configuración → Cliente → HubSpot del cliente)."
      : `HubSpot no dio permiso para escribir (${t.slice(0, 200)}). Hay que agregar el permiso de escritura de notas, tareas y comunicaciones a la app privada de HubSpot.`);
    throw new Error(`HubSpot ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.status === 204 ? null : r.json().catch(() => null);
}

const normName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
// Usuario de HubSpot: por correo y, si no calza, por nombre (cruce con el valor de la propiedad SDR)
async function ownerIdFor(o: { emails: (string | null)[]; names: (string | null)[] }, token?: string): Promise<string | null> {
  const owners = await fetchHSOwners(token).catch(() => []);
  for (const e of o.emails) {
    if (!e) continue;
    const hit = owners.find((x) => (x.email ?? "").toLowerCase() === e.trim().toLowerCase());
    if (hit) return hit.id;
  }
  for (const n of o.names) {
    const t = n ? normName(n) : "";
    if (!t) continue;
    const full = owners.filter((x) => normName(`${x.firstName ?? ""} ${x.lastName ?? ""}`) === t);
    if (full.length === 1) return full[0].id;
    // "Vanessa Abarzua" ↔ "Vanessa Abarzua Pérez": nombre + primer apellido
    const pre = owners.filter((x) => { const f = normName(`${x.firstName ?? ""} ${x.lastName ?? ""}`); return f && (f.startsWith(`${t} `) || t.startsWith(`${f} `)); });
    if (pre.length === 1) return pre[0].id;
  }
  return null;
}

// SDR de la empresa ("SDR - <cliente>") → correo de la Maestra
async function companySdrEmail(x: Ctx, hsCompanyId: string): Promise<{ email: string | null; name: string | null; raw?: string | null }> {
  const prop = x.P.companySdr?.property;
  if (!prop) return { email: null, name: null };
  const [row] = await batchRead("companies", [hsCompanyId], [prop], x.token).catch(() => []);
  const raw = labeler(x.P.companySdr)(row?.properties?.[prop]);
  if (!raw) return { email: null, name: null };
  const r = resolveSdr(await readMasterPeople().catch(() => []), raw);
  return { email: r.ok ? r.person.email : null, name: r.person?.name ?? raw, raw };
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Invitación de calendario (.ics): el correo trae «Agregar al calendario» en Gmail
function buildIcs(o: { uid: string; startIso: string; title: string; description: string; url: string | null }): string {
  const end = new Date(new Date(o.startIso).getTime() + 15 * 60_000).toISOString();
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BullsEye//Seguimientos SDR//ES", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${o.uid}@portal.bullseye-abm.com`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(o.startIso)}`, `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(o.title)}`, `DESCRIPTION:${icsText(o.description)}`, ...(o.url ? [`URL:${o.url}`] : []),
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(o.title)}`, "TRIGGER:-PT10M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

async function mailTask(o: {
  to: string; cc: string | null; title: string; company: string; client: string; contact: string | null; body: string;
  startIso: string; type: "CALL" | "TODO"; uid: string; hsUrl: string | null;
}) {
  const from = process.env.CELULAS_ALERTS_FROM || "alertas@notificaciones.bullseye-abm.com";
  const when = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(o.startIso));
  const listUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://portal.bullseye-abm.com"}/sdr/dashboard?vista=listas`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f1b2e;max-width:560px">
<p style="margin:0 0 4px;color:#6b6580;font-size:12px">${escHtml(o.client)} · seguimiento agendado</p>
<h2 style="margin:0 0 12px;font-size:18px;color:#251762">${o.type === "CALL" ? "📞 " : ""}${escHtml(o.title)}</h2>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:3px 12px 3px 0;color:#6b6580">Cuándo</td><td style="padding:3px 0"><b>${escHtml(when)}</b> (hora de Chile)</td></tr>
<tr><td style="padding:3px 12px 3px 0;color:#6b6580">Empresa</td><td style="padding:3px 0">${escHtml(o.company)}</td></tr>
${o.contact ? `<tr><td style="padding:3px 12px 3px 0;color:#6b6580">Contacto</td><td style="padding:3px 0">${escHtml(o.contact)}</td></tr>` : ""}
<tr><td style="padding:3px 12px 3px 0;color:#6b6580">Tipo</td><td style="padding:3px 0">${o.type === "CALL" ? "Llamar" : "Por hacer"}</td></tr>
</table>
${o.body ? `<p style="margin:12px 0;padding:10px 12px;background:#f4f2fb;border-radius:8px;white-space:pre-line">${escHtml(o.body)}</p>` : ""}
<p style="margin:16px 0">
<a href="${listUrl}" style="background:#251762;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;display:inline-block">Abrir Mis listas</a>
${o.hsUrl ? ` &nbsp; <a href="${o.hsUrl}" style="color:#251762">Ver en HubSpot</a>` : ""}
</p>
<p style="color:#6b6580;font-size:12px">Adjuntamos la invitación (.ics): ábrela o usa «Agregar al calendario» para tenerla en tu Google Calendar con aviso 10 minutos antes. La tarea también quedó en HubSpot a tu nombre.</p>
</div>`;
  await sendMail({
    from, fromName: "BullsEye · Seguimientos", to: [o.to], ...(o.cc ? { cc: [o.cc] } : {}),
    subject: `Seguimiento: ${o.title} · ${o.company} — ${when}`, html,
    attachments: [{ filename: "seguimiento.ics", contentType: "text/calendar; charset=utf-8; method=PUBLISH", content: Buffer.from(buildIcs({ uid: o.uid, startIso: o.startIso, title: `${o.title} · ${o.company}`, description: [o.contact ? `Contacto: ${o.contact}` : "", o.body, o.hsUrl ?? ""].filter(Boolean).join("\n"), url: o.hsUrl }), "utf8") }],
  });
}

export async function createActivity(a: NewActivity): Promise<{ id: string; owner: boolean; mailed?: string | null; mailError?: string | null }> {
  if (!/^\d+$/.test(a.hsCompanyId) || (a.contactHs && !/^\d+$/.test(a.contactHs))) throw new Error("Id de HubSpot inválido.");
  const body = a.body.trim();
  if (!body && a.kind !== "task") throw new Error("Escribe el contenido.");
  const x = await context(a.clientId, a.sub);
  if (!x.writable) throw new Error(x.reason ?? "No se puede escribir en este HubSpot.");
  // Seguimiento: va al SDR dueño de la empresa (si lo registra la líder, igual le llega a él)
  const sdr: { email: string | null; name: string | null; raw?: string | null } = await companySdrEmail(x, a.hsCompanyId).catch(() => ({ email: null, name: null }));
  // Propietario: en el HubSpot propio del cliente, el SDR de la empresa (propiedad «SDR») cruzado con
  // los usuarios de ese HubSpot por correo o nombre; en el de BullsEye, quien registra (el seguimiento,
  // al SDR de la empresa). Si nada calza queda sin propietario y se avisa.
  const owner = x.own || a.kind === "task"
    ? await ownerIdFor({ emails: [sdr.email, ...(x.own ? [] : [a.byEmail])], names: [sdr.raw ?? null, sdr.name] }, x.token)
    : await ownerIdFor({ emails: [a.byEmail], names: [] }, x.token);
  const now = new Date().toISOString();
  const html = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  let objectType: string; let properties: Record<string, string>;
  if (a.kind === "note") {
    objectType = "notes";
    properties = { hs_timestamp: now, hs_note_body: html };
  } else if (a.kind === "task") {
    if (!a.due) throw new Error("Falta la fecha del seguimiento.");
    objectType = "tasks";
    const startIso = chileToIso(a.due);
    // Recordatorio de HubSpot al propietario 10 minutos antes
    properties = { hs_timestamp: startIso, hs_task_subject: (a.subject || "Seguimiento").slice(0, 200), hs_task_body: html, hs_task_status: "NOT_STARTED", hs_task_type: a.taskType ?? "CALL", hs_task_reminders: String(new Date(startIso).getTime() - 10 * 60_000) };
  } else if (a.kind === "email") {
    // Correo enviado fuera de HubSpot: se registra como nota marcada
    objectType = "notes";
    properties = { hs_timestamp: now, hs_note_body: `<b>Correo enviado${a.subject ? `: ${a.subject.replace(/</g, "&lt;")}` : ""}</b><br>${html}` };
  } else {
    objectType = "communications";
    properties = { hs_timestamp: now, hs_communication_channel_type: a.kind === "whatsapp" ? "WHATS_APP" : "LINKEDIN_MESSAGE", hs_communication_logged_from: "CRM", hs_communication_body: body };
  }
  if (owner) properties.hubspot_owner_id = owner;
  const created = await hsWrite(`${HS}/crm/v3/objects/${objectType}`, "POST", x.token, { properties }, x.own) as { id?: string } | null;
  const id = String(created?.id ?? "");
  if (!id) throw new Error("HubSpot no devolvió el registro creado.");
  // Asociaciones por defecto (empresa y, si se eligió, contacto)
  await hsWrite(`${HS}/crm/v4/objects/${objectType}/${id}/associations/default/companies/${a.hsCompanyId}`, "PUT", x.token, undefined, x.own);
  if (a.contactHs) await hsWrite(`${HS}/crm/v4/objects/${objectType}/${id}/associations/default/contacts/${a.contactHs}`, "PUT", x.token, undefined, x.own);
  if (a.kind !== "task") return { id: `${objectType}:${id}`, owner: !!owner };

  // Correo al SDR con la invitación de calendario (si falla, la tarea igual quedó en HubSpot)
  const to = sdr.email ?? a.byEmail;
  try {
    const [[co], ct] = await Promise.all([
      batchRead("companies", [a.hsCompanyId], ["name"], x.token),
      a.contactHs ? batchRead("contacts", [a.contactHs], ["firstname", "lastname", "jobtitle"], x.token) : Promise.resolve([]),
    ]);
    const cp = ct[0]?.properties;
    const { data: cl } = await supabaseAdmin().from("clients").select("name").eq("id", a.clientId).maybeSingle();
    const portal = Number(process.env.HUBSPOT_PORTAL_ID) || 25153925;
    await mailTask({
      to, cc: to.toLowerCase() !== a.byEmail.toLowerCase() ? a.byEmail : null,
      title: (a.subject || "Seguimiento").slice(0, 200), company: co?.properties?.name || `Empresa ${a.hsCompanyId}`,
      client: a.sub || cl?.name || "", contact: cp ? [[cp.firstname, cp.lastname].filter(Boolean).join(" "), cp.jobtitle].filter(Boolean).join(" · ") : null,
      body, startIso: chileToIso(a.due!), type: a.taskType ?? "CALL", uid: `task-${id}`,
      hsUrl: !x.own ? `https://app.hubspot.com/contacts/${portal}/record/0-2/${a.hsCompanyId}` : null,
    });
    return { id: `${objectType}:${id}`, owner: !!owner, mailed: to };
  } catch (e) {
    console.error("Seguimiento: no se pudo enviar el correo:", e);
    return { id: `${objectType}:${id}`, owner: !!owner, mailed: null, mailError: (e as Error).message };
  }
}

export async function completeTask(clientId: string, sub: string | null, taskId: string) {
  const id = taskId.replace(/^tasks:/, "");
  if (!/^\d+$/.test(id)) throw new Error("Id de tarea inválido.");
  const x = await context(clientId, sub);
  if (!x.writable) throw new Error(x.reason ?? "No se puede escribir en este HubSpot.");
  await hsWrite(`${HS}/crm/v3/objects/tasks/${id}`, "PATCH", x.token, { properties: { hs_task_status: "COMPLETED" } }, x.own);
}
