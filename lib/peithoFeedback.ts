import type { SupabaseClient } from "@supabase/supabase-js";
import { isPeithoEnabled } from "@/lib/peitho";
import { loadPeithoClient, peithoConfigured, peithoGetJson } from "@/lib/peithoIntegration";
import type { MeetingListItem } from "@/components/peitho/app/types";

// Feedback de reuniones vs Peitho (pedido de BullsEye nov-2026): al cliente no
// se le pide feedback manual (link /feedback-cliente/<token>, /encuesta/<token>
// y el formulario embebido del portal) si tiene Peitho activado (el feedback
// llega solo con el análisis de cada reunión) o si esa reunión ya tiene
// análisis en Peitho. Una reunión de la planilla calza con una de Peitho por
// fecha + empresa (nombre compacto, contenido) o fecha + contacto.

type SheetMeeting = { id: string; empresa?: string | null; contacto_nombre?: string | null; fecha_reunion?: string | null };

const compact = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(s\.?a\.?s?|spa|ltda|limitada|s\.?a\.? de c\.?v\.?|inc|llc|sa)\b/g, "").replace(/[^a-z0-9]/g, "");
const near = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a === b || a.includes(b) || b.includes(a));

// Peitho no debe frenar la página pública: si tarda, se sigue sin él
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function peithoFeedbackCoverage(
  db: SupabaseClient, clientId: string, meetings: SheetMeeting[]
): Promise<{ enabled: boolean; covered: Set<string> }> {
  const covered = new Set<string>();
  const enabled = await isPeithoEnabled(db, clientId);
  // Con Peitho activado no se pide ninguna: no hace falta ir a Peitho
  if (enabled || !peithoConfigured() || !meetings.length) return { enabled, covered };
  const client = await loadPeithoClient(db, clientId);
  if (!client) return { enabled, covered };
  const list = await withTimeout(peithoGetJson<MeetingListItem[]>(client, "/meetings?scope=past"), 8000);
  if (!list) return { enabled, covered };
  // Solo reuniones con análisis (no las que quedaron sin grabar o no-show)
  const byDay = new Map<string, MeetingListItem[]>();
  for (const p of list) {
    if (p.status !== "analyzed" || !p.start_time) continue;
    // Día en hora de Chile (la planilla guarda la fecha local)
    const day = new Date(p.start_time).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    byDay.set(day, [...(byDay.get(day) ?? []), p]);
  }
  for (const m of meetings) {
    const cands = m.fecha_reunion ? byDay.get(m.fecha_reunion.slice(0, 10)) : undefined;
    if (!cands) continue;
    const emp = compact(m.empresa), ct = compact(m.contacto_nombre);
    const hit = cands.some((p) =>
      near(emp, compact(p.empresa_nombre)) || near(emp, compact((p.empresa_contraparte ?? "").split(".")[0])) ||
      (ct.length >= 6 && (near(ct, compact(p.contacto_nombre)) || near(ct, compact(p.contraparte))))
    );
    if (hit) covered.add(m.id);
  }
  return { enabled, covered };
}
