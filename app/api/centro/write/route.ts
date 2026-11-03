import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { deleteDoc, isCollection, isDocId, writeDoc } from "@/lib/centroProspeccion/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Escrituras de la página (set / update / delete), en orden. Igual que en el
// artifact, la página escribe sin versión (la última escritura gana); el
// control de versión lo usan las tareas programadas por el conector MCP.
type Op = { op: "set" | "update" | "delete"; c: string; id: string; d?: Record<string, unknown> };

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const body = await req.json().catch(() => null);
  const ops: Op[] = Array.isArray(body?.ops) ? body.ops : [];
  if (!ops.length || ops.length > 50) return NextResponse.json({ error: "Entre 1 y 50 operaciones" }, { status: 400 });
  for (const o of ops) {
    if (!["set", "update", "delete"].includes(o?.op) || !isCollection(o.c) || !isDocId(o.id)) {
      return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
    }
    if (o.op !== "delete" && (typeof o.d !== "object" || o.d === null || Array.isArray(o.d))) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
  }
  const results: { status: string; version?: number | null }[] = [];
  try {
    for (const o of ops) {
      if (!isCollection(o.c)) continue;
      if (o.op === "delete") {
        results.push(await deleteDoc({ collection: o.c, docId: o.id, by: u.email, source: "portal" }));
      } else {
        results.push(await writeDoc({ collection: o.c, docId: o.id, data: o.d!, mode: o.op, by: u.email, source: "portal" }));
      }
    }
    const failed = results.find((r) => r.status === "not_found");
    if (failed) return NextResponse.json({ error: "El documento ya no existe", code: "not-found", results }, { status: 404 });
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, results }, { status: 500 });
  }
}
