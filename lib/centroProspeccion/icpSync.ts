import { createHash } from "crypto";
import { deserializeIcpForm, type IcpFormData } from "@/lib/icp-form";
import { getClientIcpText } from "@/lib/wishlist";
import { supabaseAdmin } from "@/lib/supabase";
import { loadClientLinks } from "./portalLink";
import { writeDoc } from "./store";

// Fichas del Centro alineadas con el ICP de Pulso ABM (pedido de BullsEye,
// Ingri, 16-nov-2026: el ICP del proyecto en Pulso ABM es el más actualizado).
// Pulso ABM → «ICP del proyecto» lee el ICP del portal (Sistema → ICP,
// lib/icpStore.ts); de ahí se reconstruyen 4 campos de la ficha:
//   icp (Perfil de empresa) · industrias · zonas · cargos
// Exclusiones, Contexto, Avances y Próximos no se tocan.
// - La primera vez, el texto que había a mano en esos 4 campos se guarda en
//   Contexto como «ICP ANTERIOR DE LA FICHA» (decisión de BullsEye).
// - Los ajustes aprobados desde la Inteligencia de la semana (líneas «• …
//   (inteligencia semana …)») se conservan en un bloque aparte en cada sync,
//   hasta que el KAM los pase al ICP del portal.
// - Se vuelve a sincronizar solo si el ICP cambió (huella `icpHash`).

const FIELDS = ["icp", "industrias", "zonas", "cargos"] as const;
type Field = (typeof FIELDS)[number];
const LABEL: Record<Field, string> = { icp: "Perfil de empresa", industrias: "Industrias", zonas: "Zonas", cargos: "Cargos" };
const AJUSTES_HDR = "Ajustes aprobados en el Centro (pendientes de pasar al ICP del portal):";
const INTEL_LINE = /\(inteligencia semana [^)]*\)/i;

const line = (label: string, v: string | string[]) => {
  const t = (Array.isArray(v) ? v.join(", ") : v).trim();
  return t ? `- ${label}: ${t}` : "";
};
const join = (xs: string[]) => xs.filter(Boolean).join("\n");

function fromForm(f: IcpFormData): Record<Field, string> {
  return {
    icp: join([
      f.descripcion_negocio ? `Qué vende el cliente: ${f.descripcion_negocio}` : "",
      line("Tamaño", f.tamano_empresa),
      line("Facturación anual", f.facturacion),
      line("Modelo de empresa", f.modelo_empresa),
      line("Etapa", f.etapa_empresa),
      line("Señales positivas de fit", f.senales_positivas),
      line("Descalificadores", f.senales_negativas),
      line("Tecnologías / stack", f.tech_stack),
      line("Eventos disparadores", f.eventos_disparadores),
    ]),
    industrias: join([f.industrias_objetivo, f.industrias_excluidas ? `Industrias excluidas: ${f.industrias_excluidas}` : ""]),
    zonas: f.geografias,
    cargos: join([
      line("Decisores", f.cargos_decisores),
      line("Influenciadores", f.cargos_influenciadores),
      line("Evitar", f.cargos_evitar),
      line("Departamentos", f.departamentos),
      line("Seniority mínimo", f.seniority),
    ]),
  };
}

/** Los 4 campos desde el texto del ICP (general y/o por industria). */
export function fieldsFromIcp(text: string): Record<Field, string> | null {
  const parts: { name: string | null; body: string }[] = [];
  const re = /=== ICP INDUSTRIA: (.+?) ===\n?/g;
  let last = 0, name: string | null = null, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last || name) parts.push({ name, body: text.slice(last, m.index) });
    name = m[1].trim();
    last = re.lastIndex;
  }
  parts.push({ name, body: text.slice(last) });
  const out: Record<Field, string> = { icp: "", industrias: "", zonas: "", cargos: "" };
  const multi = parts.filter((p) => p.body.trim()).length > 1;
  for (const p of parts) {
    if (!p.body.trim()) continue;
    const f = fromForm(deserializeIcpForm(p.body));
    for (const k of FIELDS) {
      if (!f[k]) continue;
      const head = multi ? `${p.name ? `ICP ${p.name}` : "ICP general"}:\n` : "";
      out[k] = out[k] ? `${out[k]}\n\n${head}${f[k]}` : `${head}${f[k]}`;
    }
  }
  return FIELDS.some((k) => out[k]) ? out : null;
}

