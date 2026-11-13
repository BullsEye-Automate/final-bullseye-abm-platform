// Google Calendar del SDR para su onboarding: con su correo corporativo se
// leen (solo lectura) los eventos de su calendario principal en la ventana
// del onboarding, se reconocen los del plan (Bienvenida, HubSpot, Allo, Pit
// Stop…, palabras `k` de lib/onboardingSdr/plan.ts) y se muestran junto a
// cada hito con su fecha, hora y si aceptó la invitación.
//
// Usa la misma cuenta de servicio de las planillas y Gmail
// (GOOGLE_SERVICE_ACCOUNT_JSON) con delegación de todo el dominio: la cuenta
// "se hace pasar" por el SDR. Requisitos (una sola vez, administrador de
// Google Workspace):
// 1. Google Cloud → proyecto de la cuenta de servicio → habilitar
//    "Google Calendar API".
// 2. admin.google.com → Seguridad → Controles de API → Delegación de todo el
//    dominio → editar el Client ID de la cuenta de servicio (client_id del
//    JSON) y agregar el alcance
//    https://www.googleapis.com/auth/calendar.readonly
//    (sin borrar los que ya tiene, ej. gmail.send).
import { google } from "googleapis";
import { HITOS, type Hito } from "../plan";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const DOMAIN = "@bullseye-abm.com";

export type CalEvent = {
  id: string;
  title: string;
  start: string; // ISO (o AAAA-MM-DD si es de día completo)
  end: string | null;
  allDay: boolean;
  link: string | null;
  rs: "accepted" | "tentative" | "declined" | "needsAction" | "organizer" | null; // respuesta del SDR
  hito: string | null;
};

export type CalendarResult =
  | { status: "ok"; email: string; events: CalEvent[]; byHito: Record<string, CalEvent> }
  | { status: "error" | "off"; email: string; msg: string; events: CalEvent[]; byHito: Record<string, CalEvent> };

// Palabras que marcan un evento como parte del onboarding aunque no calce
// con un hito puntual.
const GENERIC = ["onboarding", "induccion", "capacitacion", "bienvenida", "pit stop", "roleplay", "reforzamiento", "sdr nuev"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const cache = new Map<string, { at: number; data: CalendarResult }>();
const TTL_MS = 5 * 60_000;

function addDays(iso: string, n: number): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12));
}

function explain(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e);
  if (/unauthorized_client|access_denied|insufficient|not authorized|delegation/i.test(msg)) {
    return "Falta autorizar el calendario para la cuenta de servicio: un administrador de Google Workspace debe agregar el alcance https://www.googleapis.com/auth/calendar.readonly a su delegación de dominio (admin.google.com → Seguridad → Controles de API).";
  }
  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg)) {
    return "La Google Calendar API no está habilitada en el proyecto de Google Cloud de la cuenta de servicio.";
  }
  if (/invalid_grant|Invalid email|not found|notFound/i.test(msg)) {
    return "No se encontró un calendario de Google para este correo.";
  }
  return `No se pudo leer el calendario: ${msg}`;
}

