import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getLemlistApiKey } from "@/lib/lemlistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushRow = {
  email: string;
  nombre: string;
  apellido: string;
  empresa: string;
  cargo: string;
  senalEmpresa: string;
  hipotesisDolor: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const { client_id, campaign_id, rows }: { client_id: string; campaign_id: string; rows: PushRow[] } = body;
  if (!client_id || !campaign_id || !rows?.length)
    return NextResponse.json({ error: "Se requieren client_id, campaign_id y rows" }, { status: 400 });

  const db = supabaseAdmin();
  const apiKey = await getLemlistApiKey(db, client_id);
  if (!apiKey) return NextResponse.json({ error: "Sin API key de Lemlist para este cliente" }, { status: 400 });

  const creds = Buffer.from(`:${apiKey}`).toString("base64");
  const results: { email: string; status: "ok" | "error"; error?: string }[] = [];

  for (const row of rows) {
    try {
      // Intentar agregar el lead a la campaña con variables personalizadas
      const res = await fetch(
        `https://api.lemlist.com/api/campaigns/${campaign_id}/leads/${encodeURIComponent(row.email)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${creds}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            firstName:       row.nombre,
            lastName:        row.apellido,
            companyName:     row.empresa,
            icebreaker:      row.senalEmpresa,
            // Variables personalizadas que mapean a las etiquetas de la campaña
            senalEmpresa:    row.senalEmpresa,
            hipotesisDolor:  row.hipotesisDolor,
          }),
        }
      );

      if (res.ok) {
        results.push({ email: row.email, status: "ok" });
      } else {
        // Si el lead ya existe, actualizar sus variables
        const errText = await res.text();
        if (res.status === 409 || errText.includes("already")) {
          const patchRes = await fetch(
            `https://api.lemlist.com/api/leads/${encodeURIComponent(row.email)}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Basic ${creds}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                senalEmpresa:   row.senalEmpresa,
                hipotesisDolor: row.hipotesisDolor,
              }),
            }
          );
          results.push({
            email: row.email,
            status: patchRes.ok ? "ok" : "error",
            error: patchRes.ok ? undefined : `PATCH ${patchRes.status}`,
          });
        } else {
          results.push({ email: row.email, status: "error", error: `${res.status}: ${errText.slice(0, 100)}` });
        }
      }
    } catch (e: any) {
      results.push({ email: row.email, status: "error", error: e?.message ?? "Error de red" });
    }
  }

  const ok    = results.filter(r => r.status === "ok").length;
  const error = results.filter(r => r.status === "error").length;
  return NextResponse.json({ ok, error, results });
}
