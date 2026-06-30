import { notFound } from "next/navigation";
import { tokenToClientId } from "@/lib/form-token";
import { supabaseAdmin } from "@/lib/supabase";
import IcpPublicForm from "./IcpPublicForm";

export default async function PublicIcpFormPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { industry_id?: string };
}) {
  const clientId = tokenToClientId(params.token);
  if (!clientId) notFound();

  const db = supabaseAdmin();

  const { data: client } = await db
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .single();

  if (!client) notFound();

  const industryId = searchParams.industry_id ?? null;

  // Modo industria: cargar secciones existentes y nombre de industria
  if (industryId) {
    const { data: industry } = await db
      .from("icp_industries")
      .select("id, name")
      .eq("id", industryId)
      .eq("client_id", clientId)
      .single();

    if (!industry) notFound();

    const { data: rows } = await db
      .from("icp_industry_sections")
      .select("content")
      .eq("industry_id", industryId);

    const combinedContent = (rows ?? []).map((r) => r.content).filter(Boolean).join("\n\n");

    return (
      <IcpPublicForm
        token={params.token}
        clientName={client.name}
        initialContent={combinedContent || null}
        industryId={industry.id}
        industryName={industry.name}
      />
    );
  }

  // Modo general
  const { data: icp } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", clientId)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <IcpPublicForm
      token={params.token}
      clientName={client.name}
      initialContent={icp?.content ?? null}
    />
  );
}
