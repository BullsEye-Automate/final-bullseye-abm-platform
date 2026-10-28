import { supabaseAdmin } from "@/lib/supabase";
import { fetchHSOwners } from "@/lib/hubspot";
import { chileToday } from "@/lib/celulasSdr/calendar";
import { CO_ORDER, CT_ORDER, EXCLUDE } from "../dictionaries";
import { deriveClientData, type FlatCompany, type FlatContact } from "../derive";
import type { RadarActivity, RadarCallEval, RadarDataset, RadarDeal, RadarMeeting } from "../types";
import { loadActivities } from "./activities";
import { batchAssociations, batchRead, dealStages, detectProperties, loadPropertyCatalog, normLabel, searchAll, type DetectedProperty } from "./hubspot";
import { effectiveProperties, hubspotTokenFor, loadClientSettings, loadRadarConfig, meetingsTotal, saveSnapshot, universeMode } from "./store";
import { checkClientActive } from "./masterClients";
import { loadSheetMeetings } from "./sheetMeetings";
import { loadAlloMonth } from "@/lib/celulasSdr/server/allo";
import { periodMonths } from "../engine";

// Pulso ABM — sincronización de un cliente desde HubSpot (§3).
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

// Etapa de la empresa desde el ciclo de vida de HubSpot (modo Cliente
// BullsEye). "Asignada" se completa después con la actividad.
function lifecycleStatus(v: string | null | undefined, clientName: string): string {
  const x = (v ?? "").toLowerCase();
  if (x === "customer" || x === "evangelist") return "Clientes";
  if (x === "opportunity") return `En conversaciones con ${clientName}`;
  if (x === "other") return "Nutrir";
  return "Asignada";
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
  // Modo "Cliente BullsEye" (ej. el propio BullsEye): el universo sale de las
  // propiedades "Cliente BullsEye Empresa" / "Cliente BullsEye" con el valor del
  // cliente, sin Status de la asignación ni Asignación BullsEye por llamar; la
  // etapa sale del ciclo de vida de la empresa y de la actividad.
  const clientMode = universeMode(settings, client.name) === "client";
  const findProp = (obj: string, manual: string | undefined, names: string[], label: string) => {
    const list = catalog[obj] ?? [];
    return (manual ? list.find((x) => x.name === manual) : undefined)
      ?? names.map((n) => list.find((x) => x.name === n)).find(Boolean)
      ?? list.find((x) => normLabel(x.label) === normLabel(label));
  };
  // "Cliente BullsEye Empresa" / "Cliente BullsEye" (titular de la cuenta):
  // en todos los clientes se exige además que la empresa y el contacto sean
  // de este cliente (en el modo Cliente BullsEye es el único filtro)
  const uniCo = findProp("companies", settings.properties?.universeCompanyClient, ["cliente_bullseye_empresa"], "Cliente BullsEye Empresa");
  const uniCt = findProp("contacts", settings.properties?.universeContactClient, ["cliente_bullseye"], "Cliente BullsEye");
  const uniValue = (settings.hubspot_client_value ?? "").trim() || client.name;
  if (clientMode && !uniCo) throw new Error(`No se encontró la propiedad de empresa "Cliente BullsEye Empresa"${where}.`);
  if (clientMode && !uniCt) throw new Error(`No se encontró la propiedad de contacto "Cliente BullsEye"${where}.`);
  // Valor interno de la opción cuyo nombre es el del cliente
  // ("Acid Labs" ↔ "AcidLab": se compara sin espacios y por prefijo)
  const compact = (x: string) => normLabel(x).replace(/ /g, "");
  const matchOption = (prop: { options?: { value: string; label: string }[] } | undefined, v: string) => {
    const opts = prop?.options ?? [], c = compact(v);
    return opts.find((o) => compact(o.label) === c || compact(o.value) === c)
      ?? (c.length >= 4 ? opts.find((o) => { const l = compact(o.label); return l.length >= 4 && (l.startsWith(c) || c.startsWith(l)); }) : undefined);
  };
  const optionValue = (prop: { options?: { value: string; label: string }[] } | undefined, v: string) => matchOption(prop, v)?.value ?? v;
  const coOpt = matchOption(uniCo, uniValue), ctOpt = matchOption(uniCt, uniValue);
  if (!clientMode && uniCo && !coOpt) warnings.push(`"${uniCo.label}" no tiene la opción "${uniValue}": no se filtraron las empresas por cliente (ajusta el valor de "Cliente BullsEye" en Configuración → Cliente → Pulso ABM).`);
  if (!clientMode && uniCt && !ctOpt) warnings.push(`"${uniCt.label}" no tiene la opción "${uniValue}": no se filtraron los contactos por cliente.`);
  // El contacto es de este cliente (valor de "Cliente BullsEye"; admite varios con ;)
  const isClientContact = (raw: string | null | undefined) => {
    const v = (raw ?? "").split(";").map((x) => x.trim()).filter(Boolean);
    return ctOpt ? v.includes(ctOpt.value) : v.some((x) => compact(x) === compact(uniValue));
  };
  if (!clientMode && !P.companyStatus.property) {
    const n = P.companyStatus.candidates.length;
    throw new Error(n
      ? `No se pudo elegir cuál de las ${n} propiedades "Status de la asignación - …" es la de ${client.name}${where}. Elígela en Configuración → Cliente → Pulso ABM.`
      : `No se encontró ninguna propiedad de empresa "Status de la asignación - …"${where}. Indica su nombre interno en Configuración → Cliente → Pulso ABM.`);
  }
  if (!clientMode && !P.contactStatus.property) {
    const n = P.contactStatus.candidates.length;
    throw new Error(n
      ? `No se pudo elegir cuál de las ${n} propiedades "Asignación BullsEye por Llamar - …" es la de ${client.name}${where}. Elígela en Configuración → Cliente → Pulso ABM.`
      : `No se encontró ninguna propiedad de contacto "Asignación BullsEye por Llamar - …"${where}. Indica su nombre interno en Configuración → Cliente → Pulso ABM.`);
  }
  for (const d of detected) if (d.manual && !d.found) warnings.push(`El nombre interno "${d.property}" de "${d.label}" no existe${where}.`);
  // Sin SDR por cliente se usa el propietario del registro: no es un aviso
  for (const d of detected) if (!d.property && !d.required && !["companyClient", "companySdr", "contactSdr", "companyWishlist", "universeCompanyClient", "universeContactClient"].includes(d.key) && d.object !== "meetings") warnings.push(`Propiedad "${d.label}" no encontrada: lo que depende de ella se muestra como "Sin información disponible".`);

  // ── Universo de empresas ───────────────────────────────────────────────
  // Empresas con la propiedad de status del cliente con algún valor. Si se
  // fijó un valor de "Cliente BullsEye", además deben tenerlo.
  const statusProp = clientMode ? "lifecyclestage" : P.companyStatus.property!;
  const filters: unknown[] = clientMode
    ? [{ propertyName: uniCo!.name, operator: uniCo!.fieldType === "checkbox" ? "CONTAINS_TOKEN" : "EQ", value: optionValue(uniCo as any, uniValue) }]
    : [{ propertyName: statusProp, operator: "HAS_PROPERTY" }];
  const clientProp = P.companyClient;
  const clientValue = (settings.hubspot_client_value ?? "").trim();
  if (clientMode) {
    // el universo ya es la propiedad del cliente
  } else if (uniCo && coOpt) {
    // Titular de la cuenta: "Cliente BullsEye Empresa" = este cliente
    filters.push({ propertyName: uniCo.name, operator: uniCo.fieldType === "checkbox" ? "CONTAINS_TOKEN" : "EQ", value: coOpt.value });
  } else if (clientValue && clientProp.property) {
    filters.push({ propertyName: clientProp.property, operator: clientProp.fieldType === "checkbox" ? "CONTAINS_TOKEN" : "EQ", value: clientValue });
  } else if (clientValue) {
    warnings.push('Hay un valor de "Cliente BullsEye" configurado, pero la propiedad no existe en este HubSpot: se ignoró.');
  }
  const filterGroups = [{ filters }];

  const countryProp = P.companyCountry.property ?? "country";
  const companyProps = Array.from(new Set([
    "name", "domain", "industry", "country", "numberofemployees", "hubspot_owner_id", "createdate", statusProp, countryProp,
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
  // Equivalencias de status (La Biblia + Configuración del Pulso ABM)
  const companyStatusCanon = canonicalizer(CO_ORDER.filter((s) => s !== "CONV"), cfg.companyAliases);
  let excludedCompanies = 0;

  const companies: FlatCompany[] = [];
  const companyDomain = new Map<string, string>();
  const pendingStage = new Set<string>();
  for (const r of rawCompanies) {
    const p = r.properties;
    if (p.domain) companyDomain.set(String(r.id), p.domain);
    const label = clientMode ? lifecycleStatus(p.lifecyclestage, client.name) : statusLabel(p[statusProp]);
    if (!label) continue; // sin status: no es parte del trabajo de BullsEye
    const st = clientMode ? label : companyStatusCanon(label)!;
    if (clientMode && st === "Asignada") pendingStage.add(String(r.id)); // se completa con la actividad
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
  const contactStatusProp = clientMode ? uniCt!.name : P.contactStatus.property!;
  const contactProps = Array.from(new Set([
    "firstname", "lastname", "email", "jobtitle", "hubspot_owner_id", "notes_last_contacted", "notes_next_activity_date", contactStatusProp,
    ...(uniCt ? [uniCt.name] : []),
    ...[P.contactObjection, P.contactSignal, P.contactSdr].map((p) => p.property).filter(Boolean) as string[],
  ]));
  const rawContacts = await batchRead("contacts", Array.from(contactCompany.keys()), contactProps, token);
  const ctStatusLabel = optionLabeler(P.contactStatus);
  // Etiquetas antiguas de contacto ("Por Llamar", "NO Llamar"…) → actuales
  // (editables en Configuración del Pulso ABM)
  const contactStatusCanon = canonicalizer(CT_ORDER, cfg.contactAliases);
  const objLabel = optionLabeler(P.contactObjection);
  const sigLabel = optionLabeler(P.contactSignal);
  const unknownCtStatuses = new Set<string>();
  // Con status y sin equivalencia "Excluir del informe" (ej. ya no trabaja ahí)
  // Contacto de este cliente ("Cliente BullsEye"); sin la propiedad en este HubSpot no se filtra
  const filterByClient = !!uniCt && (clientMode || !!ctOpt);
  const ofClient = (r: { properties: Record<string, string | null> }) => !filterByClient || isClientContact(r.properties[uniCt!.name]);
  // Contacto de otro cliente: tiene "Cliente BullsEye" con otro valor
  const otherClientC = (r: { properties: Record<string, string | null> }) => filterByClient && !!(r.properties[uniCt!.name] ?? "").trim() && !ofClient(r);
  const otherClient = clientMode ? 0 : rawContacts.filter((r) => !!ctStatusLabel(r.properties[contactStatusProp]) && otherClientC(r)).length;
  if (otherClient) warnings.push(`${otherClient} contactos con status de asignación tienen "${uniCt!.label}" de otro cliente: no se cuentan.`);
  // Contactos de la cuenta = los con "Cliente BullsEye" = el cliente (penetración
  // real, aunque no tengan status de asignación) + los con status sin titular
  const kept = clientMode
    // Modo Cliente BullsEye: contactos con "Cliente BullsEye" = el cliente
    ? rawContacts.filter(ofClient)
    : rawContacts.filter((r) => {
        const label = ctStatusLabel(r.properties[contactStatusProp]);
        if (label && contactStatusCanon(label) === EXCLUDE) return false;
        if (otherClientC(r)) return false;
        return !!label || (filterByClient && ofClient(r));
      });
  const noStatusContacts = clientMode ? 0 : kept.filter((r) => !ctStatusLabel(r.properties[contactStatusProp])).length;
  if (noStatusContacts) warnings.push(`${noStatusContacts} contactos de ${uniValue} sin "Asignación BullsEye por llamar": se incluyen con status por actividad (conversó = Hacer Seguimiento, sin respuesta = No Contestó, sin actividad = Por gestionar).`);
  const excludedContacts = clientMode ? 0 : rawContacts.filter((r) => { const l = ctStatusLabel(r.properties[contactStatusProp]); return !!l && contactStatusCanon(l) === EXCLUDE; }).length;
  const keptIds = kept.map((r) => r.id);
  const derivedCt = new Set<string>(); // contactos con status por actividad

  // ── Actividades de la cuenta (empresa + contactos): profundidad por canal
  const act = await loadActivities({ companyIds, contactIds: keptIds, contactCompany, catalog, token });
  warnings.push(...act.warnings);
  const actByCt = new Map<string, RadarActivity[]>();
  for (const a of act.activities) {
    if (a.ct == null) continue;
    const arr = actByCt.get(String(a.ct)) ?? [];
    arr.push(a);
    actByCt.set(String(a.ct), arr);
  }

  const contacts: FlatContact[] = kept.map((r) => {
    const p = r.properties;
    const co = contactCompany.get(r.id)!;
    // Conteos por contacto desde sus actividades (intentos = llamadas telefónicas)
    const acts = actByCt.get(r.id) ?? [];
    // Modo Cliente BullsEye: status por actividad (conversó = seguimiento,
    // sin respuesta = no contestó, sin actividad = por gestionar)
    // Sin status de asignación (o en modo Cliente BullsEye): status por actividad
    const ownLabel = clientMode ? null : ctStatusLabel(p[contactStatusProp]);
    if (!ownLabel) derivedCt.add(String(r.id));
    const st = ownLabel
      ? contactStatusCanon(ownLabel)!
      : (acts.some((a) => a.conn || a.in) ? "Hacer Seguimiento" : acts.length ? "No Contestó" : "Por gestionar");
    if (!CT_ORDER.includes(st)) unknownCtStatuses.add(st);
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
  // Reuniones: planilla de reuniones (Excel de metas), no HubSpot
  let meetings: RadarMeeting[] = [];
  try {
    const sheet = await loadSheetMeetings({
      clientId, start,
      companies: companies.map((c) => ({ id: c.id, n: c.n, domain: companyDomain.get(String(c.id)) })),
      contacts: contacts.map((k) => ({ id: k.id, co: k.co, n: k.n })),
      sdrOf: (co) => coById.get(co)?.sdr ?? "Sin SDR",
    });
    meetings = sheet.meetings;
    if (!sheet.total) warnings.push("La planilla de reuniones no tiene reuniones de este cliente en el período.");
    if (sheet.unmatched.length) {
      const n = sheet.unmatched.reduce((a, x) => a + x.n, 0);
      warnings.push(`${n} reuniones de la planilla no calzan con ninguna empresa del universo en HubSpot: se cuentan en Reuniones pero no en el funnel ni en los cálculos por empresa (revisa el nombre de la empresa): ${sheet.unmatched.slice(0, 12).map((x) => `${x.empresa}${x.n > 1 ? ` (${x.n})` : ""}`).join(", ")}${sheet.unmatched.length > 12 ? "…" : ""}.`);
    }
  } catch (e) {
    warnings.push((e as Error).message);
  }

  // Modo Cliente BullsEye: contacto con reunión = Reunión Agendada; empresa
  // Lead (o sin etapa) = reunión → conversación → actividad → asignada
  // Contactos sin status de asignación (status por actividad): con reunión = Reunión Agendada
  if (!clientMode && derivedCt.size) {
    const mtCt = new Set(meetings.map((m) => String(m.ct)));
    for (const k of contacts) if (derivedCt.has(String(k.id)) && mtCt.has(String(k.id))) k.st = "Reunión Agendada";
  }
  if (clientMode) {
    const mtCt = new Set(meetings.map((m) => String(m.ct))), mtCo = new Set(meetings.map((m) => String(m.co)));
    for (const k of contacts) if (mtCt.has(String(k.id))) k.st = "Reunión Agendada";
    const coActs = new Set(act.activities.map((a) => String(a.co)));
    const coEff = new Set(contacts.filter((k) => k.st === "Hacer Seguimiento" || k.st === "Reunión Agendada").map((k) => String(k.co)));
    for (const c of companies) {
      if (!pendingStage.has(String(c.id))) continue;
      const id = String(c.id);
      c.st = mtCo.has(id) ? "Reunión Agendada" : coEff.has(id) ? "En seguimiento" : coActs.has(id) ? "En gestión" : "Asignada";
    }
    warnings.push(`Modo "Cliente BullsEye": universo = empresas con "${uniCo!.label}" = ${uniValue} y sus contactos con "${uniCt!.label}" = ${uniValue}; etapa por ciclo de vida (Opportunity = en conversaciones, Customer = cliente) y por actividad.`);
  }

  // ── Score de Desempeño SDR (Allo) ─────────────────────────────────────
  // Llamadas evaluadas por la IA de Allo en los números asignados al cliente
  // (Configuración → Cliente → Allo). Usa el mismo caché mensual de Células
  // SDR; con tope de tiempo para no comerse el sync.
  const callEvals: RadarCallEval[] = [];
  try {
    const deadline = Date.now() + 120_000;
    for (const month of periodMonths([start, today], today)) {
      if (Date.now() > deadline) { warnings.push("Score SDR (Allo): se cortó por tiempo; faltan meses (vuelve a sincronizar)."); break; }
      const r = await loadAlloMonth(month);
      for (const e of r.evals) {
        if (e.c !== clientId) continue;
        callEvals.push({ d: e.d, s: r.sdrNames[e.s] ?? e.s, score: e.score, crit: e.crit, ...(e.nivel ? { nivel: e.nivel } : {}) });
      }
    }
  } catch (e) {
    warnings.push(`Score SDR (Allo): ${(e as Error).message}`);
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

  if (excludedCompanies || excludedContacts) warnings.push(`Excluidos del informe por equivalencia: ${excludedCompanies} empresas y ${excludedContacts} contactos (Configuración del Pulso ABM → Equivalencias).`);
  if (unknownStatuses.size) warnings.push(`Status de empresa fuera del diccionario (agrega su equivalencia en Configuración del Pulso ABM): ${Array.from(unknownStatuses).join(", ")}.`);
  if (unknownCtStatuses.size) warnings.push(`Status de contacto fuera del diccionario (agrega su equivalencia en Configuración del Pulso ABM): ${Array.from(unknownCtStatuses).join(", ")}.`);
  if (!companies.length) warnings.push("No se encontraron empresas con status para este cliente en HubSpot.");

  const clientData = deriveClientData({
    name: client.name,
    deep: settings.deep ?? undefined,
    pipeline: settings.pipeline ?? deals.length > 0,
    companies, contacts, meetings, deals, cfg, today,
  });
  clientData.activities = act.activities;
  clientData.callEvals = callEvals;
  if (meetingsTotal(settings, client.name)) clientData.meetingsTotal = true;

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
