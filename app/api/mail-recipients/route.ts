import { NextRequest, NextResponse } from "next/server";
import { getAllRecipients, setRecipients, RECIPIENT_KEYS, type RecipientsKey } from "@/lib/mailRecipients";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Destinatarios de los correos automáticos (lib/mailRecipients.ts).
// Requiere sesión del equipo (no está en la lista pública de middleware.ts).
// GET → { phone_health: [...], reporte_sdr: [...], feriados: [...] }
// PUT { key, emails } → guarda la lista de ese reporte.
export async function GET() {
  try {
    return NextResponse.json(await getAllRecipients());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const key = body?.key as RecipientsKey;
    if (!RECIPIENT_KEYS.includes(key)) {
      return NextResponse.json({ error: "Reporte desconocido" }, { status: 400 });
    }
    let email: string | undefined;
    try {
      const { data } = await supabaseServer().auth.getUser();
      email = data.user?.email ?? undefined;
    } catch {
      /* sin usuario identificable: se guarda igual */
    }
    const emails = await setRecipients(key, body?.emails ?? [], email);
    return NextResponse.json({ key, emails });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 400 });
  }
}
