"use client";

import { usePathname } from "next/navigation";
import { ClientProvider } from "@/lib/clientContext";
import { GenerationProvider } from "@/lib/generationContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // El portal de clientes no usa el estado interno: ClientProvider descarga
  // la lista de TODOS los clientes, que un usuario cliente no debe ver.
  if (pathname === "/portal" || pathname?.startsWith("/portal/")) {
    return <>{children}</>;
  }

  return (
    <ClientProvider>
      <GenerationProvider>
        {children}
      </GenerationProvider>
    </ClientProvider>
  );
}
