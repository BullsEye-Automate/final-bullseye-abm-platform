import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { isCollection, isDocId, writeDoc } from "@/lib/centroProspeccion/store";
import { putAsset } from "@/lib/centroProspeccion/assets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Importación del respaldo exportado del artifact (solo administradores).
// La página la llama en tandas para no pasar el límite de 4,5 MB de Vercel:
//   {action: "reset", collections}          borra esas colecciones
//   {action: "docs", collection, docs}      escribe hasta 200 documentos
//   {action: "asset", id, fileName, contentType, base64}  sube un archivo
export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo el administrador del Centro puede importar" }, { status: 403 });
  const body = await req.json().catch(() => null);
  try {
    if (body?.action === "reset") {
      const cols: string[] = Array.isArray(body.collections) ? body.collections.filter(isCollection) : [];
      if (!cols.length) return NextResponse.json({ error: "Sin colecciones" }, { status: 400 });
      const { error } = await supabaseAdmin().from("centro_docs").delete().in("collection", cols);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "docs") {
      const c = body.collection;
      const docs: { id: string; data: Record<string, unknown> }[] = Array.isArray(body.docs) ? body.docs : [];
      if (!isCollection(c) || docs.length > 200) return NextResponse.json({ error: "Tanda inválida" }, { status: 400 });
      let n = 0;
      for (const d of docs) {
        if (!isDocId(d?.id) || typeof d.data !== "object" || d.data === null) continue;
        await writeDoc({ collection: c, docId: d.id, data: d.data, mode: "set", by: u.email, source: "migration" });
        n++;
      }
      return NextResponse.json({ ok: true, written: n });
    }
    if (body?.action === "asset") {
      const bytes = Buffer.from(String(body.base64 ?? ""), "base64");
      if (!bytes.length) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
      await putAsset({ id: String(body.id), fileName: String(body.fileName ?? "archivo"), contentType: String(body.contentType ?? "application/octet-stream"), bytes, by: u.email });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
