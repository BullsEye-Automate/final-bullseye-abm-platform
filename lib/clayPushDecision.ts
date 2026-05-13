import type { SupabaseClient } from "@supabase/supabase-js";
import { findRowByColumnValue, updateRowCell } from "./clayApi";

export type PushDecisionResult =
  | { ok: true; row_id: string; matched_url?: string }
  | {
      ok: false;
      status: number;
      error: string;
      debug?: unknown;
      skipped?: "not_in_clay" | "not_found" | "row_not_found";
    };

// Llama a Clay REST API para encontrar la fila por Wecad Contact Id y
// actualizar la celda App Decision. Devuelve detalles cuando falla para
// poder iterar sobre el formato real del API.
export async function pushDecisionToClay(
  db: SupabaseClient,
  contactId: string,
  decision: "approved" | "rejected"
): Promise<PushDecisionResult> {
  if (!process.env.CLAY_CONTACTS_TABLE_ID) {
    return {
      ok: false,
      status: 500,
      error: "CLAY_CONTACTS_TABLE_ID is not configured"
    };
  }
  if (!process.env.CLAY_API_TOKEN) {
    return {
      ok: false,
      status: 500,
      error: "CLAY_API_TOKEN is not configured"
    };
  }

  const { data: contact, error: cErr } = await db
    .from("contacts")
    .select("id, clay_pushed_at")
    .eq("id", contactId)
    .maybeSingle();
  if (cErr) {
    return { ok: false, status: 500, error: cErr.message };
  }
  if (!contact) {
    return { ok: false, status: 404, error: "Contact not found", skipped: "not_found" };
  }
  if (!contact.clay_pushed_at) {
    return {
      ok: false,
      status: 400,
      error: "Contact has never been pushed to Clay — cannot notify decision",
      skipped: "not_in_clay"
    };
  }

  const find = await findRowByColumnValue("Wecad Contact Id", contactId);
  if (!find.row_id) {
    return {
      ok: false,
      status: 404,
      error: "Could not find Clay row for wecad_contact_id",
      debug: find.debug,
      skipped: "row_not_found"
    };
  }

  const update = await updateRowCell(find.row_id, "App Decision", decision);
  if (!update.ok) {
    return {
      ok: false,
      status: update.status,
      error: update.error ?? "Failed to update cell",
      debug: { find_debug: find.debug, update_debug: update.debug }
    };
  }

  return { ok: true, row_id: find.row_id };
}
