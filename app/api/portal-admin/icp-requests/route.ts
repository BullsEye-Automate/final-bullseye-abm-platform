import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadIcpContent } from "@/lib/icpStore";
import { diffIcpContent } from "@/lib/icp-form";

export const dynamic = "force-dynamic";

type RequestRow = {
  id: string;
  client_id: string;
  industry_id: string | null;
  previous_content: string;
  proposed_content: string;
  client_comment: string | null;
  status: "pending" | "approved" | "rejected";
  submitted_by_email: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  clients: { name: string } | { name: string }[] | null;
  icp_industries: { name: string } | { name: string }[] | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

// GET — propuestas de ICP enviadas desde el portal.
// ?status=pending (default) | approved | rejected | all · ?client_id=
// Para las pendientes, la comparación se hace contra el ICP vigente HOY (no
// contra el que vio el cliente al enviar), y se marca `stale` si el equipo lo
// editó entretanto — aprobar reemplazaría esos cambios.
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") || "pending";
  const clientId = req.nextUrl.searchParams.get("client_id");
  const db = supabaseAdmin();

  let q = db
    .from("icp_change_requests")
    .select("*, clients(name), icp_industries(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") q = q.eq("status", status);
  if (clientId) q = q.eq("client_id", clientId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as RequestRow[];
  const requests = await Promise.all(
    rows.map(async (r) => {
      const isPending = r.status === "pending";
      const current = isPending ? await loadIcpContent(db, r.client_id, r.industry_id) : r.previous_content;
      return {
        id: r.id,
        client_id: r.client_id,
        client_name: one(r.clients)?.name ?? "—",
        industry_id: r.industry_id,
        industry_name: one(r.icp_industries)?.name ?? null,
        status: r.status,
        client_comment: r.client_comment,
        submitted_by_email: r.submitted_by_email,
        review_note: r.review_note,
        reviewed_by: r.reviewed_by,
        reviewed_at: r.reviewed_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
        proposed_content: r.proposed_content,
        stale: isPending && current.trim() !== (r.previous_content ?? "").trim(),
        diff: diffIcpContent(current, r.proposed_content),
      };
    })
  );

  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
