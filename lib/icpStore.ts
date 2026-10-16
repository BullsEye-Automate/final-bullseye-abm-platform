import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deserializeIcpForm,
  serializeSectionForm,
  type IndustrySectionKey,
} from "@/lib/icp-form";

// Lectura/escritura del ICP de un cliente, compartida entre el formulario
// público por link (/api/forms/icp/[token]), el portal de clientes y la
// aprobación de propuestas (/api/portal-admin/icp-requests).
//
// El ICP vive en dos lugares según el modo del cliente:
//   - general:      client_ai_context (file_type = 'icp'), un solo texto
//   - por industria: icp_industry_sections, un texto por sección

export const INDUSTRY_SECTIONS: IndustrySectionKey[] = [
  "target_company",
  "fit_signals",
  "buyer_persona",
  "value_prop",
  "outreach",
  "reference_clients",
];

export type IcpIndustry = { id: string; name: string };

export async function listClientIndustries(db: SupabaseClient, clientId: string): Promise<IcpIndustry[]> {
  const { data } = await db
    .from("icp_industries")
    .select("id, name")
    .eq("client_id", clientId)
    .order("sort_order", { ascending: true });
  return (data ?? []) as IcpIndustry[];
}

// Verifica que la industria pertenezca al cliente (evita leer/escribir
// secciones de otro cliente pasando un industry_id ajeno).
export async function getClientIndustry(
  db: SupabaseClient,
  clientId: string,
  industryId: string
): Promise<IcpIndustry | null> {
  const { data } = await db
    .from("icp_industries")
    .select("id, name")
    .eq("id", industryId)
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as IcpIndustry | null) ?? null;
}

// Devuelve el ICP vigente como texto serializado ("" si no hay)
export async function loadIcpContent(
  db: SupabaseClient,
  clientId: string,
  industryId: string | null
): Promise<string> {
  if (industryId) {
    const { data: rows } = await db
      .from("icp_industry_sections")
      .select("content")
      .eq("industry_id", industryId);
    return (rows ?? [])
      .map((r: { content: string }) => r.content)
      .filter(Boolean)
      .join("\n\n");
  }

  const { data } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.content as string | undefined) ?? "";
}

// Guarda el ICP. Quien llama debe haber validado que industryId pertenece
// al cliente (getClientIndustry).
export async function saveIcpContent(
  db: SupabaseClient,
  clientId: string,
  industryId: string | null,
  content: string
): Promise<{ error: string | null }> {
  if (industryId) {
    const form = deserializeIcpForm(content);
    const now = new Date().toISOString();
    const upserts = INDUSTRY_SECTIONS.map((sectionKey) => ({
      industry_id: industryId,
      section_key: sectionKey,
      content: serializeSectionForm(sectionKey, form),
      copied_from_industry_id: null,
      updated_at: now,
    }));
    const { error } = await db
      .from("icp_industry_sections")
      .upsert(upserts, { onConflict: "industry_id,section_key" });
    return { error: error?.message ?? null };
  }

  const { data: existing } = await db
    .from("client_ai_context")
    .select("id")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("client_ai_context")
      .update({ content, uploaded_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { error: error?.message ?? null };
  }

  const { error } = await db.from("client_ai_context").insert({
    client_id: clientId,
    file_type: "icp",
    file_name: "ICP",
    content,
  });
  return { error: error?.message ?? null };
}
