import { supabaseAdmin } from "@/lib/supabase";

export type ClientContextData = {
  clientName: string;
  aiContext: string[];       // textos de los documentos subidos
  icpNotes: string | null;  // notas del ICP activo
};

export async function getClientContext(clientId: string): Promise<ClientContextData> {
  const db = supabaseAdmin();

  const [{ data: client }, { data: aiDocs }, { data: icp }] = await Promise.all([
    db.from("clients").select("name").eq("id", clientId).single(),
    db.from("client_ai_context").select("content, file_name").eq("client_id", clientId),
    db.from("icp_config").select("notes").eq("client_id", clientId).eq("is_active", true).maybeSingle(),
  ]);

  return {
    clientName: client?.name ?? "Cliente",
    aiContext: (aiDocs ?? [])
      .map((d: { content: string | null; file_name: string }) => d.content ?? "")
      .filter(Boolean),
    icpNotes: icp?.notes ?? null,
  };
}
