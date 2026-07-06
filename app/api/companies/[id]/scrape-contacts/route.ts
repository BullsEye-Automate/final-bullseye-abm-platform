import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { perplexitySearch } from "@/lib/perplexity";
import { intakeContactsForCompany } from "@/lib/contactsIntake";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data: company } = await db.from("companies").select("*").eq("id", params.id).single();
  if (!company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  if (!company.company_website && !company.company_name) {
    return NextResponse.json({ error: "La empresa no tiene sitio web" }, { status: 400 });
  }

  const target = company.company_website ?? company.company_name;
  const results = await perplexitySearch({
    system: "Eres un asistente que extrae información de equipos directivos de empresas.",
    user: `Busca el equipo de liderazgo de ${target}: CEO, director, gerente, manager. Incluye nombres completos y cargos.`,
  }).catch(() => null);
  if (!results?.content) {
    return NextResponse.json({ found: 0, summary: { yes: 0, no: 0, skipped: 0 } });
  }

  const msg = await anthropic().messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `Extract team members from this research about "${company.company_name}".
Return a JSON array of people found: [{"first_name":"","last_name":"","job_title":"","linkedin_url":null,"email":null}]
Only include real named people with job titles. Return ONLY the JSON array.

Research:
${results.content.slice(0, 4000)}`
    }]
  }).catch(() => null);

  const raw = msg?.content?.find((b: { type: string }) => b.type === "text")
    ? (msg!.content.find((b: { type: string }) => b.type === "text") as { type: "text"; text: string }).text
    : "[]";
  let people: { first_name?: string; last_name?: string; job_title?: string; linkedin_url?: string; email?: string }[] = [];
  try { people = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? "[]"); } catch { people = []; }

  if (!people.length) {
    return NextResponse.json({ found: 0, summary: { yes: 0, no: 0, skipped: 0 } });
  }

  const intakeResult = await intakeContactsForCompany(db, params.id, people).catch((err) => ({
    ok: false as const,
    status: 500,
    error: String(err?.message ?? err),
  }));
  if (!intakeResult.ok) {
    return NextResponse.json({ error: intakeResult.error }, { status: intakeResult.status });
  }

  return NextResponse.json({ found: people.length, summary: intakeResult.summary });
}
