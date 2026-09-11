"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /research-compartido (10-09-2026) y /analisis-compartido (11-09-2026) —
  // links públicos que se mandan al cliente externo, sin login: tampoco
  // deben llevar el Sidebar interno de Peitho.
  const isPublic =
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/research-compartido") ||
    pathname?.startsWith("/analisis-compartido");

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
