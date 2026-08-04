import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: Detecta reuniones potencialmente duplicadas (mismo sheet_row_key o similar)
// ANTES de intentar deduplicarlas. Previene scripts manuales mal escritos.
export async function GET(req: NextRequest) {
  const supabase = supabaseAdmin();
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client_id");
  const dryRun = searchParams.get("dry_run") === "true";

  let query = supabase
    .from("meetings")
    .select("id, empresa, contacto_nombre, feedback_status, sheet_row_key, client_id, created_at")
    .order("sheet_row_key", { ascending: true });

  if (clientId && clientId !== "__all__") {
    query = query.eq("client_id", clientId);
  }

  const { data: meetings, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupar por sheet_row_key para detectar duplicados
  const grouped = new Map<string, typeof meetings>();
  (meetings ?? []).forEach(m => {
    const key = m.sheet_row_key || "";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  });

  // Filtrar solo grupos con duplicados
  const duplicates = Array.from(grouped.entries())
    .filter(([_, group]) => group.length > 1)
    .map(([key, group]) => ({
      sheet_row_key: key,
      count: group.length,
      meetings: group.map(m => ({
        id: m.id,
        empresa: m.empresa,
        contacto: m.contacto_nombre,
        feedback_status: m.feedback_status,
        con_feedback: m.feedback_status === "con_feedback",
        created_at: m.created_at,
      })),
      warning: group.some(m => m.feedback_status === "con_feedback")
        ? "⚠️ TIENE FEEDBACK - NO ELIMINAR ESTE GRUPO"
        : "✓ Sin feedback - seguro de deduplicar",
    }));

  if (!dryRun) {
    return NextResponse.json({
      total_meetings: meetings?.length ?? 0,
      duplicate_groups: duplicates.length,
      duplicates,
      next: "Revisa el JSON arriba. Si todo OK, llama con ?commit=1 DESPUÉS de verificar manualmente",
    });
  }

  // Aquí iría la lógica de commit si lo solicitaras
  // Por ahora: solo auditoria, nunca delete automático
  return NextResponse.json({
    error: "El commit automático está deshabilitado. Auditoria solamente.",
    duplicates,
  });
}
