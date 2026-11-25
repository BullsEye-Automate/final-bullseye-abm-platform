import { NextResponse } from "next/server";
import { isCentroOwner, requireCentroUser } from "@/lib/centroProspeccion/access";
import { readDocs, writeDoc } from "@/lib/centroProspeccion/store";
import { CRITERIA_FIELDS, stripIntelLines } from "@/lib/centroProspeccion/intel/sugerencias";

export const dynamic = "force-dynamic";

// Quita de los campos de criterio de las fichas las líneas que se anotaban al
// aprobar una propuesta de la inteligencia (antes del 25-nov-2026). No se
// pierden: siguen en centro_intel y se ven en «Sugerencias para presentar al
// cliente». GET = vista previa; POST = aplicar (solo la dueña del Centro).
async function run(apply: boolean, by: string) {
  const docs = await readDocs(["clientes"]);
  const out: { ficha: string; campos: { campo: string; quitadas: number }[]; estado: string }[] = [];
  for (const d of docs) {
    const patch: Record<string, string> = {};
    const campos: { campo: string; quitadas: number }[] = [];
    for (const k of CRITERIA_FIELDS) {
      const prev = String(d.data[k] ?? "");
      const next = stripIntelLines(prev);
      if (next !== prev.trim()) {
        patch[k] = next;
        campos.push({ campo: k, quitadas: prev.split("\n").length - next.split("\n").length });
      }
    }
    if (!campos.length) continue;
    let estado = "se limpiaría";
    if (apply) {
      const r = await writeDoc({ collection: "clientes", docId: d.doc_id, data: patch, mode: "update", ifVersion: d.version, by, source: "portal" });
      estado = r.status === "ok" ? "limpiada" : `no se pudo guardar (${r.status})`;
    }
    out.push({ ficha: String(d.data.nombre || d.doc_id), campos, estado });
  }
  return out;
}

export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  return NextResponse.json({ fichas: await run(false, u.email) });
}

export async function POST() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo la líder del Centro" }, { status: 403 });
  return NextResponse.json({ fichas: await run(true, u.email) });
}
