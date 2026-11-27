import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { closedBills, liveBill } from "@/lib/acti/billingServer";
import { chileToday } from "@/lib/acti/home";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Facturación del socio: mes en curso (en vivo) + historial de meses cerrados
export async function GET() {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const db = supabaseAdmin();
  const month = chileToday().slice(0, 7);
  const [current, history] = await Promise.all([liveBill(db, s.member, s.config, month), closedBills(db, s.user.clientId)]);
  return NextResponse.json({ current, history: history.filter((h) => h.month !== month), planName: s.plan.name });
}
