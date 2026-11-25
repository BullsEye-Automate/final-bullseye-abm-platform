import { supabaseAdmin } from "@/lib/supabase";

// Ampliar la búsqueda de recomendaciones soltando filtros del ICP
// (relaxFilters en lib/wishlistRecommendations.ts) queda APAGADO por defecto
// (pedido de BullsEye, 25-nov-2026: se busca solo con el ICP tal cual, aunque
// salgan menos empresas). Se enciende por cliente solo cuando el cliente lo
// aprueba formalmente, y queda registrado quién, cuándo y con qué respaldo.
// Fila id = 'reco_ampliar' de sdr_cells_config (sin migración):
// { clients: { [client_id]: { by, at, nota } } }

const ROW_ID = "reco_ampliar";
export type AmpliarEntry = { by: string; at: string; nota: string };
type Row = { clients?: Record<string, AmpliarEntry> };

async function readRow(): Promise<Row> {
  const { data } = await supabaseAdmin().from("sdr_cells_config").select("config").eq("id", ROW_ID).maybeSingle();
  return ((data?.config as Row | null) ?? {}) as Row;
}

export async function getAmpliarClients(): Promise<Record<string, AmpliarEntry>> {
  return (await readRow()).clients ?? {};
}

export async function canRelaxFor(clientId: string): Promise<boolean> {
  return !!(await getAmpliarClients().catch(() => ({} as Record<string, AmpliarEntry>)))[clientId];
}

export async function setAmpliar(clientId: string, on: boolean, by: string, nota: string): Promise<Record<string, AmpliarEntry>> {
  const row = await readRow();
  const clients = { ...(row.clients ?? {}) };
  if (on) clients[clientId] = { by, at: new Date().toISOString(), nota: nota.slice(0, 500) };
  else delete clients[clientId];
  const { error } = await supabaseAdmin().from("sdr_cells_config").upsert(
    { id: ROW_ID, config: { ...row, clients }, updated_by: by, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
  return clients;
}
