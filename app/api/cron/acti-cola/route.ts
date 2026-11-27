import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { releaseQueue } from "@/lib/acti/requests";
import { loadActiConfig } from "@/lib/acti/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel Cron: libera la cola ACTI a la prospección (client_wishlist) por
// prioridad de plan (Acelera → Crece → Conecta → Freemium) y antigüedad.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const cfg = await loadActiConfig();
    return NextResponse.json(await releaseQueue(supabaseAdmin(), cfg.params.queueReleasePerRun));
  } catch (e) {
    console.error("[acti-cola]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
