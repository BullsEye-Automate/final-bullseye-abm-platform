import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { loadActiMeetings } from "@/lib/acti/meetings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Reuniones del socio (próximas y realizadas) con su análisis de Peitho y feedback
export async function GET() {
  const { s, response } = await requireActiUser();
  if (response) return response;
  return NextResponse.json(await loadActiMeetings(supabaseAdmin(), s.user.clientId, s.plan));
}
