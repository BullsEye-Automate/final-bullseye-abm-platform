"use client";

import { createBrowserClient } from "@supabase/ssr";

// Cliente de Supabase para componentes de cliente (browser).
// Usa la anon key — respeta RLS, a diferencia de supabaseAdmin() (service role).
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