export async function loadOnboardingCalendar(email: string, ingreso: string | null, fresh = false): Promise<CalendarResult> {
  const e = email.toLowerCase();
  const empty = { events: [] as CalEvent[], byHito: {} as Record<string, CalEvent> };
  if (!e.endsWith(DOMAIN)) return { status: "off", email: e, msg: "Solo correos @bullseye-abm.com", ...empty };
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) return { status: "error", email: e, msg: "GOOGLE_SERVICE_ACCOUNT_JSON no configurado.", ...empty };

  const key = `${e}|${ingreso ?? ""}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.data;

  // Ventana: una semana antes del día 1 hasta el día 95. Sin fecha de
  // ingreso: desde hace 2 semanas hasta 3 meses más.
  const today = new Date().toISOString().slice(0, 10);
  const from = ingreso ? addDays(ingreso, -10) : addDays(today, -14);
  const to = ingreso ? addDays(ingreso, 95) : addDays(today, 90);

  let data: CalendarResult;
  try {
    const credentials = JSON.parse(credentialsJson);
    const auth = new google.auth.JWT({ email: credentials.client_email, key: credentials.private_key, scopes: [SCOPE], subject: e });
    const cal = google.calendar({ version: "v3", auth });
    const raw: any[] = [];
    let pageToken: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId: "primary",
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      raw.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && raw.length < 1000);

    const events: CalEvent[] = raw
      .filter((ev) => ev.status !== "cancelled" && ev.eventType !== "outOfOffice" && ev.eventType !== "workingLocation" && ev.eventType !== "focusTime")
      .map((ev) => {
        const self = (ev.attendees ?? []).find((a: any) => a.self);
        const rs = ev.organizer?.self ? "organizer" : (self?.responseStatus ?? null);
        return {
          id: String(ev.id),
          title: String(ev.summary ?? "(sin título)"),
          start: String(ev.start?.dateTime ?? ev.start?.date ?? ""),
          end: ev.end?.dateTime ?? ev.end?.date ?? null,
          allDay: !ev.start?.dateTime,
          link: ev.htmlLink ?? null,
          rs,
          hito: null,
        } as CalEvent;
      })
      .filter((ev) => ev.start);

    const byHito = matchHitos(events, ingreso);
    // Solo se muestran los eventos del onboarding: los que calzan con un
    // hito o tienen una palabra del onboarding en el título.
    const shown = events.filter((ev) => ev.hito || GENERIC.some((g) => norm(ev.title).includes(g)));
    data = { status: "ok", email: e, events: shown, byHito };
  } catch (err) {
    console.warn("[onboarding-sdr] Calendario:", (err as Error).message);
    data = { status: "error", email: e, msg: explain(err), ...empty };
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

// A cada hito con palabras clave se le asigna el evento cuyo título las
// contiene y que queda más cerca de su fecha esperada (día 1 + d − 1).
// Un mismo evento puede servir a varios hitos (ej. una capacitación de
// HubSpot cubre listas, fichas y actividades).
function matchHitos(events: CalEvent[], ingreso: string | null): Record<string, CalEvent> {
  const out: Record<string, CalEvent> = {};
  const expected = (h: Hito) => (ingreso ? addDays(ingreso, h.d - 1).getTime() : null);
  for (const h of HITOS) {
    if (!h.k?.length) continue;
    const keys = h.k.map(norm);
    const cands = events.filter((ev) => keys.some((k) => norm(ev.title).includes(k)));
    if (!cands.length) continue;
    const exp = expected(h);
    // Sin fecha de ingreso: el primero. Con fecha: el más cercano, siempre
    // que caiga a menos de 3 semanas de lo esperado (evita calzar un 1:1 del
    // mes 3 con el del mes 1).
    let best: CalEvent | null = null;
    let bestDist = Infinity;
    for (const ev of cands) {
      const dist = exp == null ? 0 : Math.abs(new Date(ev.start).getTime() - exp);
      if (dist < bestDist) {
        best = ev;
        bestDist = dist;
      }
    }
    if (best && (exp == null || bestDist <= 21 * 864e5)) {
      out[h.id] = best;
      if (!best.hito) best.hito = h.id;
    }
  }
  return out;
}

// Datos públicos de la cuenta de servicio para configurar la delegación en
// admin.google.com (el client_id no es secreto; la clave privada nunca sale).
export function serviceAccountInfo(): { clientId: string | null; email: string | null; scope: string } {
  try {
    const c = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "{}");
    return { clientId: c.client_id ? String(c.client_id) : null, email: c.client_email ? String(c.client_email) : null, scope: SCOPE };
  } catch {
    return { clientId: null, email: null, scope: SCOPE };
  }
}

// Prueba el calendario de un correo sin caché (para el botón "Probar").
export async function testCalendar(email: string) {
  const r = await loadOnboardingCalendar(email, null, true);
  return r.status === "ok" ? { ok: true, msg: `Calendario conectado: ${r.events.length} eventos del onboarding encontrados.` } : { ok: false, msg: r.msg };
}

// Sugerencia de fecha de ingreso: el día del evento "Bienvenida".
export function suggestIngreso(cal: CalendarResult): string | null {
  const ev = cal.byHito["d1"] ?? cal.events.find((x) => norm(x.title).includes("bienvenida"));
  return ev ? ev.start.slice(0, 10) : null;
}
