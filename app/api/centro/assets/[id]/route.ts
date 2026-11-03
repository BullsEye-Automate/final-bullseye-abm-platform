import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { deleteAsset, signedAssetUrl } from "@/lib/centroProspeccion/assets";

export const dynamic = "force-dynamic";

// Abrir un archivo: redirige a un link firmado de 1 hora.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const url = await signedAssetUrl(params.id);
  if (!url) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  return NextResponse.redirect(url);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  try {
    await deleteAsset(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
