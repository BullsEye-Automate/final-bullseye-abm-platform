import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import { ClientProvider } from "@/lib/clientContext";

export const metadata: Metadata = {
  title: "BullsEye — Prospecting",
  description: "B2B prospecting cockpit for BullsEye"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen flex">
        <ClientProvider>
          <Sidebar />
          <main className="flex-1 min-h-screen overflow-y-auto">
            <div className="max-w-[1280px] mx-auto p-8">{children}</div>
          </main>
        </ClientProvider>
      </body>
    </html>
  );
}
