import { supabaseAdmin } from "@/lib/supabase";
import { hsHeaders } from "@/lib/hubspot";
import { sendMail, mailProvider } from "@/lib/mailer";
import { getRecipients } from "@/lib/mailRecipients";
import { tagContactClient } from "@/lib/wishlistHubspot";
import { readMonthCache } from "@/lib/celulasSdr/cache";

// Listas estáticas de HubSpot con los contactos prospectados (pedido de
// BullsEye, 18-nov-2026, todos los clientes): una vez al día hábil, los
// contactos aprobados en el portal (wishlist_contacts) que ya pasaron al
// HubSpot de BullsEye y aún no estaban en una lista se agrupan por cliente en
// una lista estática "Prospección <cliente> · <día>" y se avisa por correo
// (destinatarios editables, clave "listas_hubspot": por defecto Adolfo e
// Ingri) para revisar los contactos asignados. De paso se asegura que tengan
// su «Cliente BullsEye» (se agrega, nunca se quitan otros clientes).
// Procesados: cache "hs_listas_prospeccion:procesados" (id → día, 30 días).

const HS = "https://api.hubapi.com";
const DONE_KEY = "hs_listas_prospeccion:procesados";
const FIRST_RUN_SINCE = "2026-11-09T03:00:00Z"; // primera corrida: incluye lo aprobado desde el 9-nov
const KEEP_DAYS = 30;

type Row = {
  id: string; client_id: string; first_name: string | null; last_name: string | null; title: string | null;
  hubspot_contact_id: string; reviewed_at: string | null; reviewed_by_email: string | null; origin: string | null;
  client_wishlist: { company_name: string } | { company_name: string }[] | null;
};

export type ListResult = {
  cliente: string; contactos: number; listId: string | null; listUrl: string | null; error: string | null;
  sinCliente: string[]; filas: { nombre: string; cargo: string; empresa: string; aprobadoPor: string; url: string | null }[];
};

async function loadDone(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin().from("allo_response_cache").select("response").eq("cache_key", DONE_KEY).maybeSingle();
  return ((data?.response as { ids?: Record<string, string> } | null)?.ids ?? {}) as Record<string, string>;
}

async function saveDone(ids: Record<string, string>) {
  const limit = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const kept = Object.fromEntries(Object.entries(ids).filter(([, d]) => d >= limit));
  await supabaseAdmin().from("allo_response_cache").upsert(
    { cache_key: DONE_KEY, response: { ids: kept, at: new Date().toISOString() }, expires_at: new Date(Date.now() + 400 * 86_400_000).toISOString() },
    { onConflict: "cache_key" }
  );
}

async function account(): Promise<{ portalId: number; uiDomain: string } | null> {
  const r = await fetch(`${HS}/account-info/v3/details`, { headers: hsHeaders() }).catch(() => null);
  return r?.ok ? r.json() : null;
}

