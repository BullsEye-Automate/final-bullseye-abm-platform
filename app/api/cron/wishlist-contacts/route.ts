import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { searchWishlistContacts } from "@/lib/wishlistContacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Búsqueda automática de contactos IA: toma las empresas de la wishlist que
// ya quedaron en el Lemlist del cliente (lemlist_status = ok) y todavía no
// tienen contactos buscados, y corre la búsqueda (Lemlist + IA) de a una,
// hasta ~4 minutos por corrida. Los contactos quedan "suggested" para la
// revisión de prospección en Contactos → Contactos IA.
const TIME_BUDGET_MS = 230_000;
const MAX_PER_RUN = 10;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = supabaseAdmin();
  const started = Date.now();
  const { data: items, error } = await db
    .from("client_wishlist")
    .select("id, company_name")
    .eq("lemlist_status", "ok")
    .eq("contacts_status", "pending")
    .neq("status", "discarded")
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { company: string; status: string; found: number; error?: string }[] = [];
  for (const item of items ?? []) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const r = await searchWishlistContacts(db, item.id);
      results.push({ company: item.company_name, status: r.status, found: r.found, error: r.error });
    } catch (err) {
      // Error inesperado: se marca para no reintentarla en cada corrida
      const msg = err instanceof Error ? err.message : String(err);
      await db.from("client_wishlist").update({ contacts_status: "error", contacts_error: msg.slice(0, 500) }).eq("id", item.id);
      results.push({ company: item.company_name, status: "error", found: 0, error: msg });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
