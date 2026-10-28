import { CONNECTED_DISPOSITION, callChannel } from "../dictionaries";
import type { ActivityKind, RadarActivity } from "../types";
import { batchAssociations, batchRead, callDispositions, type PropertyCatalog } from "./hubspot";

// Pulso ABM — actividades de las cuentas (profundidad ABM por canal).
// Se traen las llamadas, correos y comunicaciones (WhatsApp / LinkedIn)
// asociadas (las notas no son actividades) a las empresas del universo Y a sus contactos con status.
// Una actividad asociada a la vez a la empresa y al contacto se cuenta una
// sola vez (por id), atribuida al contacto. Las asociadas solo a la empresa
// suman a la cuenta sin contacto.
//
// Canal ("La Biblia"): una llamada con "Tipo de llamada" WhatsApp o LinkedIn
// es de ese canal (no es intento telefónico); "Resultado de la llamada"
// Conectada / Conectado - … = llamada conectada; un correo entrante
// (hs_email_direction = INCOMING_EMAIL) es una respuesta.

const OBJECTS = ["calls", "emails", "communications"] as const;
type Obj = (typeof OBJECTS)[number];

// Tope de seguridad: más actividades que esto no caben en el tiempo del sync
const MAX_ACTIVITIES = 60_000;

const toDay = (v: string | null | undefined): string | undefined => {
  if (!v) return undefined;
  const d = /^\d+$/.test(v) ? new Date(Number(v)) : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

export async function loadActivities(input: {
  companyIds: string[];
  contactIds: string[];
  contactCompany: Map<string, string>;
  catalog: PropertyCatalog;
  token?: string;
}): Promise<{ activities: RadarActivity[]; warnings: string[] }> {
  const { companyIds, contactIds, contactCompany, catalog, token } = input;
  const warnings: string[] = [];

  // Asociaciones: contactos y empresas (las reuniones salen de la planilla)
  const [ctAssoc, coAssoc] = await Promise.all([
    Promise.all(OBJECTS.map((o) => batchAssociations("contacts", o, contactIds, token).catch((e) => {
      warnings.push(`No se pudieron leer ${o} de los contactos: ${(e as Error).message}`);
      return new Map<string, string[]>();
    }))),
    Promise.all(OBJECTS.map((o) => batchAssociations("companies", o, companyIds, token).catch((e) => {
      warnings.push(`No se pudieron leer ${o} de las empresas: ${(e as Error).message}`);
      return new Map<string, string[]>();
    }))),
  ]);

  // id de actividad → dueño (contacto primero, si no la empresa)
  const owner = new Map<string, { obj: Obj; co: string; ct?: string }>();
  OBJECTS.forEach((obj, i) => {
    for (const [ct, ids] of ctAssoc[i]) for (const id of ids) {
      const key = `${obj}:${id}`;
      if (!owner.has(key)) owner.set(key, { obj, co: contactCompany.get(ct)!, ct });
    }
  });
  OBJECTS.forEach((obj, i) => {
    for (const [co, ids] of coAssoc[i]) for (const id of ids) {
      const key = `${obj}:${id}`;
      if (!owner.has(key)) owner.set(key, { obj, co });
    }
  });
  if (owner.size > MAX_ACTIVITIES) {
    warnings.push(`Hay ${owner.size} actividades; se leyó el detalle de las primeras ${MAX_ACTIVITIES}.`);
  }
  const byObj: Record<Obj, string[]> = { calls: [], emails: [], communications: [] };
  for (const [key, o] of Array.from(owner.entries()).slice(0, MAX_ACTIVITIES)) byObj[o.obj].push(key.slice(o.obj.length + 1));

  // Detalle de cada tipo (fecha, canal, resultado)
  const activities: RadarActivity[] = [];
  const push = (obj: Obj, id: string, k: ActivityKind, d: string | undefined, extra: Partial<RadarActivity> = {}) => {
    const o = owner.get(`${obj}:${id}`)!;
    activities.push({ id: `${obj}:${id}`, k, co: o.co, ...(o.ct ? { ct: o.ct } : {}), ...(d ? { d } : {}), ...extra });
  };

  if (byObj.calls.length) {
    try {
      const typeProp = (catalog.calls ?? []).find((p) => p.name === "hs_activity_type");
      const typeLabels = new Map((typeProp?.options ?? []).map((o) => [o.value, o.label]));
      const dispositions = await callDispositions(token).catch(() => new Map<string, string>());
      for (const r of await batchRead("calls", byObj.calls, ["hs_timestamp", "hs_activity_type", "hs_call_disposition"], token)) {
        const p = r.properties;
        const ch = callChannel(typeLabels.get(p.hs_activity_type ?? "") ?? p.hs_activity_type);
        const conn = CONNECTED_DISPOSITION.test(dispositions.get(p.hs_call_disposition ?? "") ?? "");
        push("calls", r.id, ch ?? "call", toDay(p.hs_timestamp), conn ? { conn: 1 } : {});
      }
    } catch (e) {
      warnings.push(`No se pudo leer el detalle de las llamadas: ${(e as Error).message}`);
      for (const id of byObj.calls) push("calls", id, "call", undefined);
    }
  }
  if (byObj.emails.length) {
    try {
      for (const r of await batchRead("emails", byObj.emails, ["hs_timestamp", "hs_email_direction"], token)) {
        push("emails", r.id, "em", toDay(r.properties.hs_timestamp), r.properties.hs_email_direction === "INCOMING_EMAIL" ? { in: 1 } : {});
      }
    } catch (e) {
      warnings.push(`No se pudo leer el detalle de los correos: ${(e as Error).message}`);
      for (const id of byObj.emails) push("emails", id, "em", undefined);
    }
  }
  if (byObj.communications.length) {
    try {
      for (const r of await batchRead("communications", byObj.communications, ["hs_timestamp", "hs_communication_channel_type"], token)) {
        const t = (r.properties.hs_communication_channel_type ?? "").toUpperCase();
        // BullsEye no trabaja SMS: otras comunicaciones no cuentan como actividad
        const k: ActivityKind | null = t.includes("WHATS") ? "wa" : t.includes("LINKEDIN") ? "li" : null;
        if (k) push("communications", r.id, k, toDay(r.properties.hs_timestamp));
      }
    } catch (e) {
      warnings.push(`No se pudo leer el detalle de WhatsApp / LinkedIn: ${(e as Error).message}`);
    }
  }
  return { activities, warnings };
}
