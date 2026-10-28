import { supabaseAdmin } from "@/lib/supabase";
import { fetchHSOwners } from "@/lib/hubspot";
import { chileToday } from "@/lib/celulasSdr/calendar";
import { CO_ORDER, CT_ORDER, EXCLUDE } from "../dictionaries";
import { deriveClientData, type FlatCompany, type FlatContact } from "../derive";
import type { RadarActivity, RadarDataset, RadarDeal, RadarMeeting } from "../types";
import { loadActivities } from "./activities";
import { batchAssociations, batchRead, dealStages, detectProperties, loadPropertyCatalog, normLabel, searchAll, type DetectedProperty } from "./hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig, saveSnapshot } from "./store";
import { checkClientActive } from "./masterClients";

// Radar ABM — sincronización de un cliente desde HubSpot (§3).
// Empresas del universo del cliente (propiedad "Cliente BullsEye", o todas
// las que tienen status si se lee el HubSpot propio del cliente) → sus
// contactos con "Asignación BullsEye por Llamar" → llamadas, correos,
// WhatsApp/LinkedIn, reuniones y negocios asociados. El resultado se guarda
// completo en radar_abm_snapshots y las pantallas calculan en el navegador.
// Lo que no exista en HubSpot queda vacío y el informe muestra
// "Sin información disponible" (§11).

const toDay = (v: string | null | undefined): string | undefined => {
  if (!v) return undefined;
  const d = /^\d+$/.test(v) ? new Date(Number(v)) : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

// Textos oficiales: el valor de HubSpot se lleva al texto exacto del
// diccionario aunque venga con otra capitalización, sin tilde o sin emoji.
const canon = (s: string) => normLabel(s.replace(/\p{Extended_Pictographic}/gu, ""));
function canonicalizer(official: string[], aliases: Record<string, string> = {}) {
  const map = new Map(official.map((o) => [canon(o), o]));
  for (const [from, to] of Object.entries(aliases)) map.set(canon(from), to);
  return (label: string | null | undefined): string | null => {
    const t = (label ?? "").trim();
    if (!t) return null;
    return map.get(canon(t)) ?? t;
  };
}

function optionLabeler(p: DetectedProperty | undefined) {
  const m = new Map((p?.options ?? []).map((o) => [o.value, o.label]));
  return (v: string | null | undefined): string | null => {
    if (v == null || v === "") return null;
    return v.split(";").map((x) => m.get(x) ?? x).join("; ");
  };
}

function meetingStatus(outcome: string | null | undefined): string {
  switch ((outcome ?? "").toUpperCase()) {
    case "COMPLETED": return "Realizada";
    case "NO_SHOW": return "No-show";
    case "CANCELED":
    case "CANCELLED": return "Cancelada";
    case "RESCHEDULED": return "Reprogramada";
    default: return "Pendiente";
  }
}

function dealStageName(info: { label: string; won: boolean; lost: boolean } | undefined, raw: string): string {
  if (info?.won) return "Ganado";
  if (info?.lost) return "Perdido";
  const l = normLabel(info?.label ?? raw);
  if (/propuesta|proposal|cotizac/.test(l)) return "Propuesta enviada";
  if (/negoci/.test(l)) return "Negociación";
  return "Calificación";
}

function periodStart(today: string, months: number): string {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - (months - 1));
  return d.toISOString().slice(0, 10);
}

