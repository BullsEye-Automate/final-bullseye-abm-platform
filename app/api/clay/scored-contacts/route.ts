import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Webhook entrante de Clay con el score de un contacto.
//
// Clay a veces envía JSON inválido con valores de string sin comillas:
//   {"fit": medium, "fit_action": enrich, ...}
// El endpoint lee el body como texto y usa regex como fallback al JSON.parse().
//
// Body esperado desde Clay:
//   {
//     "bullseye_contact_id": "<chip>",
//     "fit_score":           <número 1-10>,
//     "fit":                 "high" | "medium" | "low"  (puede llegar sin comillas),
//     "fit_reason":          "<texto>",
//     "fit_action":          "enrich" | "manual_review" | "discard" (puede llegar sin comillas)
//   }

const SCORED_FIELDS = [
  "bullseye_contact_id",
  "fit_score",
  "fit",
  "fit_reason",
  "fit_action",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_FIT        = new Set(["high", "medium", "low"]);
const VALID_FIT_ACTION = new Set(["enrich", "manual_review", "discard"]);

// ── Parseo tolerante ──────────────────────────────────────────────────────────

// Extrae un campo del texto soportando valores con comillas y sin ellas.
// Para fit_reason (texto largo con espacios y comas) solo usa el path "con comillas".
function extractField(text: string, field: string): string {
  // Intento 1: valor entre comillas  "field": "value"
  const quotedRe = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i");
  const quotedM  = text.match(quotedRe);
  if (quotedM) return quotedM[1].trim();

  // Intento 2: valor sin comillas  "field": value  (hasta coma, llave o fin)
  const unquotedRe = new RegExp(`"${field}"\\s*:\\s*([^\\s",}\\]\\[][^",}\\]\\[]*)`, "i");
  const unquotedM  = text.match(unquotedRe);
  if (unquotedM) return unquotedM[1].trim();

  return "";
}

function extractAllFields(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of SCORED_FIELDS) {
    const val = extractField(text, field);
    if (val !== "") result[field] = val;
  }
  return result;
}

async function parseBody(
  req: NextRequest
): Promise<{ ok: true; body: Record<string, any> } | { ok: false; error: string }> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return { ok: false, error: "Body vacío" };

  // Intento 1: JSON válido
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, body: parsed };
    }
  } catch { /* continuar con regex */ }

  // Intento 2: extracción por regex (Clay con valores sin comillas)
  const extracted = extractAllFields(text);
  if (Object.keys(extracted).length > 0) {
    return { ok: true, body: extracted };
  }

  return { ok: false, error: "JSON inválido — no se pudieron extraer campos del body" };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return { ok: true };
  const hdr =
    req.headers.get("x-webhook-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (hdr !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

// ── Extracción y validación de campos ─────────────────────────────────────────

interface ScoredPayload {
  bullseye_contact_id: string;
  fit_score: number | null;
  fit: string | null;
  fit_reason: string | null;
  fit_action: string | null;
}

function extractPayload(body: Record<string, any>): {
  ok: true;
  payload: ScoredPayload;
  warnings: string[];
} | { ok: false; error: string } {
  const warnings: string[] = [];

  // bullseye_contact_id — obligatorio
  const rawId = (body["bullseye_contact_id"] ?? "").toString().trim();
  if (!rawId || !UUID_RE.test(rawId)) {
    return { ok: false, error: `bullseye_contact_id inválido o ausente: "${rawId}"` };
  }

  // fit_score — numérico 1-10
  let fit_score: number | null = null;
  const rawScore = (body["fit_score"] ?? "").toString().trim();
  if (rawScore !== "") {
    const n = parseInt(rawScore, 10);
    if (!isNaN(n) && n >= 1 && n <= 10) {
      fit_score = n;
    } else {
      warnings.push(`fit_score ignorado: valor inválido "${rawScore}"`);
    }
  }

  // fit — "high" | "medium" | "low" (puede llegar sin comillas desde Clay)
  let fit: string | null = null;
  const rawFit = (body["fit"] ?? "").toString().trim().toLowerCase();
  if (rawFit !== "") {
    if (VALID_FIT.has(rawFit)) {
      fit = rawFit;
    } else {
      warnings.push(`fit ignorado: valor inesperado "${rawFit}"`);
    }
  }

  // fit_reason — texto libre
  const fit_reason = (body["fit_reason"] ?? "").toString().trim() || null;

  // fit_action — "enrich" | "manual_review" | "discard"
  let fit_action: string | null = null;
  const rawAction = (body["fit_action"] ?? "").toString().trim().toLowerCase();
  if (rawAction !== "") {
    if (VALID_FIT_ACTION.has(rawAction)) {
      fit_action = rawAction;
    } else {
      warnings.push(`fit_action ignorado: valor inesperado "${rawAction}"`);
    }
  }

  return {
    ok: true,
    payload: { bullseye_contact_id: rawId, fit_score, fit, fit_reason, fit_action },
    warnings,
  };
}

// ── Actualización en Supabase ─────────────────────────────────────────────────

// fit_action determina el nuevo status del contacto en el funnel:
//   enrich        → enriched  (listo para enriquecer y añadir a campaña)
//   manual_review → sin cambio de status (aparece en bucket manual_review por fit_action)
//   discard       → discarded
function resolveStatus(fit_action: string | null): string | null {
  if (fit_action === "enrich")  return "enriched";
  if (fit_action === "discard") return "discarded";
  return null; // manual_review u omitido: no tocar status
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const parsed = await parseBody(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const extracted = extractPayload(parsed.body);
  if (!extracted.ok) return NextResponse.json({ error: extracted.error }, { status: 400 });

  const { payload, warnings } = extracted;
  const db = supabaseAdmin();

  // Verificar que el contacto existe
  const { data: existing, error: fetchErr } = await db
    .from("contacts")
    .select("id, status")
    .eq("id", payload.bullseye_contact_id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: `Contacto no encontrado: ${payload.bullseye_contact_id}` },
      { status: 404 }
    );
  }

  // Construir el update — solo incluir campos que llegaron
  const update: Record<string, any> = {};
  if (payload.fit_score   !== null) update["fit_score"]   = payload.fit_score;
  if (payload.fit         !== null) update["fit"]         = payload.fit;
  if (payload.fit_reason  !== null) update["fit_reason"]  = payload.fit_reason;
  if (payload.fit_action  !== null) update["fit_action"]  = payload.fit_action;

  const newStatus = resolveStatus(payload.fit_action);
  if (newStatus) update["status"] = newStatus;

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No hay campos válidos para actualizar", warnings },
      { status: 400 }
    );
  }

  const { error: updateErr } = await db
    .from("contacts")
    .update(update)
    .eq("id", payload.bullseye_contact_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    bullseye_contact_id: payload.bullseye_contact_id,
    updated: update,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}
