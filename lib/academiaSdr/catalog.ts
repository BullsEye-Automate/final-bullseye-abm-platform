// Entrenamiento cliente: academias HTML hechas con el skill
// "academia-sdr-bullseye" en el proyecto de Claude de cada cliente. Las que
// ya existían se copiaron tal cual a content/entrenamiento/ (sin cambios de
// diseño); las nuevas se suben desde Configurar (tabla sdr_academies.html).

// Cómo guarda su avance cada academia en localStorage. La plataforma reemplaza
// localStorage dentro del iframe (lib/academiaSdr/bridge.ts) para leer las
// vueltas completadas sin tocar el HTML.
export type ProgressConfig = {
  key: string;                       // clave de localStorage
  shape: "array" | "object";         // [..] o { done: [..], … }
  base: 0 | 1;                       // vuelta 1 = 0 o 1
  ids?: string[];                    // si guarda ids en vez de números (vuelta = posición + 1)
  empty?: Record<string, unknown>;   // estado inicial (shape object) para precargar el avance
  quiz?: string;                     // campo del estado con { score, total } del quiz
};

// Formato que pide el skill actualizado (docs/skills/academia-sdr-bullseye/SKILL.md).
export const CONTRACT_PROGRESS: ProgressConfig = {
  key: "bullseye-entrenamiento",
  shape: "object",
  base: 1,
  empty: { done: [] },
  quiz: "quiz",
};

export type CatalogEntry = {
  file: string;            // content/entrenamiento/<file>
  title: string;
  aliases: string[];       // nombre del cliente compactado (sin espacios, tildes ni símbolos)
  sourceUrl: string;       // artifact del proyecto de Claude
  progress: ProgressConfig;
};

export const CATALOG: CatalogEntry[] = [
  {
    file: "simplex.html",
    title: "Academia SDR Simplex",
    aliases: ["simplex"],
    sourceUrl: "https://claude.ai/artifact/XpN8VfJcCw7cQ1gx5EaWCH",
    progress: { key: "bullseye-academia-simplex-v1", shape: "object", base: 1, empty: { done: [], tab: 1 } },
  },
  {
    file: "apply-digital.html",
    title: "Academia SDR Apply Digital",
    aliases: ["applydigital", "apply"],
    sourceUrl: "https://claude.ai/artifact/1o7wvNYghFjGa2HxgtiRa5",
    progress: { key: "academia-apply-v1", shape: "array", base: 0 },
  },
  {
    file: "otic-cchc.html",
    title: "Academia SDR Otic CChC",
    aliases: ["oticcchc", "otic"],
    sourceUrl: "https://claude.ai/artifact/Ar8DfvYJEpZCvGpAb3NKQd",
    progress: { key: "bullseye-academia-otic-cchc", shape: "object", base: 0, empty: { done: [], tab: 0 } },
  },
  {
    file: "coderslab.html",
    title: "Academia SDR CodersLab",
    aliases: ["coderslab"],
    sourceUrl: "https://claude.ai/artifact/NJQWhHLrBhz7LD7rbDJ3qH",
    progress: {
      key: "cl-done",
      shape: "array",
      base: 1,
      ids: ["inicio", "quien", "vende", "dicc", "icp", "pistas", "casos", "mensaje", "reunion", "semana"],
    },
  },
  {
    file: "umine.html",
    title: "Academia SDR Umine 2.0",
    aliases: ["umine"],
    sourceUrl: "https://claude.ai/artifact/81SCtCQseQG27ohiKegtbc",
    progress: { key: "umine2-academia-laps", shape: "array", base: 1 },
  },
  {
    file: "g-talent.html",
    title: "Academia SDR G-Talent",
    aliases: ["gtalent"],
    sourceUrl: "https://claude.ai/artifact/XHnCKWHkpkEisNbrvPWrfA",
    progress: { key: "academia-gtalent-v1", shape: "object", base: 0, empty: { done: [], cur: 0 } },
  },
];

export const LAP_COUNT = 10;

export function compactName(s: string): string {
  return (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Academia del repo que corresponde a un cliente (por nombre o slug).
export function findCatalogEntry(client: { name: string; slug?: string | null }): CatalogEntry | null {
  const names = [compactName(client.name), compactName(client.slug ?? "")].filter(Boolean);
  for (const entry of CATALOG) {
    if (entry.aliases.some((a) => names.some((n) => n === a || n.startsWith(a)))) return entry;
  }
  return null;
}

// Para un HTML subido: si sigue el formato del skill actualizado o es una
// versión nueva de una academia conocida, se sabe cómo leer su avance.
export function detectProgress(html: string): ProgressConfig | null {
  const has = (k: string) => html.includes(`'${k}'`) || html.includes(`"${k}"`);
  if (has(CONTRACT_PROGRESS.key)) return CONTRACT_PROGRESS;
  return CATALOG.find((e) => has(e.progress.key))?.progress ?? null;
}

export function htmlTitle(html: string): string | null {
  const m = html.match(/<title>([^<]{1,200})<\/title>/i);
  return m ? m[1].trim() : null;
}