export async function syncClientRadar(clientId: string, by: string) {
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id, name, slug").eq("id", clientId).maybeSingle();
  if (!client) throw new Error("Cliente no encontrado");
  // Solo clientes activos en la Maestra (Maestra IA → Status Cliente)
  const master = await checkClientActive(client);
  if (!master.active) throw new Error(master.reason);

  const cfg = await loadRadarConfig();
  const settings = await loadClientSettings(clientId);
  const token = await hubspotTokenFor(clientId, settings.hubspot_source);
  const warnings: string[] = [];

  const { catalog, errors } = await loadPropertyCatalog(token);
  warnings.push(...errors);
  const detected = detectProperties(effectiveProperties(cfg, settings), catalog, client.name);
  const P = Object.fromEntries(detected.map((d) => [d.key, d])) as Record<string, DetectedProperty>;
  // Dónde se corrige el mapeo según el HubSpot que se lee
  const where = settings.hubspot_source === "client" ? " en el HubSpot del cliente" : "";
  if (!P.companyStatus.property) {
    const n = P.companyStatus.candidates.length;
    throw new Error(n
      ? `No se pudo elegir cuál de las ${n} propiedades "Status de la asignación - …" es la de ${client.name}${where}. Elígela en Configuración → Cliente → Radar ABM.`
      : `No se encontró ninguna propiedad de empresa "Status de la asignación - …"${where}. Indica su nombre interno en Configuración → Cliente → Radar ABM.`);
  }
  if (!P.contactStatus.property) {
    const n = P.contactStatus.candidates.length;
    throw new Error(n
      ? `No se pudo elegir cuál de las ${n} propiedades "Asignación BullsEye por Llamar - …" es la de ${client.name}${where}. Elígela en Configuración → Cliente → Radar ABM.`
      : `No se encontró ninguna propiedad de contacto "Asignación BullsEye por Llamar - …"${where}. Indica su nombre interno en Configuración → Cliente → Radar ABM.`);
  }
  for (const d of detected) if (d.manual && !d.found) warnings.push(`El nombre interno "${d.property}" de "${d.label}" no existe${where}.`);
  // Sin SDR por cliente se usa el propietario del registro: no es un aviso
  for (const d of detected) if (!d.property && !d.required && !["companyClient", "companySdr", "contactSdr", "companyWishlist"].includes(d.key)) warnings.push(`Propiedad "${d.label}" no encontrada: lo que depende de ella se muestra como "Sin información disponible".`);

  // ── Universo de empresas ───────────────────────────────────────────────
  // Empresas con la propiedad de status del cliente con algún valor. Si se
  // fijó un valor de "Cliente BullsEye", además deben tenerlo.
  const statusProp = P.companyStatus.property!;
  const filters: unknown[] = [{ propertyName: statusProp, operator: "HAS_PROPERTY" }];
  const clientProp = P.companyClient;
  const clientValue = (settings.hubspot_client_value ?? "").trim();
  if (clientValue && clientProp.property) {
    filters.push({ propertyName: clientProp.property, operator: clientProp.fieldType === "checkbox" ? "CONTAINS_TOKEN" : "EQ", value: clientValue });
  } else if (clientValue) {
    warnings.push('Hay un valor de "Cliente BullsEye" configurado, pero la propiedad no existe en este HubSpot: se ignoró.');
  }
  const filterGroups = [{ filters }];

  const countryProp = P.companyCountry.property ?? "country";
  const companyProps = Array.from(new Set([
    "name", "industry", "country", "numberofemployees", "hubspot_owner_id", "createdate", statusProp, countryProp,
    ...[P.companyAssignedAt, P.companyNextFollowUp, P.companyIcpTier, P.companySdr, P.companyWishlist].map((p) => p.property).filter(Boolean) as string[],
  ]));
  const rawCompanies = await searchAll("companies", filterGroups, companyProps, token);

  const owners = new Map<string, string>();
  try {
    for (const o of await fetchHSOwners(token)) owners.set(String(o.id), [o.firstName, o.lastName].filter(Boolean).join(" ").trim() || o.email || String(o.id));
  } catch (e) {
    warnings.push(`No se pudieron leer los usuarios de HubSpot (SDR): ${(e as Error).message}`);
  }
  const ownerName = (id: string | null | undefined) => (id ? owners.get(String(id)) ?? null : null);
  // SDR por cliente ("SDR - <cliente>" / "SDR Asignado - <cliente>"); sin
  // valor, el propietario del registro
  const companySdrLabel = optionLabeler(P.companySdr);
  const contactSdrLabel = optionLabeler(P.contactSdr);
  const wishlistLabel = optionLabeler(P.companyWishlist);

  const industryLabel = optionLabeler((catalog.companies ?? []).find((p) => p.name === "industry") as DetectedProperty | undefined);
  const statusLabel = optionLabeler(P.companyStatus);
  const tierLabel = optionLabeler(P.companyIcpTier);
  const countryLabel = optionLabeler((catalog.companies ?? []).find((p) => p.name === countryProp) as DetectedProperty | undefined);
  const unknownStatuses = new Set<string>();
  // Equivalencias de status (La Biblia + Configuración del Radar ABM)
  const companyStatusCanon = canonicalizer(CO_ORDER.filter((s) => s !== "CONV"), cfg.companyAliases);
  let excludedCompanies = 0;

  const companies: FlatCompany[] = [];
  for (const r of rawCompanies) {
    const p = r.properties;
    const label = statusLabel(p[statusProp]);
    if (!label) continue; // sin status: no es parte del trabajo de BullsEye
    const st = companyStatusCanon(label)!;
    if (st === EXCLUDE) { excludedCompanies++; continue; } // ej. "No gestionar - Cliente"
    if (!st.startsWith("En conversaciones") && !CO_ORDER.includes(st)) unknownStatuses.add(st);
    const tier = (tierLabel(P.companyIcpTier.property ? p[P.companyIcpTier.property] : null) ?? "").trim().toUpperCase().replace(/^(ICP|TIER)\s*/, "");
    companies.push({
      id: r.id,
      n: p.name || `Empresa ${r.id}`,
      ind: industryLabel(p.industry),
      pais: countryLabel(p[countryProp]) || countryLabel(p.country) || "Sin país",
      employees: p.numberofemployees ? Number(p.numberofemployees) : null,
      icp: ["A", "B", "C"].includes(tier) ? tier : "s/i",
      sdr: (P.companySdr.property ? companySdrLabel(p[P.companySdr.property]) : null) ?? ownerName(p.hubspot_owner_id) ?? "Sin SDR",
      asg: toDay(P.companyAssignedAt.property ? p[P.companyAssignedAt.property] : null) ?? toDay(p.createdate) ?? "",
      st,
      ...(P.companyWishlist.property && wishlistLabel(p[P.companyWishlist.property]) ? { wl: wishlistLabel(p[P.companyWishlist.property])! } : {}),
      ...(P.companyNextFollowUp.property && toDay(p[P.companyNextFollowUp.property]) ? { next: toDay(p[P.companyNextFollowUp.property]) } : {}),
    });
  }
  const companyIds = companies.map((c) => c.id as string);
  const coById = new Map(companies.map((c) => [c.id, c]));

  // ── Contactos ──────────────────────────────────────────────────────────
  const coContacts = await batchAssociations("companies", "contacts", companyIds, token);
  const contactCompany = new Map<string, string>();
  for (const [co, cts] of coContacts) for (const ct of cts) if (!contactCompany.has(ct)) contactCompany.set(ct, co);
  const contactStatusProp = P.contactStatus.property!;
  const contactProps = Array.from(new Set([
    "firstname", "lastname", "email", "jobtitle", "hubspot_owner_id", "notes_last_contacted", "notes_next_activity_date", contactStatusProp,
    ...[P.contactObjection, P.contactSignal, P.contactSdr].map((p) => p.property).filter(Boolean) as string[],
  ]));
  const rawContacts = await batchRead("contacts", Array.from(contactCompany.keys()), contactProps, token);
  const ctStatusLabel = optionLabeler(P.contactStatus);
  // Etiquetas antiguas de contacto ("Por Llamar", "NO Llamar"…) → actuales
  // (editables en Configuración del Radar ABM)
  const contactStatusCanon = canonicalizer(CT_ORDER, cfg.contactAliases);
  const objLabel = optionLabeler(P.contactObjection);
  const sigLabel = optionLabeler(P.contactSignal);
  const unknownCtStatuses = new Set<string>();
  // Con status y sin equivalencia "Excluir del informe" (ej. ya no trabaja ahí)
  const kept = rawContacts.filter((r) => {
    const label = ctStatusLabel(r.properties[contactStatusProp]);
    return !!label && contactStatusCanon(label) !== EXCLUDE;
  });
  const excludedContacts = rawContacts.filter((r) => { const l = ctStatusLabel(r.properties[contactStatusProp]); return !!l && contactStatusCanon(l) === EXCLUDE; }).length;
  const keptIds = kept.map((r) => r.id);

  // ── Actividades de la cuenta (empresa + contactos): profundidad por canal
  const act = await loadActivities({ companyIds, contactIds: keptIds, contactCompany, catalog, token });
  warnings.push(...act.warnings);
  const ctMeetings = act.contactMeetings;
  const actByCt = new Map<string, RadarActivity[]>();
  for (const a of act.activities) {
    if (a.ct == null) continue;
    const arr = actByCt.get(String(a.ct)) ?? [];
    arr.push(a);
    actByCt.set(String(a.ct), arr);
  }

  const contacts: FlatContact[] = kept.map((r) => {
    const p = r.properties;
    const st = contactStatusCanon(ctStatusLabel(p[contactStatusProp]))!;
    if (!CT_ORDER.includes(st)) unknownCtStatuses.add(st);
    const co = contactCompany.get(r.id)!;
    // Conteos por contacto desde sus actividades (intentos = llamadas telefónicas)
    const acts = actByCt.get(r.id) ?? [];
    const calls = acts.filter((a) => a.k === "call").length;
    const conv = acts.filter((a) => a.conn).length;
    const wa = acts.filter((a) => a.k === "wa").length;
    const li = acts.filter((a) => a.k === "li").length;
    const em = acts.filter((a) => a.k === "em").length;
    const lastAct = acts.reduce((m, a) => (a.d && a.d > m ? a.d : m), "");
    const name = [p.firstname, p.lastname].filter(Boolean).join(" ").trim() || p.email || `Contacto ${r.id}`;
    const obj = objLabel(P.contactObjection.property ? p[P.contactObjection.property] : null);
    const sig = sigLabel(P.contactSignal.property ? p[P.contactSignal.property] : null);
    return {
      id: r.id, co, n: name,
      ...(p.jobtitle ? { cargo: p.jobtitle } : {}),
      sdr: (P.contactSdr.property ? contactSdrLabel(p[P.contactSdr.property]) : null) ?? ownerName(p.hubspot_owner_id) ?? coById.get(co)?.sdr ?? "Sin SDR",
      st,
      ...(calls ? { att: calls, calls } : {}),
      ...(conv ? { conv } : {}),
      ...(wa ? { wa } : {}), ...(li ? { li } : {}), ...(em ? { em } : {}),
      ...(toDay(p.notes_last_contacted) || lastAct ? { last: toDay(p.notes_last_contacted) ?? lastAct } : {}),
      ...(toDay(p.notes_next_activity_date) ? { next: toDay(p.notes_next_activity_date) } : {}),
      ...(obj ? { obj } : {}), ...(sig ? { sig } : {}),
    };
  });

  // Empresa sin SDR: el más frecuente entre sus contactos
  const ctSdrByCo = new Map<string | number, Map<string, number>>();
  for (const k of contacts) {
    if (k.sdr === "Sin SDR") continue;
    const m = ctSdrByCo.get(k.co) ?? new Map<string, number>();
    m.set(k.sdr, (m.get(k.sdr) ?? 0) + 1);
    ctSdrByCo.set(k.co, m);
  }
  for (const c of companies) {
    if (c.sdr !== "Sin SDR") continue;
    const m = ctSdrByCo.get(c.id);
    if (m) c.sdr = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── Reuniones del período ──────────────────────────────────────────────
  const today = chileToday();
  const start = periodStart(today, cfg.periodMonths);
  const meetingContact = new Map<string, string>();
  for (const [ct, ms] of ctMeetings) for (const m of ms) if (!meetingContact.has(m)) meetingContact.set(m, ct);
  const meetingProps = Array.from(new Set([
    "hs_meeting_start_time", "hs_createdate", "hs_meeting_outcome", "hubspot_owner_id",
    ...[P.meetingResult, P.meetingFeedback, P.meetingNeed].map((p) => p.property).filter(Boolean) as string[],
  ]));
  const rawMeetings = meetingContact.size ? await batchRead("meetings", Array.from(meetingContact.keys()), meetingProps, token) : [];
  const resLabel = optionLabeler(P.meetingResult), fbLabel = optionLabeler(P.meetingFeedback), needLabel = optionLabeler(P.meetingNeed);
  const ctById = new Map(contacts.map((k) => [k.id, k]));
  const meetings: RadarMeeting[] = [];
  for (const r of rawMeetings) {
    const p = r.properties;
    const ct = meetingContact.get(r.id)!;
    const k = ctById.get(ct);
    if (!k) continue;
    const fecha = toDay(p.hs_meeting_start_time) ?? toDay(p.hs_createdate);
    const agendada = toDay(p.hs_createdate) ?? fecha;
    if (!fecha || !agendada) continue;
    if (agendada < start && fecha < start) continue;
    const st = meetingStatus(p.hs_meeting_outcome);
    const res = resLabel(P.meetingResult.property ? p[P.meetingResult.property] : null);
    const fb = fbLabel(P.meetingFeedback.property ? p[P.meetingFeedback.property] : null);
    const need = needLabel(P.meetingNeed.property ? p[P.meetingNeed.property] : null);
    meetings.push({
      id: r.id, ct, co: k.co, sdr: (P.contactSdr.property ? k.sdr : ownerName(p.hubspot_owner_id)) ?? k.sdr, agendada, fecha, st,
      ...(st === "Reprogramada" ? { reprog: true } : {}),
      ...(res ? { res } : {}), ...(fb ? { fb } : {}), ...(need ? { need } : {}),
    });
  }

  // ── Negocios ───────────────────────────────────────────────────────────
  let deals: RadarDeal[] = [];
  try {
    const coDeals = await batchAssociations("companies", "deals", companyIds, token);
    const dealCompany = new Map<string, string>();
    for (const [co, ds] of coDeals) for (const d of ds) if (!dealCompany.has(d)) dealCompany.set(d, co);
    if (dealCompany.size) {
      const stages = await dealStages(token);
      const raw = await batchRead("deals", Array.from(dealCompany.keys()), ["dealstage", "amount", "createdate"], token);
      deals = raw.map((r) => ({
        co: dealCompany.get(r.id)!,
        stage: dealStageName(stages.get(r.properties.dealstage ?? ""), r.properties.dealstage ?? ""),
        amount: Number(r.properties.amount) || 0,
        created: toDay(r.properties.createdate) ?? "",
      }));
    }
  } catch (e) {
    warnings.push(`No se pudieron leer los negocios: ${(e as Error).message}`);
  }

  if (excludedCompanies || excludedContacts) warnings.push(`Excluidos del informe por equivalencia: ${excludedCompanies} empresas y ${excludedContacts} contactos (Configuración del Radar ABM → Equivalencias).`);
  if (unknownStatuses.size) warnings.push(`Status de empresa fuera del diccionario (agrega su equivalencia en Configuración del Radar ABM): ${Array.from(unknownStatuses).join(", ")}.`);
  if (unknownCtStatuses.size) warnings.push(`Status de contacto fuera del diccionario (agrega su equivalencia en Configuración del Radar ABM): ${Array.from(unknownCtStatuses).join(", ")}.`);
  if (!companies.length) warnings.push("No se encontraron empresas con status para este cliente en HubSpot.");

  const clientData = deriveClientData({
    name: client.name,
    deep: settings.deep ?? undefined,
    pipeline: settings.pipeline ?? deals.length > 0,
    companies, contacts, meetings, deals, cfg, today,
  });
  clientData.activities = act.activities;

  const dataset: RadarDataset = {
    client: clientData,
    generated: today,
    period: [start, today],
    source: "hubspot",
    syncedAt: new Date().toISOString(),
    warnings,
    mapping: detected.map((d) => ({ label: d.label, property: d.property })),
  };
  const stats = {
    companies: companies.length,
    contacts: contacts.length,
    meetings: meetings.length,
    deals: deals.length,
    calls: contacts.reduce((n, k) => n + (k.calls ?? 0), 0),
    activities: act.activities.length,
    excludedCompanies,
    excludedContacts,
  };
  await saveSnapshot(clientId, dataset, stats, by);
  return { stats, warnings, syncedAt: dataset.syncedAt };
}
