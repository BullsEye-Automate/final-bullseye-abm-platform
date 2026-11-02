"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconLayoutSidebarLeftExpand } from "@tabler/icons-react";
import Sidebar from "./Sidebar";

const SIDEBAR_KEY = "bullseye:sidebar-hidden";

// Oculta el sidebar en rutas sin navegación interna: los links mágicos
// públicos para clientes (protegidos por token, ver middleware.ts) y /chat
// y /login, que son de layout full-bleed, y el portal de clientes (/portal),
// que tiene su propio layout. Esto es solo cosmético — el
// middleware es quien decide qué requiere sesión, no esta lista.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Menú lateral oculto / visible con un clic (se recuerda en este navegador)
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try { setHidden(localStorage.getItem(SIDEBAR_KEY) === "1"); } catch {}
  }, []);

  function toggle(next: boolean) {
    setHidden(next);
    try { localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch {}
  }

  const isPublic = pathname?.startsWith("/forms/") || pathname?.startsWith("/review/") || pathname?.startsWith("/chat") || pathname?.startsWith("/encuesta/") || pathname?.startsWith("/feedback-cliente/") || pathname?.startsWith("/revision/") || pathname?.startsWith("/oportunidades/resumen-feedback/compartido/") || pathname?.startsWith("/login") || pathname === "/portal" || pathname?.startsWith("/portal/");

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <>
      {!hidden && <Sidebar onCollapse={() => toggle(true)} />}
      {hidden && (
        <button
          onClick={() => toggle(false)}
          title="Mostrar menú"
          aria-label="Mostrar menú"
          className="fixed top-4 left-4 z-40 p-2 rounded-lg shadow-md transition hover:opacity-90"
          style={{ background: "#251762", color: "#62E0D8" }}
        >
          <IconLayoutSidebarLeftExpand size={18} stroke={1.5} />
        </button>
      )}
      <main className="flex-1 min-h-screen overflow-y-auto">
        <div className={hidden ? "p-8 pl-16" : "p-8"}>{children}</div>
      </main>
    </>
  );
}
