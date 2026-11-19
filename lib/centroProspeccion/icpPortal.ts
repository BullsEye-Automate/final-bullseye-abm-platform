import { supabaseAdmin } from "@/lib/supabase";
import { deserializeIcpForm, diffIcpContent, EMPTY_FORM, ICP_FIELD_LABELS, serializeIcpForm, type IcpFormData } from "@/lib/icp-form";
import { listClientIndustries, loadIcpContent, saveIcpContent } from "@/lib/icpStore";
import { loadClientLinks } from "./portalLink";
import { syncFichasFromIcp } from "./icpSync";

// ICP del portal (Sistema → ICP, el mismo de Pulso ABM) leído y escrito desde
// el proyecto de Claude de cada cliente, vía el conector MCP del Centro
// (pedido de BullsEye, 19-nov-2026: «el ICP oficial es el del proyecto de
// Claude del cliente; el portal y la ficha lo copian y solo cambia cuando se
// modifica en el proyecto»). Antes de escribir se guarda una copia del ICP
// anterior en allo_response_cache (icp_respaldo:<cliente>:<sección>:<fecha>,
// 1 año) para poder volver atrás. Después se alinea la ficha del Centro.

export const ICP_FIELD_KEYS = Object.keys(EMPTY_FORM) as (keyof IcpFormData)[];
const ARRAY_KEYS = new Set(ICP_FIELD_KEYS.filter((k) => Array.isArray(EMPTY_FORM[k])));

export class IcpPortalError extends Error {}

async function resolveClient(fichaId: string) {
  const links = await loadClientLinks();
  const client = links.byFicha.get(fichaId);
  if (!client) throw new IcpPortalError(`La ficha «${fichaId}» no está vinculada a un cliente del portal. Vincúlala en el Centro (Clientes → ficha → Portal) antes de cargar el ICP.`);
  return client;
}

const nonEmpty = (f: IcpFormData) =>
  Object.fromEntries(ICP_FIELD_KEYS.filter((k) => (Array.isArray(f[k]) ? (f[k] as string[]).length : String(f[k]).trim())).map((k) => [k, f[k]]));

export async function getPortalIcp(fichaId: string) {
  const db = supabaseAdmin();
  const client = await resolveClient(fichaId);
  const industries = await listClientIndustries(db, client.id);
  const general = await loadIcpContent(db, client.id, null);
  const secciones = [{ seccion: "General", campos: nonEmpty(deserializeIcpForm(general)) }];
  for (const ind of industries) {
    secciones.push({ seccion: ind.name, campos: nonEmpty(deserializeIcpForm(await loadIcpContent(db, client.id, ind.id))) });
  }
  return {
    cliente: client.name,
    secciones,
    campos_validos: Object.fromEntries(ICP_FIELD_KEYS.map((k) => [k, `${ICP_FIELD_LABELS[k]}${ARRAY_KEYS.has(k) ? " (lista)" : ""}`])),
  };
}

function coerce(key: keyof IcpFormData, v: unknown): string | string[] {
  if (ARRAY_KEYS.has(key)) {
    const arr = Array.isArray(v) ? v : String(v ?? "").split(",");
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
  }
  return String(v ?? "").trim().slice(0, 8000);
}

export async function setPortalIcp(opts: {
  fichaId: string;
  seccion?: string | null;
  campos: Record<string, unknown>;
  reemplazar?: boolean;
  crearSeccion?: boolean;
  alinearFicha?: boolean;
  fuente?: string | null;
  by: string;
}) {
  const db = supabaseAdmin();
  const client = await resolveClient(opts.fichaId);
  const unknown = Object.keys(opts.campos).filter((k) => !ICP_FIELD_KEYS.includes(k as keyof IcpFormData));
  if (unknown.length) throw new IcpPortalError(`Campos desconocidos: ${unknown.join(", ")}. Usa los de campos_validos (centro_icp_portal_leer).`);

  // Sección: General o una industria (también sirve para cuentas de un mismo cliente, ej. Nisum Chile / Colombia / Perú)
  let industryId: string | null = null;
  const name = (opts.seccion ?? "").trim();
  if (name && name.toLowerCase() !== "general") {
    const industries = await listClientIndustries(db, client.id);
    const hit = industries.find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    if (hit) industryId = hit.id;
    else if (opts.crearSeccion) {
      const { data, error } = await db.from("icp_industries")
        .insert({ client_id: client.id, name: name.slice(0, 80), sort_order: industries.length + 1 }).select("id").single();
      if (error) throw new IcpPortalError(`No se pudo crear la sección: ${error.message}`);
      industryId = data.id as string;
    } else {
      throw new IcpPortalError(`El cliente no tiene la sección «${name}». Secciones: General${industries.map((i) => `, ${i.name}`).join("")}. Para crearla pasa crear_seccion = true.`);
    }
  }

  const before = await loadIcpContent(db, client.id, industryId);
  const form: IcpFormData = opts.reemplazar ? { ...EMPTY_FORM } : deserializeIcpForm(before);
  for (const [k, v] of Object.entries(opts.campos)) (form as Record<string, unknown>)[k] = coerce(k as keyof IcpFormData, v);
  const after = serializeIcpForm(form);
  const cambios = diffIcpContent(before, after);
  if (!cambios.length) return { cliente: client.name, seccion: name || "General", cambios: [], mensaje: "Sin cambios: el ICP del portal ya decía esto." };

  // Respaldo del ICP anterior
  const stamp = new Date().toISOString();
  await db.from("allo_response_cache").upsert({
    cache_key: `icp_respaldo:${client.id}:${industryId ?? "general"}:${stamp}`,
    response: { cliente: client.name, seccion: name || "General", contenido: before, por: opts.by, fuente: opts.fuente ?? null, at: stamp },
    expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  }, { onConflict: "cache_key" });

  const { error } = await saveIcpContent(db, client.id, industryId, after);
  if (error) throw new IcpPortalError(`No se pudo guardar el ICP: ${error}`);

  const ficha = opts.alinearFicha === false ? null : await syncFichasFromIcp({ fichaId: opts.fichaId, by: opts.by }).catch((e) => [{ estado: `no se pudo alinear: ${(e as Error).message}` }]);
  return {
    cliente: client.name,
    seccion: name || "General",
    cambios: cambios.map((c) => ({ campo: c.label, antes: c.before.slice(0, 300), ahora: c.after.slice(0, 300) })),
    respaldo: `icp_respaldo:${client.id}:${industryId ?? "general"}:${stamp}`,
    ficha: ficha?.[0]?.estado ?? "no se alineó (alinear_ficha = false)",
    aviso: "Al cambiar el ICP, las recomendaciones IA y los fit de empresas se recalculan con el ICP nuevo.",
  };
}
