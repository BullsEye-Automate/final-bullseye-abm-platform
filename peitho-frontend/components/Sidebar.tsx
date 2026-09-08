"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

// Íconos de línea simple (mismo estilo que el mockup de Claude Design,
// "Refresh de diseño" — ver artifact) — sin dependencia externa, solo SVG.
const ICONS = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="7" width="4" height="14" rx="1" />
      <rect x="17" y="3" width="4" height="18" rx="1" />
    </svg>
  ),
  futuras: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  ),
  pasadas: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  ),
  kb: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  admin: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6l7-3z" />
    </svg>
  ),
  logout: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  chevron: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
};

const NAV_ITEMS = [
  { href: "/panel-de-control", label: "Panel de control", icon: ICONS.dashboard },
  { href: "/reuniones/futuras", label: "Reuniones futuras", icon: ICONS.futuras },
  { href: "/reuniones/pasadas", label: "Reuniones pasadas", icon: ICONS.pasadas },
];

// "Herramientas" — agrupadas aparte y con indentación, como en el mockup
// (distinto de la navegación principal de arriba).
const TOOLS_ITEMS = [{ href: "/base-de-conocimiento", label: "Base de conocimiento", icon: ICONS.kb }];

// Solo visible para admin — se agrega a TOOLS_ITEMS (no todos ven este
// ítem, a diferencia del resto que ven todos los roles).
const ADMIN_NAV_ITEM = { href: "/admin/usuarios", label: "Administración", icon: ICONS.admin };

export default function Sidebar() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ email: string; role: "admin" | "client" } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setMe(data);
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

  const tools = [...TOOLS_ITEMS, ...(me?.role === "admin" ? [ADMIN_NAV_ITEM] : [])];

  function NavLink({ href, label, icon, indent = false }: { href: string; label: string; icon: React.ReactNode; indent?: boolean }) {
    const active = pathname?.startsWith(href);
    return (
      <Link
        href={href}
        className={`flex items-center gap-[11px] py-2 rounded-[9px] text-[13.5px] transition ${
          indent ? "pl-5 pr-2.5" : "px-2.5"
        }`}
        style={active ? { background: "#EFECFA", color: "#251762", fontWeight: 600 } : { color: "#635C79" }}
      >
        {icon}
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <aside className="w-[256px] shrink-0 h-screen overflow-y-auto bg-white border-r border-[#E3E0EC] px-3.5 pt-[22px] pb-4 sticky top-0 flex flex-col gap-0.5">
      <div className="px-2 mb-[22px] flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-peitho-icon-crop.png" alt="" className="h-[24px] w-auto object-contain" aria-hidden="true" />
        <div className="text-[18px] font-bold tracking-tight leading-none">
          <span style={{ color: "#1C1530" }}>Peit</span>
          <span style={{ color: "#251762" }}>ho</span>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>

      <div className="h-px bg-[#E3E0EC] my-3 mx-1" />

      <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#948DA8] px-2.5 pb-1.5">
        <span>Herramientas</span>
        {ICONS.chevron}
      </div>
      <nav className="flex flex-col gap-0.5">
        {tools.map((item) => (
          <NavLink key={item.href} {...item} indent />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="border-t border-[#E3E0EC] mt-2 pt-3.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          <div
            className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 text-[12px] font-bold"
            style={{ background: "#EFECFA", color: "#251762" }}
          >
            {me?.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-[#1C1530] truncate">{me?.email ?? "…"}</div>
            <div className="text-[10.5px] text-[#948DA8] truncate">
              {me?.role === "admin" ? "Admin" : "Cliente"}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-[11px] px-2.5 py-2 rounded-[9px] text-[13.5px] transition hover:bg-[#FAFAFD]"
          style={{ color: "#948DA8" }}
        >
          {ICONS.logout}
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