const intelLines = (v: unknown) => String(v ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("•") && INTEL_LINE.test(l));
const stripAjustes = (v: unknown) => String(v ?? "").split(`\n\n${AJUSTES_HDR}`)[0].split("\n").filter((l) => !(l.trim().startsWith("•") && INTEL_LINE.test(l))).join("\n").trim();

export type IcpSyncRow = { ficha: string; cliente: string; estado: string; cambios?: Field[]; nuevo?: Record<string, unknown> };

export async function syncFichasFromIcp(opts: { fichaId?: string; dryRun?: boolean; by?: string } = {}): Promise<IcpSyncRow[]> {
  const db = supabaseAdmin();
  const links = await loadClientLinks();
  const out: IcpSyncRow[] = [];
  const icpCache = new Map<string, string>();
  for (const f of links.fichas) {
    if (opts.fichaId && f.id !== opts.fichaId) continue;
    const client = links.byFicha.get(f.id);
    const nombre = String(f.data.nombre || f.id);
    if (!client) { out.push({ ficha: nombre, cliente: "", estado: "sin vínculo con el portal" }); continue; }
    if (f.data.estado === "pausado") { out.push({ ficha: nombre, cliente: client.name, estado: "ficha pausada" }); continue; }
    if (!icpCache.has(client.id)) icpCache.set(client.id, await getClientIcpText(db, client.id));
    const text = icpCache.get(client.id)!.trim();
    if (!text) { out.push({ ficha: nombre, cliente: client.name, estado: "sin ICP en Pulso ABM" }); continue; }
    const hash = createHash("sha1").update(text).digest("hex").slice(0, 16);
    if (f.data.icpHash === hash) { out.push({ ficha: nombre, cliente: client.name, estado: "ya alineada" }); continue; }
    const fields = fieldsFromIcp(text);
    if (!fields) { out.push({ ficha: nombre, cliente: client.name, estado: "ICP sin formato reconocible: no se tocó" }); continue; }

    const patch: Record<string, unknown> = {};
    const cambios: Field[] = [];
    for (const k of FIELDS) {
      const keep = intelLines(f.data[k]);
      const v = fields[k] + (keep.length ? `\n\n${AJUSTES_HDR}\n${keep.join("\n")}` : "");
      if (v.trim() && v !== String(f.data[k] ?? "")) { patch[k] = v; cambios.push(k); }
    }
    // Primera alineación: lo escrito a mano pasa a Contexto
    if (!f.data.icpHash) {
      const prev = FIELDS.map((k) => [LABEL[k], stripAjustes(f.data[k])] as const).filter(([, v]) => v);
      if (prev.length) {
        const fecha = new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", year: "numeric" });
        patch.contexto = `${String(f.data.contexto ?? "").trim()}\n\nICP ANTERIOR DE LA FICHA (escrito a mano; reemplazado por el ICP de Pulso ABM el ${fecha})\n${prev.map(([l, v]) => `${l}:\n${v}`).join("\n\n")}`.trim();
      }
    }
    patch.icpHash = hash;
    patch.icpFuente = "ICP del proyecto en Pulso ABM (Sistema → ICP del portal)";
    patch.icpSincronizado = new Date().toISOString();
    if (!opts.dryRun) {
      const r = await writeDoc({ collection: "clientes", docId: f.id, data: patch, mode: "update", by: opts.by ?? "icp-sync", source: "automation" });
      if (r.status !== "ok") { out.push({ ficha: nombre, cliente: client.name, estado: `no se pudo guardar (${r.status})` }); continue; }
    }
    out.push({ ficha: nombre, cliente: client.name, estado: opts.dryRun ? "se alinearía" : "alineada", cambios, ...(opts.dryRun ? { nuevo: patch } : {}) });
  }
  return out;
}
