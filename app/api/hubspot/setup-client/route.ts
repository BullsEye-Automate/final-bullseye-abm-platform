import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { buildClientLists, createHSListFolder, createHSList } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: client } = await db
    .from("clients")
    .select("name")
    .eq("id", body.client_id)
    .maybeSingle();

  if (!client?.name) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  const clientName = client.name;

  // Carpeta (falla silenciosamente — las listas se crean igual sin carpeta)
  const folderId = await createHSListFolder(clientName).catch(() => null);

  // Crear las 3 listas capturando errores individuales para diagnóstico
  const listDefs = buildClientLists(clientName, folderId);
  const results  = await Promise.all(listDefs.map(createHSList));

  const created = results.filter((r) => r.status === "created").length;
  const errored = results.filter((r) => r.status === "error");

  return NextResponse.json({
    client: clientName,
    folder: { id: folderId, created: folderId !== null },
    lists: {
      created,
      errors: errored.length,
      detail: results,
      errorMessages: errored.map((r) => `${r.name}: ${r.error}`),
    },
  });
}
