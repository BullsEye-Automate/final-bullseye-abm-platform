import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { batchAssociations, batchRead } from "@/lib/radarAbm/server/hubspot";
import { hubspotTokenFor, loadClientSettings } from "@/lib/radarAbm/server/store";
import { readMasterPeople, resolveSdr } from "@/lib/respuestasLemlist/directory";
import { ownerIdFor } from "./ficha";
import type { SdrSlice } from "./types";

// Dashboard SDR → «Mi día» (27-nov-2026, etapa 1 de «trabajar desde la app»):
// seguimientos (tareas de HubSpot sin completar) del SDR leídos en vivo en
// cada HubSpot de su cartera: vencidos, de hoy y de los próximos 7 días.
// Propietario de la tarea = usuario de HubSpot del SDR (correo de la Maestra
// o nombre, como al registrar). Solo lectura.

export type DayTask = {
  id: string;              // id de la tarea en HubSpot
  c: string | null;        // cliente de la cartera (para abrir la ficha); null si la empresa no está en la cartera
  coHs: string | null; con: string | null;   // empresa
  ctHs: string | null; ctn: string | null;   // contacto
  title: string; body: string; due: string | null; type: string | null;
};
export type DayTasks = { at: string; tasks: DayTask[]; errors: string[]; noOwner: string[] };

const HS = "https://api.hubapi.com";
const DAY = 86_400_000;

export async function myTasks(slice: SdrSlice): Promise<DayTasks> {
  const people = await readMasterPeople().catch(() => []);
  const r = resolveSdr(people, slice.name);
  const email = r.ok ? r.person.email : r.person?.email ?? null;
  // Un HubSpot puede atender varios clientes: se lee una vez por token
  const groups = new Map<string, { token: string | undefined; clients: string[] }>();
  for (const [c, a] of Object.entries(slice.accts)) {
    const settings = await loadClientSettings(a.id).catch(() => null);
    const token = settings ? await hubspotTokenFor(a.id, settings.hubspot_source).catch(() => undefined) : undefined;
    const k = token ?? "bullseye";
    const g = groups.get(k) ?? { token, clients: [] };
    g.clients.push(c);
    groups.set(k, g);
  }
  const out: DayTasks = { at: new Date().toISOString(), tasks: [], errors: [], noOwner: [] };
  const now = Date.now();
  for (const g of groups.values()) {
    const label = g.token ? g.clients.join(", ") : "HubSpot de BullsEye";
    try {
      const owner = await ownerIdFor({ emails: [email], names: [slice.name] }, g.token);
      if (!owner) { out.noOwner.push(label); continue; }
      const res = await hsFetchWithRetry(`${HS}/crm/v3/objects/tasks/search`, {
        method: "POST", headers: hsHeaders(g.token),
        body: JSON.stringify({
          filterGroups: [{ filters: [
            { propertyName: "hubspot_owner_id", operator: "EQ", value: owner },
            { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
            { propertyName: "hs_timestamp", operator: "BETWEEN", value: String(now - 60 * DAY), highValue: String(now + 8 * DAY) },
          ] }],
          properties: ["hs_task_subject", "hs_task_body", "hs_timestamp", "hs_task_type", "hs_task_status"],
          sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }], limit: 200,
        }),
      });
      if (!res.ok) throw new Error(`HubSpot ${res.status}`);
      const rows = ((await res.json()).results ?? []) as { id: string; properties: Record<string, string | null> }[];
      if (!rows.length) continue;
      const ids = rows.map((x) => x.id);
      const [toCo, toCt] = await Promise.all([
        batchAssociations("tasks", "companies", ids, g.token).catch(() => new Map<string, string[]>()),
        batchAssociations("tasks", "contacts", ids, g.token).catch(() => new Map<string, string[]>()),
      ]);
      const coIds = Array.from(new Set(ids.map((i) => toCo.get(i)?.[0]).filter(Boolean) as string[]));
      const ctIds = Array.from(new Set(ids.map((i) => toCt.get(i)?.[0]).filter(Boolean) as string[]));
      const [cos, cts] = await Promise.all([
        coIds.length ? batchRead("companies", coIds, ["name"], g.token).catch(() => []) : [],
        ctIds.length ? batchRead("contacts", ctIds, ["firstname", "lastname"], g.token).catch(() => []) : [],
      ]);
      const coName = new Map(cos.map((x) => [x.id, x.properties.name ?? null]));
      const ctName = new Map(cts.map((x) => [x.id, [x.properties.firstname, x.properties.lastname].filter(Boolean).join(" ") || null]));
      // Cliente de la cartera dueño de la empresa (para la ficha)
      const clientOf = new Map<string, string>();
      for (const co of slice.companies) if (g.clients.includes(co.c) && !clientOf.has(co.hs)) clientOf.set(co.hs, co.c);
      for (const t of rows) {
        const coHs = toCo.get(t.id)?.[0] ?? null, ctHs = toCt.get(t.id)?.[0] ?? null;
        const p = t.properties;
        out.tasks.push({
          id: t.id, c: coHs ? clientOf.get(coHs) ?? (g.clients.length === 1 ? g.clients[0] : null) : null,
          coHs, con: coHs ? coName.get(coHs) ?? null : null, ctHs, ctn: ctHs ? ctName.get(ctHs) ?? null : null,
          title: p.hs_task_subject || "Seguimiento", body: (p.hs_task_body ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
          due: p.hs_timestamp ?? null, type: p.hs_task_type ?? null,
        });
      }
    } catch (e) {
      out.errors.push(`${label}: ${(e as Error).message}`);
    }
  }
  out.tasks.sort((a, b) => String(a.due ?? "").localeCompare(String(b.due ?? "")));
  return out;
}
