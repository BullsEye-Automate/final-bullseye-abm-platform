import { NextRequest, NextResponse } from "next/server";
// pdf-parse v2 exporta con nombre: { PDFParse }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require("pdf-parse");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse();
    const data = await parser.parse(buffer);
    const text = (data.text ?? data.content ?? "").trim();

    if (!text) return NextResponse.json({ error: "El PDF no contiene texto extraíble (puede ser una imagen escaneada)" }, { status: 422 });

    return NextResponse.json({ text, pages: data.numpages ?? data.pages ?? 1 });
  } catch (err: any) {
    return NextResponse.json({ error: `No se pudo procesar el PDF: ${err?.message ?? "error desconocido"}` }, { status: 422 });
  }
}
