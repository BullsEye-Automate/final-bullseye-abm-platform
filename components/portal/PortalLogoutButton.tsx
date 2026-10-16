"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

export default function PortalLogoutButton({ className }: { className?: string }) {
  async function handleLogout() {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button
      onClick={handleLogout}
      className={className ?? "px-4 py-2 rounded-xl text-sm font-medium text-white"}
      style={className ? undefined : { background: "#251762" }}
    >
      Cerrar sesión
    </button>
  );
}
