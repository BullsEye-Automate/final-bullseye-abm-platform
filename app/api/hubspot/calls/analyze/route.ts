import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnalysisResult = {
  score: number;
  outcome: string;
  outcome_detail?: string;
  is_real_conversation: boolean;
  summary: string;
  next_steps: string;
};

export async function POST(req: NextRequest) {
  let body: { client_id?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Body opcional
  }

  const limit = body.limit ?? 10;
  const db = supabaseAdmin();

  // 1. Obtener llamadas pendientes de análisis con contenido real
  let query = db
    .from("calls")
    .select("id, notes_clean, contact_name, company_name, duration_ms, sdr_name")
    .is("analyzed_at", null)
    .not("notes_clean", "is", null)
    .gt("length(notes_clean)", 30)
    .order("called_at", { ascending: false })
    .limit(limit);

  if (body.client_id) {
    query = query.eq("client_id", body.client_id);
  }

  const { data: pendingCalls, error: fetchError } = await query;

  if (fetchError) {
    return NextResponse.json(
      { error: `Error obteniendo llamadas: ${fetchError.message}` },
      { status: 500 }
    );
  }

  if (!pendingCalls || pendingCalls.length === 0) {
    return NextResponse.json({ analyzed: 0, skipped: 0 });
  }

  const ai = anthropic();
  let analyzed = 0;
  let skipped = 0;

  // 2. Analizar cada llamada con Claude
  for (const call of pendingCalls) {
    try {
      const prompt = `Eres un coach de ventas B2B. Analiza esta llamada comercial y responde SOLO en JSON válido:
{
  "score": <número 1-10 calidad del SDR>,
  "outcome": <"Interesado"|"Objeción"|"Buzón de voz"|"No contesta"|"No decide"|"No aplica"|"Ganado">,
  "outcome_detail": <subtipo opcional, ej: "Timing", "Precio", "No tiene poder">,
  "is_real_conversation": <true si hubo intercambio real de más de 30 segundos>,
  "summary": <2 frases describiendo qué pasó>,
  "next_steps": <1-2 frases con acción concreta específica para el SDR>
}

Criterios de score:
1-3: Llamada muy corta, no logró conectar o fue grosero/mal manejada
4-5: Conectó pero no avanzó, objeciones mal manejadas o no hay próximo paso claro
6-7: Buen manejo, generó interés o dejó mensaje efectivo
8-10: Excelente manejo, logró compromiso o avance significativo

Notas de la llamada:
${call.notes_clean}`;

      const message = await ai.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      const textContent = message.content.find(
        (c: { type: string }) => c.type === "text"
      ) as { type: "text"; text: string } | undefined;
      if (!textContent) {
        skipped++;
        continue;
      }

      // Extraer JSON del response (puede venir dentro de bloques de código)
      const rawText = textContent.text.trim();
      const jsonMatch =
        rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ??
        rawText.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText;

      let result: AnalysisResult;
      try {
        result = JSON.parse(jsonStr);
      } catch {
        skipped++;
        continue;
      }

      // Validar campos mínimos
      if (!result.score || !result.outcome || !result.summary) {
        skipped++;
        continue;
      }

      // 3. Actualizar en Supabase
      const { error: updateError } = await db
        .from("calls")
        .update({
          ai_score: Math.min(10, Math.max(1, Math.round(result.score))),
          ai_outcome: result.outcome,
          ai_outcome_detail: result.outcome_detail ?? null,
          ai_is_real_conversation: result.is_real_conversation ?? false,
          ai_summary: result.summary,
          ai_next_steps: result.next_steps ?? null,
          analyzed_at: new Date().toISOString(),
        })
        .eq("id", call.id);

      if (updateError) {
        skipped++;
      } else {
        analyzed++;
      }
    } catch {
      // Si Claude falla para esta llamada, la saltea y continúa
      skipped++;
    }
  }

  return NextResponse.json({ analyzed, skipped });
}
