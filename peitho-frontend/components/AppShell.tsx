"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /research-compartido (10-09-2026) — link público que se manda al cliente
  // externo, sin login: tampoco debe llevar el Sidebar interno de Peitho.
  const isPublic = pathname?.startsWith("/login") || pathname?.startsWith("/research-compartido");

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 min-h-screen overflow-y-auto bg-gray-50">
        <div className="p-8">{children}</div>
      </main>
    </>
  );
}
