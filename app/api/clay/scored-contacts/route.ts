import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { loadActiveModelTrainingConfig } from "@/lib/modelTrainingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Webhook entrante de Clay con el resultado del Lead Scoring AI.
// Acepta single o array. Acepta JSON inválido (valores sin comillas) con fallback regex.

type IncomingScore = {
  bullseye_contact_id?: string;
  fit_score?: number | string | null;
  fit?: string | boolean | null;
  fit_reason?: string | null;
  fit_action?: string | null;
  [key: string]: any;
};

const ACTION_VALUES = new Set(["enrich", "manual_review", "discard"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkAuth(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return { ok: true };
  const hdr = req.headers.get("x-webhook-secret") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (hdr !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

function normalizeKey(k: string): string {
  return k.replace(/[\s_]/g, "").toLowerCase();
}

function pickField(obj: Record<string, any>, internalName: string): any {
  const target = normalizeKey(internalName);
  for (const [k, v] of Object.entries(obj)) {
    if (normalizeKey(k) === target) return v;
  }
  return undefined;
}

function parseAction(raw: any): "enrich" | "manual_review" | "discard" | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "enriquecer") return "enrich";
  if (s === "revision_manual" || s === "manualreview" || s === "manual") return "manual_review";
  if (s === "descartar") return "discard";
  if (ACTION_VALUES.has(s)) return s as any;
  return null;
}

function parseFitScore(raw: any): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, Math.min(10, Math.round(n)));
  return null;
}

function parseFit(raw: any): string | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw ? "true" : "false";
  const s = String(raw).trim().toLowerCase();
  return s || null;
}

function statusFor(action: string | null, current: string): string {
  if (action === "discard") return "discarded";
  return current;
}

function isStrongDecisionMakerRole(jobTitle: string | null, strongKeywords: string[], excludeKeywords: string[]): boolean {
  if (!jobTitle || strongKeywords.length === 0) return false;
  const t = jobTitle.toLowerCase().trim();
  if (!t) return false;
  if (excludeKeywords.some((kw) => t.includes(kw.toLowerCase().trim()))) return false;
  return strongKeywords.some((kw) => t.includes(kw.toLowerCase().trim()));
}

// Extracción por regex para JSON inválido de Clay (valores sin comillas)
function extractField(text: string, field: string): string {
  const quotedRe = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i");
  const quotedM = text.match(quotedRe);
  if (quotedM) return quotedM[1].trim();
  const unquotedRe = new RegExp(`"${field}"\\s*:\\s*([^\\s",}\\]\\[][^",}\\]\\[]*)`, "i");
  const unquotedM = text.match(unquotedRe);
  if (unquotedM) return unquotedM[1].trim();
  return "";
}

async function parseBody(req: NextRequest): Promise<{ ok: true; items: IncomingScore[] } | { ok: false; error: string }> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return { ok: false, error: "Body vacío" };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { ok: true, items: parsed };
    if (parsed && typeof parsed === "object") return { ok: true, items: [parsed] };
  } catch { /* fallback to regex */ }
  // Regex fallback para body single con valores sin comillas
  const id = extractField(text, "bullseye_contact_id");
  if (id && UUID_RE.test(id)) {
    const item: Record<string, string> = { bullseye_contact_id: id };
    for (const f of ["fit_score", "fit", "fit_reason", "fit_action"]) {
      const v = extractField(text, f);
      if (v) item[f] = v;
    }
    return { ok: true, items: [item] };
  }
  return { ok: false, error: "JSON inválido — no se pudieron extraer campos del body" };
}

function normalizeItem(it: IncomingScore): { bullseye_contact_id: string; patch: Record<string, any> } | null {
  const rawId = (pickField(it, "bullseye_contact_id") ?? "").toString().trim();
  if (!rawId || !UUID_RE.test(rawId)) return null;

  const action = parseAction(pickField(it, "fit_action"));
  const score = parseFitScore(pickField(it, "fit_score"));
  const fit = parseFit(pickField(it, "fit"));
  const reason = pickField(it, "fit_reason");

  const patch: Record<string, any> = {};
  if (score !== null) patch.fit_score = score;
  if (fit !== null) patch.fit = fit;
  if (reason != null && reason !== "") patch.fit_reason = String(reason);
  if (action !== null) patch.fit_action = action;

  return { bullseye_contact_id: rawId, patch };
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const parsed = await parseBody(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { items } = parsed;
  if (items.length === 0) return NextResponse.json({ error: "No items in payload" }, { status: 400 });

  const db = supabaseAdmin();
  const config = await loadActiveModelTrainingConfig(db);
  const strongKeywords = config?.strong_decision_maker_keywords ?? [];
  const excludeKeywords = config?.exclude_role_keywords ?? [];

  const totals = { received: items.length, updated: 0, skipped: 0 };
  const errors: { bullseye_contact_id: string; error: string }[] = [];

  for (const it of items) {
    const norm = normalizeItem(it);
    if (!norm) {
      totals.skipped += 1;
      errors.push({ bullseye_contact_id: "", error: "Missing or invalid bullseye_contact_id" });
      continue;
    }
    if (Object.keys(norm.patch).length === 0) { totals.skipped += 1; continue; }

    const { data: existing, error: fetchErr } = await db
      .from("contacts")
      .select("id, status, job_title")
      .eq("id", norm.bullseye_contact_id)
      .maybeSingle();
    if (fetchErr) { errors.push({ bullseye_contact_id: norm.bullseye_contact_id, error: fetchErr.message }); continue; }
    if (!existing) { errors.push({ bullseye_contact_id: norm.bullseye_contact_id, error: "Contact not found" }); totals.skipped += 1; continue; }

    if (norm.patch.fit_action === "manual_review" && isStrongDecisionMakerRole(existing.job_title, strongKeywords, excludeKeywords)) {
      norm.patch.fit_action = "enrich";
      const promoteNote = "Auto-promovido a enrich por cargo decisor.";
      norm.patch.fit_reason = norm.patch.fit_reason ? `${norm.patch.fit_reason} · ${promoteNote}` : promoteNote;
    }

    const finalStatus = statusFor(norm.patch.fit_action ?? null, existing.status);
    if (finalStatus !== existing.status) norm.patch.status = finalStatus;

    const { error: updateErr } = await db.from("contacts").update(norm.patch).eq("id", norm.bullseye_contact_id);
    if (updateErr) { errors.push({ bullseye_contact_id: norm.bullseye_contact_id, error: updateErr.message }); continue; }
    totals.updated += 1;
  }

  return NextResponse.json({ ...totals, errors });
}
