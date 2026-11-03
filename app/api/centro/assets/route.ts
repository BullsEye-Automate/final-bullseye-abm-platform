import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { prepareUpload } from "@/lib/centroProspeccion/assets";

export const dynamic = "force-dynamic";

// Prepara la subida de un archivo: registra el id y entrega una URL firmada
// a la que el navegador sube el archivo directo (PUT).
export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const body = await req.json().catch(() => null);
  const fileName = typeof body?.fileName === "string" ? body.fileName : "archivo";
  const contentType = typeof body?.contentType === "string" ? body.contentType : "application/octet-stream";
  const size = Number(body?.size);
  try {
    return NextResponse.json(await prepareUpload({ fileName, contentType, size, by: u.email }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
