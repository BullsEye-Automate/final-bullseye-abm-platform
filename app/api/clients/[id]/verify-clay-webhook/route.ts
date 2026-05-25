import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  const { url, type } = body ?? {};

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL requerida" }, { status: 400 });
  }
  if (type !== "companies" && type !== "contacts") {
    return NextResponse.json(
      { error: "type debe ser 'companies' o 'contacts'" },
      { status: 400 }
    );
  }

  let clayRes: Response;
  try {
    clayRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
      cache: "no-store",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `No se pudo conectar: ${err?.message ?? "error de red"}` },
      { status: 502 }
    );
  }

  if (!clayRes.ok) {
    const text = await clayRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Clay respondió ${clayRes.status}: ${text.slice(0, 200) || "sin body"}` },
      { status: 400 }
    );
  }

  const field =
    type === "companies"
      ? "clay_companies_webhook_url"
      : "clay_contacts_webhook_url";

  const db = supabaseAdmin();
  const { error: saveErr } = await db
    .from("clients")
    .update({ [field]: url })
    .eq("id", params.id);

  if (saveErr) {
    return NextResponse.json({ error: saveErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
