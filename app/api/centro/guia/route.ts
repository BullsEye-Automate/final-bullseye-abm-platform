import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";

export const dynamic = "force-dynamic";

// Guía del equipo de prospección (PDF) que se abre desde el Centro. Solo para
// el equipo con sesión. Fuente editable en docs/centro-prospeccion/guia/
// (guia.html → PDF con Playwright, ver mk2.js).
export async function GET() {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  try {
    const pdf = await readFile(path.join(process.cwd(), "content/centro/guia-equipo-prospeccion.pdf"));
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="Guia-equipo-prospeccion.pdf"',
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Guía no disponible" }, { status: 404 });
  }
}
