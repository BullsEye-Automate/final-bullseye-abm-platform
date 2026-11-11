// Calidad de carga: mide los contactos que prospección carga (importa) al
// HubSpot del cliente, que son el insumo de los SDR.
// - Fit ICP: cargo frente al buyer persona del cliente (misma IA y caché que
//   Contactos IA, scoreTitlesForClient). Calza = fit ≥ 60, como Contactos IA.
// - Teléfonos: números distintos por contacto entre Phone, Mobile, Teléfono
//   Lemlist, Clay, Lusha y otros campos de teléfono.
// - Calidad: puntaje 0–100 de completitud (fit, teléfono, correo, LinkedIn,
//   empresa asociada).
// - Probabilidad de agendamiento: tasa histórica de "Reunión Agendada" de los
//   contactos importados del mismo cliente hace 30–180 días, por segmento
//   (fit × tiene teléfono); se aplica a cada carga nueva.
// Solo lectura en HubSpot. El resultado se cachea 6 h (allo_response_cache).
import { supabaseAdmin } from "@/lib/supabase";
import { readMonthCache, writeMonthCache } from "@/lib/celulasSdr/cache";
import { detectProperties, loadPropertyCatalog, normLabel, searchAll, type DetectedProperty } from "@/lib/radarAbm/server/hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig } from "@/lib/radarAbm/server/store";
import { normTitle, scoreTitlesForClient } from "@/lib/wishlistContacts";

export const FIT_OK = 60;
export const FIT_PARTIAL = 40;
const HISTORY_FROM_DAYS = 180;
const HISTORY_TO_DAYS = 30;
const MAX_CURRENT = 6000;
const MAX_HISTORY = 6000;
const HISTORY_TITLES = 800; // cargos del historial que se evalúan (los más frecuentes)
const MIN_SEGMENT = 25; // contactos mínimos para usar la tasa de un segmento
const CACHE_MS = 6 * 3600_000;
// Campos de teléfono del contacto (se usan los que existan en el HubSpot)
const PHONE_PROPS: { name: string; label: string }[] = [
  { name: "phone", label: "Teléfono" },
  { name: "mobilephone", label: "Móvil" },
  { name: "telefono_lemlist", label: "Lemlist" },
  { name: "bullseye_telefono_clay", label: "Clay" },
  { name: "bullseye_telefono_lusha", label: "Lusha" },
  { name: "phone_4", label: "Teléfono 4" },
  { name: "hs_whatsapp_phone_number", label: "WhatsApp" },
];

export type FitBand = "calza" | "parcial" | "no_calza" | "sin_cargo" | "sin_icp";
export type CargaContact = {
  id: string; name: string; title: string; company: string; created: string; day: string;
  fit: number | null; band: FitBand; role: string | null; reason: string;
  phones: number; phoneSources: string[]; lemlist: boolean; email: boolean; linkedin: boolean; hasCompany: boolean;
  quality: number; prob: number; status: string | null; contacted: boolean; positive: boolean; meeting: boolean;
};
export type CargaLoad = {
  day: string; contacts: number;
  calza: number; parcial: number; noCalza: number; sinCargo: number;
  withPhone: number; phonesAvg: number; withLemlist: number; withEmail: number; withLinkedin: number; withCompany: number;
  quality: number; prob: number; expectedMeetings: number;
  contacted: number; positive: number; meetings: number;
};
export type CargaReport = {
  client: { id: string; name: string };
  from: string; to: string; generatedAt: string;
  hasIcp: boolean; statusProp: string | null; phoneProps: string[];
  totals: CargaLoad;
  loads: CargaLoad[];
  contacts: CargaContact[];
  history: { contacts: number; meetings: number; rate: number; segments: { key: string; label: string; n: number; meetings: number; rate: number }[] };
  phoneSources: { label: string; contacts: number }[];
  warnings: string[];
};

const chileDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const bandOf = (fit: number | null, title: string, hasIcp: boolean): FitBand =>
  !title ? "sin_cargo" : !hasIcp || fit == null ? "sin_icp" : fit >= FIT_OK ? "calza" : fit >= FIT_PARTIAL ? "parcial" : "no_calza";
