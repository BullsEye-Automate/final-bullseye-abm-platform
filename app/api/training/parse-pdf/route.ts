import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Los PDFs grandes pueden tardar; ampliar timeout en Vercel
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });

    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

    if (!isPdf) {
      // Para archivos de texto plano, devolver el contenido directamente
      const text = await file.text();
      return NextResponse.json({ text: text.trim(), pages: 1 });
    }

    // Convertir a base64 para enviarlo a Claude
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

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
