"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

// Renderiza el sidebar solo para rutas de la app autenticada.
// Las rutas /forms/* se renderizan sin sidebar (formularios públicos para clientes).
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = pathname?.startsWith("/forms/") || pathname?.startsWith("/review/") || pathname?.startsWith("/chat") || pathname?.startsWith("/encuesta/") || pathname?.startsWith("/feedback-cliente/");

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
