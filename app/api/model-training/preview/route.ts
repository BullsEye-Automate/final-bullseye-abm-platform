// Preview en vivo del messageGenerator con un draft de config (sin
// guardar). El front manda la config que está editando + un contacto
// (o random) y obtiene un mensaje generado con esa config.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateMessages, type MessageInput } from "@/lib/messageGenerator";
import type { ModelTrainingConfig } from "@/lib/modelTrainingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  // Config draft a usar para la preview. Si no se manda, usa la activa
  // (mismo path que el comportamiento productivo).
  config?: Partial<ModelTrainingConfig> | null;
  // Contacto sobre el que generar. Si solo se pasa contact_id, busca en
  // DB. Si se pasa el objeto completo, se usa directo (útil para tests).
  contact_id?: string | null;
  contact?: Partial<MessageInput>;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;

  let input: MessageInput | null = null;

  if (body.contact_id) {
    const db = supabaseAdmin();
    const { data: c } = await db
      .from("contacts")
      .select(
        "first_name, last_name, job_title, linkedin_headline, seniority, " +
          "company_id, companies(company_name, company_size, company_type, cad_software, scanner_technology, fit_signals)"
      )
      .eq("id", body.contact_id)
      .maybeSingle();
    if (c) {
      const co = ((c as any).companies ?? {}) as {
        company_name?: string | null;
        company_size?: number | null;
        company_type?: string | null;
        cad_software?: string | null;
        scanner_technology?: string | null;
        fit_signals?: string | null;
      };
      input = {
        first_name: (c as any).first_name ?? null,
        last_name: (c as any).last_name ?? null,
        job_title: (c as any).job_title ?? null,
        linkedin_headline: (c as any).linkedin_headline ?? null,
        seniority: (c as any).seniority ?? null,
        company_name: co.company_name ?? null,
        company_size: co.company_size ?? null,
        company_type: co.company_type ?? null,
        cad_software: co.cad_software ?? null,
        scanner_technology: co.scanner_technology ?? null,
        fit_signals: co.fit_signals ?? null
      };
    }
  }

  if (!input && body.contact) {
    input = {
      first_name: body.contact.first_name ?? null,
      last_name: body.contact.last_name ?? null,
      job_title: body.contact.job_title ?? null,
      linkedin_headline: body.contact.linkedin_headline ?? null,
      seniority: body.contact.seniority ?? null,
      company_name: body.contact.company_name ?? null,
      company_size: body.contact.company_size ?? null,
      company_type: body.contact.company_type ?? null,
      cad_software: body.contact.cad_software ?? null,
      scanner_technology: body.contact.scanner_technology ?? null,
      fit_signals: body.contact.fit_signals ?? null
    };
  }

  if (!input) {
    // Sin contacto: usamos un sample default razonable para probar.
    input = {
      first_name: "Sarah",
      last_name: "Johnson",
      job_title: "Lab Manager",
      linkedin_headline: "Helping our team scale digital workflows",
      seniority: null,
      company_name: "Bright Dental Lab",
      company_size: 25,
      company_type: "lab",
      cad_software: "exocad",
      scanner_technology: "Medit i700",
      fit_signals:
        "Lab dental mediano · usa exocad confirmado · escaner Medit i700 · contratando CAD designer"
    };
  }

  // Armamos la config draft (acepta partial) o null si no vino nada.
  let draftConfig: ModelTrainingConfig | null = null;
  if (body.config) {
    const c = body.config;
    draftConfig = {
      id: "preview",
      is_active: true,
      language: (c.language as string | null) ?? null,
      register: (c.register as string | null) ?? null,
      icebreaker_max_chars: typeof c.icebreaker_max_chars === "number" ? c.icebreaker_max_chars : null,
      subject_max_words: typeof c.subject_max_words === "number" ? c.subject_max_words : null,
      body_max_words: typeof c.body_max_words === "number" ? c.body_max_words : null,
      forbidden_phrases: Array.isArray(c.forbidden_phrases) ? c.forbidden_phrases : [],
      required_phrases: Array.isArray(c.required_phrases) ? c.required_phrases : [],
      talking_points: Array.isArray(c.talking_points) ? c.talking_points : [],
      value_props: Array.isArray(c.value_props) ? c.value_props : [],
      notes: typeof c.notes === "string" ? c.notes : null,
      created_at: "",
      updated_at: ""
    };
  }

  try {
    const result = await generateMessages(input, draftConfig);
    return NextResponse.json({ ok: true, input, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ ok: false, error: msg, input }, { status: 500 });
  }
}