// Estado del contacto ("Asignación BullsEye por llamar - <cliente>")
const isMeeting = (s: string | null) => !!s && /reuni/i.test(s);
const isPositive = (s: string | null) => !!s && /reuni|seguimiento|refiere/i.test(s);
const isContacted = (s: string | null) => !!s && !/por gestionar|^buscar|sin informaci/i.test(s);
const segKey = (band: FitBand, phone: boolean) => `${band === "calza" ? "calza" : band === "parcial" ? "parcial" : "otro"}|${phone ? "tel" : "sintel"}`;
const SEG_LABEL: Record<string, string> = {
  "calza|tel": "Calza con el ICP · con teléfono", "calza|sintel": "Calza con el ICP · sin teléfono",
  "parcial|tel": "Calce parcial · con teléfono", "parcial|sintel": "Calce parcial · sin teléfono",
  "otro|tel": "No calza / sin cargo · con teléfono", "otro|sintel": "No calza / sin cargo · sin teléfono",
};

export async function getCargaReport(clientId: string, days: number, fresh = false): Promise<CargaReport> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const key = `calidad_carga:v1:${clientId}:${days}:${chileDay(to.toISOString())}`;
  if (!fresh) {
    const hit = await readMonthCache<CargaReport>(key);
    if (hit && Date.now() - new Date(hit.generatedAt).getTime() < CACHE_MS) return hit;
  }
  const r = await buildReport(clientId, from, to);
  await writeMonthCache(key, r, CACHE_MS);
  return r;
}

