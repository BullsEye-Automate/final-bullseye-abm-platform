import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Leer userId desde cookies de sesión de Supabase (el fetch viene del navegador sin header Authorization)
  let userId: string | null = null;
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
    );
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {}

  if (!userId) return NextResponse.json({ connected: false });

  const db = supabaseAdmin();
  const { data } = await db
    .from("user_gmail_tokens")
    .select("email")
    .eq("user_id", userId)
    .single();

  return NextResponse.json({
    connected: !!data,
    email: data?.email ?? null,
    userId,
  });
}
