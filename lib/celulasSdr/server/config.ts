// Parámetros globales de "Configurar" del módulo Células SDR (tabla
// sdr_cells_config). Lo usan la ruta /api/celulas-sdr/config y el envío
// diario de alertas por correo.
import { supabaseAdmin } from "@/lib/supabase";
import { DEFAULT_CONFIG, type CellsConfig } from "@/lib/celulasSdr/types";

const NUM_KEYS = ["green", "yellow", "callGoal", "actGoal", "noshowMax", "connectMin", "connectTarget", "attendTarget", "oppTarget", "cap", "qTarget", "qGood", "qReg"] as const;

export function sanitizeConfig(input: any): CellsConfig {
  const out: CellsConfig = { ...DEFAULT_CONFIG, clientWeights: {}, oppValues: [...DEFAULT_CONFIG.oppValues] };
  if (!input || typeof input !== "object") return out;
  for (const k of NUM_KEYS) {
    const v = Number(input[k]);
    if (isFinite(v) && v >= 0) (out as any)[k] = v;
  }
  if (out.yellow > out.green) [out.yellow, out.green] = [out.green, out.yellow];
  if (out.qReg > out.qGood) [out.qReg, out.qGood] = [out.qGood, out.qReg];
  if (input.goalBase === "fecha" || input.goalBase === "mes") out.goalBase = input.goalBase;
  if (Array.isArray(input.oppValues)) out.oppValues = input.oppValues.filter((x: unknown) => typeof x === "string").slice(0, 50);
  if (input.clientWeights && typeof input.clientWeights === "object") {
    for (const [k, v] of Object.entries(input.clientWeights)) {
      const n = Number(v);
      if (isFinite(n) && n >= 0) out.clientWeights[k] = n;
    }
  }
  return out;
}

export async function loadConfig(): Promise<CellsConfig> {
  const { data, error } = await supabaseAdmin().from("sdr_cells_config").select("config").eq("id", "global").maybeSingle();
  if (error) return { ...DEFAULT_CONFIG };
  return sanitizeConfig(data?.config);
}
