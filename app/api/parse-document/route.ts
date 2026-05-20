import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "FormData requerido" }, { status: 400 });

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Campo 'file' requerido" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (ext === "pdf") {
      const pdfModule = await import("pdf-parse");
      const pdfParse = (pdfModule as any).default ?? pdfModule;
      const data = await pdfParse(buffer);
      return NextResponse.json({ text: data.text ?? "" });
    }

    if (ext === "docx" || ext === "doc") {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      return NextResponse.json({ text: result.value ?? "" });
    }

    // TXT / MD — leer como texto plano
    const text = buffer.toString("utf-8");
    return NextResponse.json({ text });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error al parsear archivo" }, { status: 500 });
  }
}
