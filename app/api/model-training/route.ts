// GET / PATCH de la config activa de mensajes IA.
//
// GET: devuelve la config activa (o null si no existe). El front
// rellena los campos con esos valores o queda con defaults vacíos.
//
// PATCH: actualiza la config activa (upsert). Si no existe ninguna
// fila, crea la primera. Solo hay UNA fila activa a la vez.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadActiveModelTrainingConfig } from "@/lib/modelTrainingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseAdmin();
  const config = await loadActiveModelTrainingConfig(db);
  return NextResponse.json(
    { config },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

type PatchBody = {
  language?: string | null;
  register?: string | null;
  icebreaker_max_chars?: number | null;
  subject_max_words?: number | null;
  body_max_words?: number | null;
  forbidden_phrases?: string[];
  required_phrases?: string[];
  talking_points?: Array<{ role: string; company_type: string; points: string }>;
  value_props?: string[];
  notes?: string | null;
};

function sanitizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
}

function sanitizeTalkingPoints(
  v: unknown
): Array<{ role: string; company_type: string; points: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (t): t is { role: string; company_type: string; points: string } =>
        !!t &&
        typeof (t as any).role === "string" &&
        typeof (t as any).company_type === "string" &&
        typeof (t as any).points === "string" &&
        (t as any).points.trim().length > 0
    )
    .map((t) => ({
      role: t.role.trim() || "any",
      company_type: t.company_type.trim() || "any",
      points: t.points.trim()
    }));
}

function sanitizeIntOrNull(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeEnum(v: unknown, allowed: string[]): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return allowed.includes(v) ? v : null;
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PatchBody;

  const sanitized = {
    language: sanitizeEnum(body.language, ["en", "es", "mix"]),
    register: sanitizeEnum(body.register, ["formal", "casual", "peer_industry"]),
    icebreaker_max_chars: sanitizeIntOrNull(body.icebreaker_max_chars, 50, 500),
    subject_max_words: sanitizeIntOrNull(body.subject_max_words, 2, 20),
    body_max_words: sanitizeIntOrNull(body.body_max_words, 20, 400),
    forbidden_phrases: sanitizeStringArray(body.forbidden_phrases),
    required_phrases: sanitizeStringArray(body.required_phrases),
    talking_points: sanitizeTalkingPoints(body.talking_points),
    value_props: sanitizeStringArray(body.value_props),
    notes:
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null
  };

  const db = supabaseAdmin();
  const existing = await loadActiveModelTrainingConfig(db);

  if (existing) {
    const { error } = await db
      .from("model_training_config")
      .update({ ...sanitized, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await db.from("model_training_config").insert({
      ...sanitized,
      is_active: true
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const fresh = await loadActiveModelTrainingConfig(db);
  return NextResponse.json({ ok: true, config: fresh });
}
