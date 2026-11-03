import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { LIVE_COLLECTIONS, readDeletes, readDocs } from "@/lib/centroProspeccion/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sincronización de la página: sin `since` entrega todas las colecciones
// vivas; con `since` (ISO) solo lo que cambió y lo que se borró desde ahí.
// `now` va 10 s atrás para cubrir escrituras que se confirmaron justo
// mientras se leía (la página descarta lo repetido por versión).
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const since = req.nextUrl.searchParams.get("since");
  if (since && Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "since inválido" }, { status: 400 });
  try {
    const now = new Date(Date.now() - 10_000).toISOString();
    const [docs, deleted] = await Promise.all([
      readDocs(LIVE_COLLECTIONS, { since }),
      since ? readDeletes(LIVE_COLLECTIONS, since) : Promise.resolve([]),
    ]);
    return NextResponse.json({
      now,
      full: !since,
      docs: docs.map((d) => ({ c: d.collection, id: d.doc_id, d: d.data, v: d.version })),
      deleted: deleted.map((d) => ({ c: d.collection, id: d.doc_id })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
