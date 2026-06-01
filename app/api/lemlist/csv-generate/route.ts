import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ParsedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  companyName?: string;
  linkedinUrl?: string;
  industry?: string;
};

type GeneratedContact = ParsedContact & {
  emailSubject?: string;
  emailBody?: string;
  icebreaker?: string;
  error?: string;
};

export async function POST(req: NextRequest) {
  let body: { client_id: string; contacts: ParsedContact[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { client_id, contacts } = body;
  if (!client_id || !contacts?.length) {
    return NextResponse.json({ error: "Se requiere client_id y contacts" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Cargar contexto ICP del cliente
  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", client_id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let trainingConfig: Record<string, string | null> = {};
  try {
    const { data: tc } = await db
      .from("model_training_config")
      .select("business_description, value_props, talking_points, target_buyer_persona")
      .eq("client_id", client_id)
      .maybeSingle();
    trainingConfig = tc ?? {};
  } catch { /* tabla puede no existir */ }

  const icpContext = [
    icpCtx?.content,
    trainingConfig.business_description && `Descripción del negocio: ${trainingConfig.business_description}`,
    trainingConfig.value_props          && `Propuestas de valor: ${trainingConfig.value_props}`,
    trainingConfig.talking_points       && `Puntos clave de conversación: ${trainingConfig.talking_points}`,
    trainingConfig.target_buyer_persona && `Buyer persona: ${trainingConfig.target_buyer_persona}`,
  ].filter(Boolean).join("\n\n") || undefined;

  // Generar mensajes en lotes de 3 contactos en paralelo
  const BATCH_SIZE = 3;
  const results: GeneratedContact[] = [];

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (c): Promise<GeneratedContact> => {
        try {
          const msgs = await generateContactMessages({
            hasEmail: Boolean(c.email?.trim()),
            firstName: c.firstName || undefined,
            lastName: c.lastName || undefined,
            jobTitle: c.jobTitle || undefined,
            companyName: c.companyName || undefined,
            icpContext,
            language: "es",
          });
          return {
            ...c,
            emailSubject: msgs.emailSubject,
            emailBody:    msgs.emailBody,
            icebreaker:   msgs.linkedinIcebreaker ?? msgs.linkedinIcebreakerNoEmail,
          };
        } catch (err: any) {
          return { ...c, error: err?.message ?? "Error de generación" };
        }
      })
    );
    results.push(...batchResults);
  }

  return NextResponse.json({ results });
}
