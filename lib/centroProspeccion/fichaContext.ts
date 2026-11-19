import { loadClientLinks } from "./portalLink";

// Lo que el equipo de prospección escribe en la ficha del cliente en el
// Centro de prospección (exclusiones, zonas, cargos, aprendizajes de
// reuniones…) como contexto extra para la IA de Empresas (fit de empresas)
// y de Contactos (puntaje de cargos). El ICP del portal sigue mandando.
//
// Solo suma contexto: no cambia los hashes de caché (company_fit_scores,
// persona_title_scores ni el estado de las recomendaciones), así que no
// reinicia nada de lo ya calculado; las evaluaciones nuevas lo usan.
// Se apaga con la variable de Vercel CENTRO_FICHA_EN_IA=off.

const MAX_FIELD = 2500;
const MAX_CONTEXT = 6000;
const MAX_TOTAL = 12000;

// Las líneas aprobadas desde la inteligencia semanal son sugerencias para el
// equipo, no criterio (pedido de BullsEye, 19-nov-2026: el ICP solo cambia
// cuando se modifica en el proyecto de Claude del cliente). No van a la IA.
const INTEL_LINE = /\(inteligencia semana [^)]*\)/i;
const AJUSTES_HDR = "Ajustes aprobados en el Centro";
const withoutIntel = (v: unknown) =>
  String(v ?? "").split(`\n\n${AJUSTES_HDR}`)[0].split("\n").filter((l) => !(l.trim().startsWith("•") && INTEL_LINE.test(l))).join("\n");

const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

export type FichaUse = "empresas" | "cargos";

const HEADER: Record<FichaUse, string> = {
  empresas:
    "Notas que mantiene el equipo de prospección de BullsEye sobre este cliente (ficha del Centro de prospección). Úsalas junto al ICP:\n" +
    "- Las empresas o grupos que la ficha indica como excluidos o «no contactar» no son prospectos: fit_score 0 y dilo en fit_reason (por ejemplo «Excluida en la ficha del cliente»). No marques existing_client por esto; existing_client sigue siendo solo para clientes actuales o pasados.\n" +
    "- Si la ficha y el ICP se contradicen en industria, tamaño o geografía, manda el ICP.",
  cargos:
    "Notas que mantiene el equipo de prospección de BullsEye sobre este cliente (ficha del Centro de prospección). Úsalas junto al ICP para afinar el puntaje de cada cargo (decisores, influenciadores, cargos a evitar, aprendizajes de reuniones). Si la ficha y el ICP se contradicen, manda el ICP.",
};

export async function fichaContextFor(clientId: string, use: FichaUse): Promise<string> {
  if ((process.env.CENTRO_FICHA_EN_IA ?? "").toLowerCase() === "off") return "";
  const links = await loadClientLinks();
  const fichas = (links.fichasByClient.get(clientId) ?? []).filter((f) => f.data.estado !== "pausado");
  if (!fichas.length) return "";

  const fields: [string, string][] =
    use === "empresas"
      ? [["Exclusiones", "exclusiones"], ["Industrias", "industrias"], ["Zonas", "zonas"], ["Perfil de empresa", "icp"]]
      : [["Cargos objetivo", "cargos"], ["Exclusiones", "exclusiones"]];

  const parts = fichas.map((f) => {
    const lines = [`Ficha: ${clip(f.data.nombre || f.id, 120)}`];
    for (const [label, key] of fields) {
      const v = clip(withoutIntel(f.data[key]), MAX_FIELD);
      if (v) lines.push(`${label}:\n${v}`);
    }
    const ctx = clip(withoutIntel(f.data.contexto), MAX_CONTEXT);
    if (ctx) lines.push(`Contexto (extracto):\n${ctx}`);
    return lines.join("\n\n");
  });
  const body = clip(parts.join("\n\n---\n\n"), MAX_TOTAL);
  return `<ficha_centro_prospeccion>\n${HEADER[use]}\n\n${body}\n</ficha_centro_prospeccion>`;
}

// Nunca debe frenar la IA: si la ficha no se puede leer, se sigue sin ella.
export async function safeFichaContext(clientId: string, use: FichaUse): Promise<string> {
  try {
    return await fichaContextFor(clientId, use);
  } catch (e) {
    console.warn("[centro] ficha no disponible para la IA:", (e as Error).message);
    return "";
  }
}
