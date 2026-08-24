import { NextRequest, NextResponse } from "next/server";
import { getAlloCallDetail, fetchAlloRecording } from "@/lib/allo";

export const dynamic = "force-dynamic";

// Proxy del audio de la grabación: el navegador no puede mandar la API key
// de Allo, así que <audio> apunta acá en vez de directo a recording_url.
// Reenvía el header Range para que el reproductor pueda buscar dentro del
// audio en vez de tener que cargarlo completo.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const call = await getAlloCallDetail(params.id);
    if (!call.recording_url) {
      return NextResponse.json({ error: "Esta llamada no tiene grabación" }, { status: 404 });
    }

    const upstream = await fetchAlloRecording(call.recording_url, req.headers.get("range"));
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `No se pudo obtener la grabación desde Allo (${upstream.status})` },
        { status: 502 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
    headers.set("Accept-Ranges", "bytes");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error obteniendo la grabación" }, { status: 500 });
  }
}
