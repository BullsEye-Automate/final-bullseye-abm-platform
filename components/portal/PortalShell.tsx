"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconHome,
  IconTargetArrow,
  IconBuildingStore,
  IconReportAnalytics,
  IconUserCircle,
} from "@tabler/icons-react";
import PortalLogoutButton from "./PortalLogoutButton";

type NavItem = { href: string; label: string; icon: typeof IconHome; soon?: boolean };

const NAV: NavItem[] = [
  { href: "/portal",          label: "Inicio",                 icon: IconHome },
  { href: "/portal/icp",      label: "ICP y buyer persona",    icon: IconTargetArrow },
  { href: "/portal/wishlist", label: "Wishlist de empresas",   icon: IconBuildingStore },
  { href: "/portal/reportes", label: "Reportes",               icon: IconReportAnalytics, soon: true },
];

export default function PortalShell({
  clientName,
  clientLogoUrl,
  userEmail,
  children,
}: {
  clientName: string;
  clientLogoUrl: string | null;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/portal" ? pathname === "/portal" : pathname?.startsWith(href));

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ background: "#F7F8FC" }}>
      <header style={{ background: "#251762" }} className="text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-[22px] font-bold tracking-tight leading-none shrink-0">
              <span>Bulls</span>
              <span style={{ color: "#62E0D8" }}>Eye</span>
            </div>
            <span className="text-white/30">·</span>
            {clientLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clientLogoUrl} alt="" className="h-6 w-6 rounded bg-white object-contain shrink-0" />
            ) : null}
            <span className="text-sm font-medium truncate">{clientName}</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/portal/cuenta" className="hidden sm:flex items-center gap-1.5 text-white/70 hover:text-white">
              <IconUserCircle size={16} stroke={1.5} />
              {userEmail}
            </Link>
            <PortalLogoutButton className="text-white/70 hover:text-white" />
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 sm:px-8 flex gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const base = "flex items-center gap-2 px-3 py-2.5 text-[13px] whitespace-nowrap border-b-2";
            if (item.soon) {
              return (
                <span key={item.href} className={`${base} border-transparent text-white/35 cursor-not-allowed`} title="Próximamente">
                  <Icon size={16} stroke={1.5} />
                  {item.label}
                  <span className="text-[9px] uppercase tracking-wide bg-white/10 rounded px-1.5 py-0.5">Pronto</span>
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${base} ${active ? "border-[#62E0D8] text-[#62E0D8]" : "border-transparent text-white/75 hover:text-white"}`}
              >
                <Icon size={16} stroke={1.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">{children}</div>
      </main>

      <footer className="border-t border-gray-200 text-[11px] text-gray-400">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-4 flex justify-between">
          <span>
            Bulls<span style={{ color: "#62E0D8" }}>Eye</span> — Portal de clientes
          </span>
          <span>bullseye-abm.com</span>
        </div>
      </footer>
    </div>
  );
}