async function createStaticList(name: string, ids: string[]): Promise<{ listId: string | null; error: string | null }> {
  let res: Response | null = null;
  for (const n of [name, `${name} (${new Date().toISOString().slice(11, 16)} UTC)`]) {
    res = await fetch(`${HS}/crm/v3/lists`, {
      method: "POST", headers: hsHeaders(),
      body: JSON.stringify({ name: n, objectTypeId: "0-1", processingType: "MANUAL" }),
    });
    if (res.status !== 409) break; // nombre repetido: se reintenta con la hora
  }
  if (!res || !res.ok) {
    const t = res ? await res.text().catch(() => "") : "";
    const hint = res?.status === 403 ? " (la app privada de HubSpot necesita el permiso crm.lists.write)" : "";
    return { listId: null, error: `No se pudo crear la lista: HubSpot ${res?.status ?? "sin respuesta"}${hint} ${t.slice(0, 160)}`.trim() };
  }
  const listId = String((await res.json()).list?.listId ?? "");
  if (!listId) return { listId: null, error: "HubSpot no devolvió el id de la lista" };
  for (let i = 0; i < ids.length; i += 250) {
    const add = await fetch(`${HS}/crm/v3/lists/${listId}/memberships/add`, {
      method: "PUT", headers: hsHeaders(), body: JSON.stringify(ids.slice(i, i + 250)),
    });
    if (!add.ok) return { listId, error: `Lista creada, pero no se pudieron agregar contactos: HubSpot ${add.status}` };
  }
  return { listId, error: null };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function runProspectingLists(opts: { day: string; dryRun?: boolean }) {
  const db = supabaseAdmin();
  const done = await loadDone();
  const since = Object.keys(done).length ? new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString() : FIRST_RUN_SINCE;
  const rows: Row[] = [];
  for (let f = 0; f < 20_000; f += 1000) {
    const { data, error } = await db
      .from("wishlist_contacts")
      .select("id, client_id, first_name, last_name, title, hubspot_contact_id, reviewed_at, reviewed_by_email, origin, client_wishlist(company_name)")
      .eq("status", "approved").not("hubspot_contact_id", "is", null).gte("reviewed_at", since)
      .order("reviewed_at").range(f, f + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  // «Contactos que ya mostraron interés» cargados desde el Centro (lib/receptivos/load.ts): entran a la misma lista
  const receptive = (await readMonthCache<{ id: string; client_id: string; nombre: string; cargo: string; empresa: string; hs: string; at: string; by: string }[]>("receptivos:cargados").catch(() => null)) ?? [];
  for (const r of receptive) {
    if (r.at < since) continue;
    const [first, ...rest] = (r.nombre || "").split(" ");
    rows.push({ id: r.id, client_id: r.client_id, first_name: first || null, last_name: rest.join(" ") || null, title: r.cargo || null, hubspot_contact_id: r.hs, reviewed_at: r.at, reviewed_by_email: `${r.by} · ya mostró interés`, origin: "receptivo", client_wishlist: { company_name: r.empresa } });
  }
  const pending = rows.filter((r) => !done[r.id]);
  if (!pending.length) return { day: opts.day, clientes: [] as ListResult[], enviado: false, motivo: "Sin contactos nuevos en HubSpot" };

  const { data: clients } = await db.from("clients").select("id, name").in("id", Array.from(new Set(pending.map((r) => r.client_id))));
  const names = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const acct = await account();
  const base = acct ? `https://${acct.uiDomain || "app.hubspot.com"}/contacts/${acct.portalId}` : null;

  const byClient = new Map<string, Row[]>();
  for (const r of pending) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);
  const out: ListResult[] = [];
  for (const [clientId, list] of byClient) {
    const name = names.get(clientId) ?? clientId;
    const ids = Array.from(new Set(list.map((r) => String(r.hubspot_contact_id))));
    const res: ListResult = {
      cliente: name, contactos: ids.length, listId: null, listUrl: null, error: null, sinCliente: [],
      filas: list.map((r) => {
        const wl = Array.isArray(r.client_wishlist) ? r.client_wishlist[0] : r.client_wishlist;
        return {
          nombre: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(sin nombre)",
          cargo: r.title ?? "", empresa: wl?.company_name ?? "", aprobadoPor: r.reviewed_by_email ?? "",
          url: base ? `${base}/record/0-1/${r.hubspot_contact_id}` : null,
        };
      }),
    };
    if (!opts.dryRun) {
      for (const id of ids) {
        const t = await tagContactClient(id, { id: clientId, name }).catch((e) => ({ ok: false, error: String(e) }));
        if (!t.ok) res.sinCliente.push(`${id}: ${"error" in t ? t.error : ""}`);
      }
      const l = await createStaticList(`Prospección ${name} · ${opts.day}`, ids);
      res.listId = l.listId; res.error = l.error;
      res.listUrl = l.listId && base ? `${base}/objectLists/${l.listId}/filters` : null;
      if (l.listId) for (const r of list) done[r.id] = opts.day;
    }
    out.push(res);
  }
  if (opts.dryRun) return { day: opts.day, clientes: out, enviado: false, motivo: "Vista previa" };
  await saveDone(done);
  const to = await getRecipients("listas_hubspot");
  await sendMail({
    from: process.env.LISTAS_HUBSPOT_FROM || process.env.CELULAS_ALERTS_FROM || (mailProvider() === "resend" ? "onboarding@resend.dev" : "amadriz@bullseye-abm.com"),
    fromName: "BullsEye · Prospección",
    to,
    subject: `Contactos prospectados en HubSpot · ${opts.day} · ${out.reduce((s, c) => s + c.contactos, 0)} contactos`,
    html: mailHtml(opts.day, out),
  });
  return { day: opts.day, clientes: out, enviado: true, destinatarios: to };
}

function mailHtml(day: string, clients: ListResult[]): string {
  const total = clients.reduce((s, c) => s + c.contactos, 0);
  const blocks = clients.map((c) => `
    <h3 style="margin:22px 0 6px;color:#251762">${esc(c.cliente)} · ${c.contactos} contacto${c.contactos === 1 ? "" : "s"}</h3>
    ${c.listUrl ? `<p style="margin:0 0 8px"><a href="${c.listUrl}" style="color:#0b7f78;font-weight:600">Abrir la lista en HubSpot</a></p>` : ""}
    ${c.error ? `<p style="margin:0 0 8px;color:#b42318">⚠ ${esc(c.error)}</p>` : ""}
    ${c.sinCliente.length ? `<p style="margin:0 0 8px;color:#b54708">⚠ No se pudo marcar «Cliente BullsEye» en ${c.sinCliente.length}: ${esc(c.sinCliente.slice(0, 5).join(" · "))}</p>` : ""}
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr style="background:#f3f1fb;text-align:left"><th style="padding:6px">Contacto</th><th style="padding:6px">Cargo</th><th style="padding:6px">Empresa</th><th style="padding:6px">Aprobado por</th></tr>
      ${c.filas.map((f) => `<tr style="border-top:1px solid #eee"><td style="padding:6px">${f.url ? `<a href="${f.url}" style="color:#251762">${esc(f.nombre)}</a>` : esc(f.nombre)}</td><td style="padding:6px">${esc(f.cargo)}</td><td style="padding:6px">${esc(f.empresa)}</td><td style="padding:6px;color:#666">${esc(f.aprobadoPor)}</td></tr>`).join("")}
    </table>`).join("");
  return `<div style="font-family:Arial,sans-serif;color:#222;max-width:760px">
    <h2 style="color:#251762;margin:0 0 6px">Contactos prospectados que pasaron a HubSpot</h2>
    <p style="margin:0 0 4px">${total} contacto${total === 1 ? "" : "s"} aprobados en el portal (${day}), agrupados en una lista estática por cliente para revisar su asignación.</p>
    ${blocks}
    <p style="margin:24px 0 0;color:#888;font-size:12px">Correo automático del portal BullsEye. Destinatarios editables en el portal (clave «listas_hubspot»).</p>
  </div>`;
}
