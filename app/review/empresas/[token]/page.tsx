import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import CompanyReviewPublic from "./CompanyReviewPublic";

export default async function CompanyReviewPage({
  params,
}: {
  params: { token: string };
}) {
  const db = supabaseAdmin();

  const { data: session } = await db
    .from("company_review_sessions")
    .select("id, client_id, expires_at, label")
    .eq("token", params.token)
    .single();

  if (!session) notFound();

  const expired = new Date(session.expires_at) < new Date();

  const { data: client } = await db
    .from("clients")
    .select("name")
    .eq("id", session.client_id)
    .single();

  // Si expirado, renderizar página de expirado (sin datos de empresas)
  if (expired) {
    return (
      <CompanyReviewPublic
        token={params.token}
        clientName={client?.name ?? ""}
        initialCompanies={[]}
        sessionLabel={session.label ?? null}
        expired
      />
    );
  }

  const { data: items } = await db
    .from("company_review_session_items")
    .select("company_id")
    .eq("session_id", session.id);

  const companyIds = (items ?? []).map((i: { company_id: string }) => i.company_id);

  const { data: companies } = companyIds.length
    ? await db
        .from("companies")
        .select(
          "id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, fit_score, fit_signals, research_summary, status"
        )
        .in("id", companyIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <CompanyReviewPublic
      token={params.token}
      clientName={client?.name ?? ""}
      initialCompanies={companies ?? []}
      sessionLabel={session.label ?? null}
      expired={false}
    />
  );
}
