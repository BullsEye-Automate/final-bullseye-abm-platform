import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireWishlistActor } from "@/lib/portalAuth";
import { pushWishlistItemToLemlist } from "@/lib/wishlistLemlist";
import { canActForClient, proxyLabel } from "@/lib/clientProxy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET → { allowed }: si el usuario del equipo puede responder por el cliente.
// POST { ids: [], action: "approve" | "reject", medio, nota? } → registra la
// respuesta que el cliente dio fuera del portal sobre propuestas pendientes.
// Mismo efecto que si aprobara en su portal: pasa a "new", se envía a su
// Lemlist y el cron busca contactos; o queda rechazada con el motivo.

const MAX = 100;
const CONCURRENCY = 4;

export async function GET(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  return NextResponse.json({ allowed: user.isOperator && canActForClient(user.email) });
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireWishlistActor(req);
  if (!user) return response;
  if (!user.isOperator || !canActForClient(user.email)) {
    return NextResponse.json({ error: "Solo la líder de prospección y las prospectoras pueden registrar la respuesta del cliente" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, MAX) : [];
  const action = body?.action;
  const medio = typeof body?.medio === "string" ? body.medio : "otro";
  const nota = typeof body?.nota === "string" ? body.nota.trim().slice(0, 300) || null : null;
  if (!ids.length) return NextResponse.json({ error: "Elige al menos una empresa" }, { status: 400 });
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "Acción inválida" }, { status: 400 });

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const by = proxyLabel(user.email, medio, nota);
  const { data, error } = await db
    .from("client_wishlist")
    .update(
      action === "approve"
        ? { status: "new", lemlist_status: "pendiente", client_decision_at: now, client_decision_by_email: by, client_reject_reason: null, updated_at: now }
        : { status: "rejected_by_client", client_reject_reason: nota ?? "Rechazada por el cliente (registrada por el equipo)", client_decision_at: now, client_decision_by_email: by, updated_at: now }
    )
    .in("id", ids)
    .eq("client_id", user.clientId)
    .eq("status", "proposed")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const done = (data ?? []).map((d: { id: string }) => d.id);

  let lemlistOk = 0;
  if (action === "approve") {
    for (let i = 0; i < done.length; i += CONCURRENCY) {
      const rs = await Promise.all(done.slice(i, i + CONCURRENCY).map((id) => pushWishlistItemToLemlist(db, id).catch(() => ({ ok: false }))));
      lemlistOk += rs.filter((r) => r?.ok).length;
    }
  }
  return NextResponse.json({ ok: true, updated: done.length, skipped: ids.length - done.length, lemlistOk });
}
