import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  resolveSendUserId,
  resolveInboxIds,
  sendLinkedinMessage,
  sendEmailReply
} from "@/lib/lemlistInbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/respuestas/[id]/reply   body { message: string, subject?: string }
//
// Envía una respuesta a un lead directamente desde la app vía la API de
// Inbox de Lemlist (POST /api/inbox/linkedin o /api/inbox/email). Lemlist
// manda el mensaje por la cuenta de LinkedIn / mailbox conectada del
// usuario — el SDR no entra a Lemlist ni a LinkedIn.
//
// Al enviar OK marca la respuesta como atendida (reply_handled_at) y guarda
// lo que se mandó (reply_sent_text / reply_sent_at) para trazabilidad.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const message =
    typeof (body as { message?: unknown }).message === "string"
      ? ((body as { message: string }).message).trim()
      : "";
  const subject =
    typeof (body as { subject?: unknown }).subject === "string"
      ? ((body as { subject: string }).subject).trim()
      : "";
  if (!message) {
    return NextResponse.json({ error: "El mensaje está vacío" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: act, error } = await db
    .from("lemlist_activities")
    .select("id, channel, type, raw, lead_id, lead_email")
    .eq("id", params.id)
    .single();
  if (error || !act) {
    return NextResponse.json(
      { error: error?.message ?? "respuesta no encontrada" },
      { status: 404 }
    );
  }

  const channel = (act.channel ?? "").toLowerCase();
  if (channel !== "linkedin" && channel !== "email") {
    return NextResponse.json(
      {
        error: `Canal "${act.channel ?? "?"}" no soportado para responder desde la app (solo LinkedIn y email).`
      },
      { status: 400 }
    );
  }

  // sendUserId — el usuario de Lemlist que envía.
  const sender = await resolveSendUserId();
  if (!sender.ok) {
    return NextResponse.json(
      { error: sender.error, debug: sender.debug },
      { status: 502 }
    );
  }

  // leadId + contactId de Lemlist.
  const ids = await resolveInboxIds({
    raw: act.raw,
    lead_id: act.lead_id,
    lead_email: act.lead_email
  });
  if (!ids.leadId) {
    return NextResponse.json(
      {
        error: "No se pudo resolver el leadId de Lemlist para esta respuesta.",
        debug: ids.debug
      },
      { status: 502 }
    );
  }
  if (channel === "linkedin" && !ids.contactId) {
    return NextResponse.json(
      {
        error:
          "No se pudo resolver el contactId de Lemlist (requerido para mensajes de LinkedIn).",
        debug: ids.debug
      },
      { status: 502 }
    );
  }

  const result =
    channel === "linkedin"
      ? await sendLinkedinMessage({
          sendUserId: sender.sendUserId,
          leadId: ids.leadId,
          contactId: ids.contactId as string,
          message
        })
      : await sendEmailReply({
          sendUserId: sender.sendUserId,
          leadId: ids.leadId,
          contactId: ids.contactId,
          message,
          subject: subject || undefined
        });

  if (!result.ok) {
    await db
      .from("lemlist_activities")
      .update({ reply_send_error: result.error })
      .eq("id", params.id);
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        debug: {
          ...result.debug,
          ids: ids.debug,
          sender_source: sender.source
        }
      },
      { status: 502 }
    );
  }

  const sentAt = new Date().toISOString();
  const { error: updErr } = await db
    .from("lemlist_activities")
    .update({
      reply_sent_text: message,
      reply_sent_at: sentAt,
      reply_send_error: null,
      reply_handled_at: sentAt
    })
    .eq("id", params.id);

  if (updErr) {
    // El mensaje SÍ salió por Lemlist; solo falló persistir el rastro.
    return NextResponse.json({
      ok: true,
      sent_at: sentAt,
      channel,
      persist_warning: updErr.message,
      lemlist: { matched_url: result.matched_url, status: result.status }
    });
  }

  return NextResponse.json({
    ok: true,
    sent_at: sentAt,
    channel,
    sendUserId: sender.sendUserId,
    lemlist: { matched_url: result.matched_url, status: result.status }
  });
}
