import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GIF transparente 1x1
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function updateHubspotNote(
  token: string,
  contactId: string,
  subject: string,
  opens: { at: string }[],
  existingNoteId: string | null
): Promise<string | null> {
  const lines = opens.map((o) => `• Abierto el ${formatDate(o.at)}`).join("\n");
  const body = `✉️ Seguimiento — "${subject}"\n${lines}`;

  if (existingNoteId) {
    await fetch(`https://api.hubapi.com/crm/v3/objects/notes/${existingNoteId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { hs_note_body: body } }),
    });
    return existingNoteId;
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: {
        hs_note_body: body,
        hs_timestamp: new Date().toISOString(),
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
        },
      ],
    }),
  });
  const data = await res.json();
  return data.id ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    const db = supabaseAdmin();
    const cacheKey = `email_track:${id}`;

    const { data: row } = await db
      .from("allo_response_cache")
      .select("data")
      .eq("key", cacheKey)
      .single();

    if (row?.data) {
      const entry = row.data as {
        to: string;
        subject: string;
        hubspotContactId?: string;
        hubspotNoteId?: string | null;
        opens: { at: string }[];
      };

      entry.opens = [...(entry.opens ?? []), { at: new Date().toISOString() }];

      // Actualizar nota en HubSpot si tenemos el contacto
      const token = process.env.HUBSPOT_ACCESS_TOKEN;
      if (token && entry.hubspotContactId) {
        try {
          const noteId = await updateHubspotNote(
            token,
            entry.hubspotContactId,
            entry.subject,
            entry.opens,
            entry.hubspotNoteId ?? null
          );
          if (noteId) entry.hubspotNoteId = noteId;
        } catch (err) {
          console.error("HubSpot note update error:", err);
        }
      }

      await db.from("allo_response_cache").upsert({
        key: cacheKey,
        data: entry,
        expires_at: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  } catch (err) {
    console.error("Tracking pixel error:", err);
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
