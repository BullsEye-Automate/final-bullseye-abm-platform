"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

// Oculta el sidebar en rutas sin navegación interna: los links mágicos
// públicos para clientes (protegidos por token, ver middleware.ts) y /chat
// y /login, que son de layout full-bleed. Esto es solo cosmético — el
// middleware es quien decide qué requiere sesión, no esta lista.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = pathname?.startsWith("/forms/") || pathname?.startsWith("/review/") || pathname?.startsWith("/chat") || pathname?.startsWith("/encuesta/") || pathname?.startsWith("/feedback-cliente/") || pathname?.startsWith("/revision/") || pathname?.startsWith("/login");

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 min-h-screen overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </>
  );
}