async function buildReport(clientId: string, from: Date, to: Date): Promise<CargaReport> {
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Cliente no encontrado");
  const warnings: string[] = [];
  const [cfg, settings] = await Promise.all([loadRadarConfig(), loadClientSettings(clientId)]);
  const token = await hubspotTokenFor(clientId, settings.hubspot_source);
  const { catalog, errors } = await loadPropertyCatalog(token);
  warnings.push(...errors);
  const detected = detectProperties(effectiveProperties(cfg, settings), catalog, client.name);
  const P = Object.fromEntries(detected.map((d) => [d.key, d])) as Record<string, DetectedProperty>;
  const statusProp = P.contactStatus?.found ? P.contactStatus.property : null;
  const statusLabel = new Map((P.contactStatus?.options ?? []).map((o) => [o.value, o.label]));
  const contactsCat = catalog.contacts ?? [];
  const has = (n: string) => contactsCat.some((p) => p.name === n);
  const phoneProps = PHONE_PROPS.filter((p) => has(p.name));

  // Contactos del cliente: en el HubSpot de BullsEye, "Cliente BullsEye" = el
  // cliente (o, si no calza, los que tienen su status de asignación); en el
  // HubSpot propio del cliente, todos los importados
  const base: unknown[] = [{ propertyName: "hs_object_source", operator: "EQ", value: "IMPORT" }];
  if (settings.hubspot_source !== "client") {
    const uniCt = contactsCat.find((p) => p.name === (settings.properties?.universeContactClient || "cliente_bullseye"));
    const want = normLabel((settings.hubspot_client_value ?? "").trim() || client.name).replace(/ /g, "");
    const opt = uniCt?.options?.find((o) => {
      const l = normLabel(o.label).replace(/ /g, ""), v = normLabel(o.value).replace(/ /g, "");
      return l === want || v === want || (l.length >= 4 && want.length >= 4 && (l.startsWith(want) || want.startsWith(l)));
    });
    if (uniCt && opt) base.push({ propertyName: uniCt.name, operator: uniCt.fieldType === "checkbox" ? "CONTAINS_TOKEN" : "EQ", value: opt.value });
    else if (statusProp) {
      base.push({ propertyName: statusProp, operator: "HAS_PROPERTY" });
      warnings.push(`"Cliente BullsEye" no tiene una opción para ${client.name}: se usan los contactos con "${P.contactStatus.propLabel}".`);
    } else throw new Error(`No se pudo identificar los contactos de ${client.name} en HubSpot (sin "Cliente BullsEye" ni "Asignación BullsEye por llamar").`);
  }
  const props = Array.from(new Set([
    "firstname", "lastname", "jobtitle", "company", "email", "hs_linkedin_url", "associatedcompanyid", "createdate",
    ...phoneProps.map((p) => p.name), ...(statusProp ? [statusProp] : []),
  ]));
  const range = (a: Date, b: Date) => [{ filters: [...base, { propertyName: "createdate", operator: "BETWEEN", value: String(a.getTime()), highValue: String(b.getTime()) }] }];
  const histTo = new Date(to.getTime() - HISTORY_TO_DAYS * 86400_000);
  const histFrom = new Date(to.getTime() - HISTORY_FROM_DAYS * 86400_000);
  const [cur, hist] = await Promise.all([
    searchAll("contacts", range(from, to), props, token, MAX_CURRENT),
    searchAll("contacts", range(histFrom, histTo), props, token, MAX_HISTORY),
  ]);
  if (cur.length >= MAX_CURRENT) warnings.push(`Se leyeron los primeros ${MAX_CURRENT} contactos del período.`);

  // Fit de cargos (caché compartido con Contactos IA)
  // Todos los cargos del período + los más frecuentes del historial (tope
  // HISTORY_TITLES); se evalúan en tandas para no lanzar decenas de llamadas
  // a la IA a la vez (cada tanda = ~10 llamadas en paralelo)
  const freq = new Map<string, number>();
  for (const c of hist) { const t = normTitle(c.properties.jobtitle ?? ""); if (t) freq.set(t, (freq.get(t) ?? 0) + 1); }
  const histTitles = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, HISTORY_TITLES).map(([t]) => t);
  const allTitles = Array.from(new Set([...cur.map((c) => normTitle(c.properties.jobtitle ?? "")).filter(Boolean), ...histTitles]));
  const scores = new Map<string, Awaited<ReturnType<typeof scoreTitlesForClient>>["scores"] extends Map<string, infer V> ? V : never>();
  let hasIcp = true;
  for (let i = 0; i < allTitles.length && hasIcp; i += 300) {
    const r = await scoreTitlesForClient(db, clientId, allTitles.slice(i, i + 300));
    hasIcp = r.hasIcp;
    r.scores.forEach((v, k) => scores.set(k, v));
  }
  if (!allTitles.length) hasIcp = (await scoreTitlesForClient(db, clientId, [])).hasIcp;
  if (!hasIcp) warnings.push("El cliente no tiene ICP / buyer persona cargado: no se puede medir el calce con el ICP.");

  const toContact = (r: { id: string; properties: Record<string, string | null> }): Omit<CargaContact, "quality" | "prob"> => {
    const p = r.properties;
    const title = (p.jobtitle ?? "").trim();
    const sc = title ? scores.get(normTitle(title)) : undefined;
    const fit = sc ? sc.fit_score : null;
    const nums = new Map<string, string[]>();
    for (const pp of phoneProps) {
      const d = digits(p[pp.name]);
      if (d.length < 7) continue;
      const k = d.slice(-9); // mismo número con o sin código de país
      nums.set(k, [...(nums.get(k) ?? []), pp.label]);
    }
    const status = statusProp ? (p[statusProp] ? statusLabel.get(p[statusProp]!) ?? p[statusProp] : null) : null;
    const created = p.createdate ?? "";
    return {
      id: r.id, name: [p.firstname, p.lastname].filter(Boolean).join(" ") || "(sin nombre)", title, company: p.company ?? "",
      created, day: created ? chileDay(created) : "",
      fit, band: bandOf(fit, title, hasIcp), role: sc?.buying_role ?? null, reason: sc?.reason ?? "",
      phones: nums.size, phoneSources: Array.from(new Set(Array.from(nums.values()).flat())),
      lemlist: !!digits(p.telefono_lemlist), email: !!p.email, linkedin: !!p.hs_linkedin_url, hasCompany: !!p.associatedcompanyid,
      status, contacted: isContacted(status), positive: isPositive(status), meeting: isMeeting(status),
    };
  };
  // Puntaje de calidad (0–100): fit 35, teléfono 30, correo 15, LinkedIn 10, empresa 10
  const qualityOf = (c: Omit<CargaContact, "quality" | "prob">) =>
    Math.round((c.band === "calza" ? 35 : c.band === "parcial" ? 17 : c.band === "sin_icp" ? 17 : 0) + (c.phones ? 30 : 0) + (c.email ? 15 : 0) + (c.linkedin ? 10 : 0) + (c.hasCompany ? 10 : 0));

  // Historia: tasa de reunión por segmento
  const H = hist.map(toContact);
  const overall = H.length ? H.filter((c) => c.meeting).length / H.length : 0;
  const segStats = new Map<string, { n: number; m: number }>();
  for (const c of H) {
    if (hasIcp && c.band === "sin_icp") continue; // cargo poco frecuente sin evaluar: solo cuenta en la tasa general
    const k = segKey(c.band, c.phones > 0);
    const s = segStats.get(k) ?? { n: 0, m: 0 };
    s.n++; if (c.meeting) s.m++;
    segStats.set(k, s);
  }
  const phoneStats = (tel: boolean) => { const a = H.filter((c) => (c.phones > 0) === tel); return a.length >= MIN_SEGMENT ? a.filter((c) => c.meeting).length / a.length : null; };
  const telRate = { true: phoneStats(true), false: phoneStats(false) };
  const probOf = (c: Omit<CargaContact, "quality" | "prob">) => {
    const s = segStats.get(segKey(c.band, c.phones > 0));
    if (s && s.n >= MIN_SEGMENT) return s.m / s.n;
    return telRate[String(c.phones > 0) as "true" | "false"] ?? overall;
  };
  if (!H.length) warnings.push("No hay contactos importados de hace 1 a 6 meses para estimar la probabilidad de agendamiento.");
  else if (!statusProp) warnings.push('No se encontró la propiedad "Asignación BullsEye por llamar": no se puede medir el avance ni la probabilidad.');

  const contacts: CargaContact[] = cur.map(toContact).map((c) => ({ ...c, quality: qualityOf(c), prob: probOf(c) }))
    .sort((a, b) => b.created.localeCompare(a.created));

  const agg = (A: CargaContact[], day: string): CargaLoad => {
    const n = A.length || 1, cnt = (f: (c: CargaContact) => boolean) => A.filter(f).length;
    const expected = A.reduce((s, c) => s + c.prob, 0);
    return {
      day, contacts: A.length,
      calza: cnt((c) => c.band === "calza"), parcial: cnt((c) => c.band === "parcial"), noCalza: cnt((c) => c.band === "no_calza"), sinCargo: cnt((c) => c.band === "sin_cargo"),
      withPhone: cnt((c) => c.phones > 0), phonesAvg: A.reduce((s, c) => s + c.phones, 0) / n, withLemlist: cnt((c) => c.lemlist),
      withEmail: cnt((c) => c.email), withLinkedin: cnt((c) => c.linkedin), withCompany: cnt((c) => c.hasCompany),
      quality: Math.round(A.reduce((s, c) => s + c.quality, 0) / n), prob: A.length ? expected / A.length : 0, expectedMeetings: expected,
      contacted: cnt((c) => c.contacted), positive: cnt((c) => c.positive), meetings: cnt((c) => c.meeting),
    };
  };
  const byDay = new Map<string, CargaContact[]>();
  for (const c of contacts) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
  const loads = Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([d, A]) => agg(A, d));
  const srcCount = new Map<string, number>();
  for (const c of contacts) for (const s of c.phoneSources) srcCount.set(s, (srcCount.get(s) ?? 0) + 1);

  return {
    client: { id: client.id, name: client.name },
    from: from.toISOString(), to: to.toISOString(), generatedAt: new Date().toISOString(),
    hasIcp, statusProp: statusProp ? P.contactStatus.propLabel ?? statusProp : null, phoneProps: phoneProps.map((p) => p.label),
    totals: agg(contacts, "total"), loads, contacts,
    history: {
      contacts: H.length, meetings: H.filter((c) => c.meeting).length, rate: overall,
      segments: Array.from(segStats.entries()).map(([k, s]) => ({ key: k, label: SEG_LABEL[k] ?? k, n: s.n, meetings: s.m, rate: s.n ? s.m / s.n : 0 }))
        .sort((a, b) => b.rate - a.rate),
    },
    phoneSources: Array.from(srcCount.entries()).map(([label, n]) => ({ label, contacts: n })).sort((a, b) => b.contacts - a.contacts),
    warnings,
  };
}
