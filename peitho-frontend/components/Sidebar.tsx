"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const NAV_ITEMS = [
  { href: "/reuniones/futuras", label: "Reuniones futuras" },
  { href: "/reuniones/pasadas", label: "Reuniones pasadas" },
  { href: "/base-de-conocimiento", label: "Base de conocimiento" },
];

// Solo visible para admin — se agrega aparte de NAV_ITEMS (no todos ven este
// ítem, a diferencia de los de arriba que ven ambos roles).
const ADMIN_NAV_ITEM = { href: "/admin/usuarios", label: "Administración" };

export default function Sidebar() {
  const pathname = usePathname();
  const [role, setRole] = useState<"admin" | "client" | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setRole(data.role);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside
      className="w-[230px] shrink-0 h-screen overflow-y-auto text-white px-3 py-5 sticky top-0 flex flex-col"
      style={{ background: "#251762" }}
    >
      <div className="px-3 mb-6">
        <div className="text-[22px] font-bold tracking-tight leading-none">
          <span style={{ color: "#fff" }}>Peit</span>
          <span style={{ color: "#62E0D8" }}>ho</span>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-1">
        {[...NAV_ITEMS, ...(role === "admin" ? [ADMIN_NAV_ITEM] : [])].map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-lg text-sm transition"
              style={
                active
                  ? { background: "rgba(98,224,216,0.15)", color: "#62E0D8" }
                  : { color: "rgba(255,255,255,0.75)" }
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pt-2 mt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <button
          onClick={handleLogout}
          className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition hover:bg-white/10"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
