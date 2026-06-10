import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/clay/test-webhook — dispara un payload de prueba al webhook de Clay Contacts Approved
// para diagnosticar si la tabla está aceptando filas. No tiene side effects en Supabase.
export async function GET(_req: NextRequest) {
  const webhookUrl = process.env.CLAY_CONTACTS_APPROVED_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "CLAY_CONTACTS_APPROVED_WEBHOOK_URL no configurado" }, { status: 500 });
  }

  const payload = {
    bullseye_contact_id: `test-debug-${Date.now()}`,
    linkedin_url:        "https://linkedin.com/in/test-debug-bullseye",
    first_name:          "Test",
    last_name:           "Debug",
    company_name:        "Bullseye Test Co",
    email:               "test@bullseye-debug.com",
  };

  let res: Response | null = null;
  let bodyText = "";
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    bodyText = await res.text().catch(() => "");
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Network error" }, { status: 502 });
  }

  return NextResponse.json({
    webhook_url:   webhookUrl,
    clay_status:   res.status,
    clay_response: bodyText.slice(0, 500),
    payload_sent:  payload,
    next_step:     "Esperá 30s y refrescá la tabla Contacts Approved en Clay. Si aparece 'Test Debug', el webhook funciona.",
  });
}
