import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { isCollection, isDocId, readDoc } from "@/lib/centroProspeccion/store";

export const dynamic = "force-dynamic";

// Un documento suelto (adjuntos y resultados no se sincronizan completos).
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const c = req.nextUrl.searchParams.get("c");
  const id = req.nextUrl.searchParams.get("id");
  if (!isCollection(c) || !isDocId(id)) return NextResponse.json({ error: "Documento inválido" }, { status: 400 });
  try {
    const row = await readDoc(c, id);
    return NextResponse.json(row ? { exists: true, d: row.data, v: row.version } : { exists: false });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
