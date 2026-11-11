import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/aiUsageLogger";
import { getUserIdFromRequest, supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Los PDFs grandes pueden tardar; ampliar timeout en Vercel
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BUCKET = "training-files";

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  const contentType = req.headers.get("content-type") ?? "";

  let base64 = "";
  let isPdf = true;
  let plainText: string | null = null;

  try {
    if (contentType.includes("application/json")) {
      // Flujo alternativo: el archivo ya fue subido a Supabase Storage desde el browser
      const body = await req.json();
      const { storage_path } = body as { storage_path?: string };
      if (!storage_path) return NextResponse.json({ error: "storage_path requerido" }, { status: 400 });

      const db = supabaseAdmin();
      const { data, error } = await db.storage.from(BUCKET).download(storage_path);
      if (error || !data) return NextResponse.json({ error: "No se pudo leer el archivo de Storage" }, { status: 500 });

      const ext = storage_path.split(".").pop()?.toLowerCase();
      isPdf = ext === "pdf";
      if (!isPdf) {
        plainText = await data.text();
      } else {
        const ab = await data.arrayBuffer();
        base64 = Buffer.from(ab).toString("base64");
      }

      // Limpiar el archivo de Storage después de procesarlo
      db.storage.from(BUCKET).remove([storage_path]).catch(() => {});
    } else {
      // Flujo original: archivo enviado directamente como form-data (archivos < 4.5MB)
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

      isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

      if (!isPdf) {
        plainText = await file.text();
      } else {
        const arrayBuffer = await file.arrayBuffer();
        base64 = Buffer.from(arrayBuffer).toString("base64");
      }
    }

    if (!isPdf && plainText !== null) {
      // Para archivos de texto plano, devolver el contenido directamente
      return NextResponse.json({ text: plainText.trim(), pages: 1 });
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: "Extrae y devuelve TODO el texto de este documento PDF, manteniendo la estructura original (párrafos, listas, títulos). No añadas comentarios ni explicaciones, solo el texto extraído.",
            },
          ],
        },
      ],
    });

    void logAiUsage({
      userId,
      functionName: "training_parse_pdf",
      model: "claude-haiku-4-5-20251001",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();

    if (!text) {
      return NextResponse.json(
        { error: "El PDF no contiene texto extraíble (puede ser una imagen escaneada sin OCR)" },
        { status: 422 }
      );
    }

    return NextResponse.json({ text, pages: 1 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: `No se pudo procesar el PDF: ${message}` }, { status: 422 });
  }
}
