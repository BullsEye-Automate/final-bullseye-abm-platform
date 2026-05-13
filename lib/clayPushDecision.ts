import type { SupabaseClient } from "@supabase/supabase-js";

export type PushDecisionResult =
  | { ok: true; clay_pushed_at: string }
  | { ok: false; status: number; error: string; skipped?: "not_in_clay" | "not_found" };

// Notifica a Clay del veredicto humano sobre un contacto que ya está en la
// tabla Contacts de Clay (cargado vía push-contact). El payload incluye
// wecad_contact_id + app_decision para que Clay encuentre la fila y actualice
// la columna "App Decision". Las run conditions en Clay sobre las columnas AI
// e "Add Lead to Campaign" deben usar OR contra "App Decision = approved".
export async function pushDecisionToClay(
  db: SupabaseClient,
  contactId: string,
  decision: "approved" | "rejected"
): Promise<PushDecisionResult> {
  const webhookUrl = process.env.CLAY_APPROVAL_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      ok: false,
      status: 500,
      error: "CLAY_APPROVAL_WEBHOOK_URL is not configured"
    };
  }

  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select("id, clay_pushed_at, first_name, last_name")
    .eq("id", contactId)
    .maybeSingle();
  if (cErr) {
    return { ok: false, status: 500, error: cErr.message };
  }
  if (!contact) {
    return {
      ok: false,
      status: 404,
      error: "Contact not found",
      skipped: "not_found"
    };
  }
  if (!contact.clay_pushed_at) {
    return {
      ok: false,
      status: 400,
      error: "Contact has never been pushed to Clay — cannot notify decision",
      skipped: "not_in_clay"
    };
  }

  const payload = {
    wecad_contact_id: contactId,
    app_decision: decision,
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? ""
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: 502,
        error: `Clay responded ${res.status}: ${text.slice(0, 200) || "no body"}`
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 502, error: message };
  }

  return { ok: true, clay_pushed_at: new Date().toISOString() };
}
