"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { ClientProvider } from "@/lib/clientContext";
import { GenerationProvider } from "@/lib/generationContext";

// Renderiza el sidebar y el ClientProvider solo para rutas de la app autenticada.
// Las rutas /forms/* se renderizan sin sidebar (formularios públicos para clientes).
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = pathname?.startsWith("/forms/");

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <ClientProvider>
      <GenerationProvider>
        <Sidebar />
        <main className="flex-1 min-h-screen overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </GenerationProvider>
    </ClientProvider>
  );
}
