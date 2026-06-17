"use client";

import { ClientProvider } from "@/lib/clientContext";
import { GenerationProvider } from "@/lib/generationContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClientProvider>
      <GenerationProvider>
        {children}
      </GenerationProvider>
    </ClientProvider>
  );
}
