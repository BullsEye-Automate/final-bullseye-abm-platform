"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  IconHome,
  IconTargetArrow,
  IconBuildingStore,
  IconUserCircle,
} from "@tabler/icons-react";
import PortalLogoutButton from "./PortalLogoutButton";
import { PARTS, PART_SLUGS } from "@/lib/radarAbm/render";
import { PART_ICONS } from "@/components/radar/partIcons";

// Layout del portal de clientes: barra lateral con el mismo lenguaje del
// sidebar interno de BullsEye (#251762 / #62E0D8). "Mi cuenta" agrupa ICP y
// wishlist; "Radar ABM" lista las vistas del informe (sin el anexo de
// validación de datos, que es solo interno).

type NavItem = { href: string; label: string; icon: typeof IconHome; active: boolean };

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
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const vista = params?.get("vista") ?? PART_SLUGS[0];

  const account: NavItem[] = [
    { href: "/portal", label: "Inicio", icon: IconHome, active: pathname === "/portal" },
    { href: "/portal/icp", label: "ICP y buyer persona", icon: IconTargetArrow, active: pathname.startsWith("/portal/icp") },
    { href: "/portal/wishlist", label: "Wishlist de empresas", icon: IconBuildingStore, active: pathname.startsWith("/portal/wishlist") },
  ];
  const radar: NavItem[] = PARTS.map((p, i) => ({ p, i }))
    .filter(({ p }) => p[0] !== "A")
    .map(({ p, i }) => ({
      href: `/portal/radar?vista=${PART_SLUGS[i]}`,
      label: p[1],
      icon: PART_ICONS[i],
      active: pathname.startsWith("/portal/radar") && vista === PART_SLUGS[i],
    }));

  const item = (it: NavItem) => {
    const Icon = it.icon;
    return (
      <Link key={it.href} href={it.href} className="sb-item whitespace-nowrap" data-active={it.active || undefined}>
        <Icon size={16} stroke={1.5} className="shrink-0" />
        <span className="truncate">{it.label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row" style={{ background: "#F4F2FB" }}>
      <aside
        className="lg:w-[236px] shrink-0 lg:h-screen lg:sticky lg:top-0 overflow-y-auto text-white px-3 py-4 lg:py-5 flex flex-col"
        style={{ background: "#251762" }}
      >
        <div className="px-3 flex items-center justify-between gap-3 lg:block">
          <div>
            <div className="text-[22px] font-bold tracking-tight leading-none">
              <span>Bulls</span>
              <span style={{ color: "#62E0D8" }}>Eye</span>
            </div>
            <div className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>Portal de clientes</div>
          </div>
          <div className="lg:mt-4 flex items-center gap-2 min-w-0 rounded-lg px-2.5 py-2" style={{ background: "rgba(255,255,255,0.07)" }}>
            {clientLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clientLogoUrl} alt="" className="h-6 w-6 rounded bg-white object-contain shrink-0" />
            ) : null}
            <span className="text-[13px] font-medium truncate">{clientName}</span>
          </div>
        </div>

        <nav className="mt-2 lg:flex-1 flex lg:block gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
          <div className="sb-section-label hidden lg:block">Mi cuenta</div>
          {account.map(item)}
          <div className="sb-section-label hidden lg:block">Radar ABM</div>
          {radar.map(item)}
        </nav>

        <div className="hidden lg:block px-1 pt-2 mt-2 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <Link href="/portal/cuenta" className="sb-item" data-active={pathname.startsWith("/portal/cuenta") || undefined} title={userEmail}>
            <IconUserCircle size={16} stroke={1.5} className="shrink-0" />
            <span className="truncate">{userEmail}</span>
          </Link>
          <PortalLogoutButton className="sb-item w-full text-left" />
        </div>
        <div className="lg:hidden flex items-center justify-between px-3 pt-2 text-xs text-white/70">
          <Link href="/portal/cuenta" className="flex items-center gap-1.5 truncate"><IconUserCircle size={15} stroke={1.5} /> {userEmail}</Link>
          <PortalLogoutButton className="text-white/70 hover:text-white" />
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-6 sm:py-8">{children}</div>
        <footer className="border-t border-gray-200 text-[11px] text-gray-400">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-4 flex justify-between">
            <span>
              Bulls<span style={{ color: "#3D2878" }}>Eye</span> — Portal de clientes
            </span>
            <span>bullseye-abm.com</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
