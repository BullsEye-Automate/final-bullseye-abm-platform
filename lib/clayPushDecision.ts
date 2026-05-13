import type { SupabaseClient } from "@supabase/supabase-js";
import { findRowByColumnValue, updateRowCell } from "./clayApi";

export type PushDecisionResult =
  | { ok: true; row_id: string }
  | {
      ok: false;
      status: number;
      error: string;
      debug?: string;
      skipped?: "not_in_clay" | "not_found" | "row_not_found";
    };

// Notifica a Clay del veredicto humano sobre un contacto. Usa Clay REST API
// para buscar la fila por Wecad Contact Id y actualizar la celda App Decision.
//
// Requisitos en Vercel:
//   - CLAY_API_TOKEN (Bearer token de Clay, Settings → API key)
//   - CLAY_CONTACTS_TABLE_ID (UUID de la tabla Contacts, ej. t_xxx)
//
// En Clay tabla Contacts:
//   - Columna "App Decision" (Text, manual) ya creada.
//   - Run conditions de "Add Lead to Campaign" y AI columns deben incluir:
//       Lead Scoring action = "enrich" OR App Decision = "approved"
export async function pushDecisionToClay(
  db: SupabaseClient,
  contactId: string,
  decision: "approved" | "rejected"
): Promise<PushDecisionResult> {
  const tableId = process.env.CLAY_CONTACTS_TABLE_ID;
  if (!tableId) {
    return {
      ok: false,
      status: 500,
      error: "CLAY_CONTACTS_TABLE_ID is not configured"
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

  // Buscar la fila en Clay por Wecad Contact Id.
  const find = await findRowByColumnValue(tableId, "Wecad Contact Id", contactId);
  if (!find.row_id) {
    return {
      ok: false,
      status: 404,
      error: "Could not find Clay row for wecad_contact_id",
      debug: find.debug,
      skipped: "row_not_found"
    };
  }

  // Actualizar la celda App Decision.
  const update = await updateRowCell(tableId, find.row_id, "App Decision", decision);
  if (!update.ok) {
    return {
      ok: false,
      status: update.status,
      error: update.error,
      debug: find.debug
    };
  }

  return { ok: true, row_id: find.row_id };
}
