import { notFound } from "next/navigation";
import { tokenToClientId } from "@/lib/form-token";
import { supabaseAdmin } from "@/lib/supabase";
import IcpPublicForm from "./IcpPublicForm";

// Server component: valida el token y pasa datos al formulario cliente
export default async function PublicIcpFormPage({
  params,
}: {
  params: { token: string };
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
