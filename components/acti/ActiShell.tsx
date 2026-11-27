"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import PortalLogoutButton from "@/components/portal/PortalLogoutButton";
import { ACTI_MODULES } from "@/lib/acti/nav";
import { PULSO_VIEW_OPTIONS } from "@/lib/acti/plans";

// Estructura de la experiencia ACTI: menú lateral con la marca
// "ACTI · Red de Negocios" + "Operado por BullsEye" (logo original de
// BullsEye) y barra superior con el socio y su plan.

export default function ActiShell({
  clientName,
  userEmail,
  planName,
  pulsoViews,
  children,
}: {
  clientName: string;
  userEmail: string;
  planName: string;
  pulsoViews: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const vista = params?.get("vista") ?? "";
  const pulso = PULSO_VIEW_OPTIONS.filter((v) => pulsoViews.includes(v.slug));
  const initials = clientName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  return (
    <div className="acti-app">
      <aside className="acti-side">
        <div className="acti-brand">
          {/* Espacio reservado para el logo de ACTI (pendiente) */}
          <div className="acti-logo-slot" aria-hidden="true">Logo ACTI</div>
          <div className="acti-name">
            ACTI<span>Red de Negocios</span>
          </div>
          <div className="acti-pw">
            Operado por
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bullseye-logo-white.png" alt="BullsEye" />
          </div>
          <div className="acti-client" title={clientName}>{clientName}</div>
        </div>

        <nav className="acti-menu" aria-label="Menú ACTI">
          {ACTI_MODULES.map((m) => {
            const active = m.slug === "" ? pathname === "/acti" : pathname.startsWith(m.href);
            return (
              <Link key={m.href} href={m.href} className="acti-nav" data-active={active || undefined}>
                <span>{m.label}</span>
                {!m.ready && <span className="acti-soon">Pronto</span>}
              </Link>
            );
          })}
          {pulso.length > 0 && <div className="acti-menu-label">Pulso ABM</div>}
          {pulso.map((v) => (
            <Link
              key={v.slug}
              href={`/acti/pulso?vista=${v.slug}`}
              className="acti-nav"
              data-active={(pathname.startsWith("/acti/pulso") && vista === v.slug) || undefined}
            >
              <span>{v.label}</span>
              <span className="acti-soon">Pronto</span>
            </Link>
          ))}
        </nav>

        <div className="acti-foot">
          <Link href="/acti/cuenta" title={userEmail}>{userEmail}</Link>
          <PortalLogoutButton className="acti-logout" />
        </div>
      </aside>

      <div className="acti-main">
        <header className="acti-top">
          <div className="acti-who">
            <div className="acti-av" aria-hidden="true">{initials || "A"}</div>
            <div>
              <b>{clientName}</b>
              <small>Socio ACTI</small>
            </div>
          </div>
          <span className="acti-plan-tag">Plan {planName}</span>
        </header>
        <main className="acti-content">{children}</main>
        <footer className="acti-footer">
          <span>ACTI · Red de Negocios — Operado por BullsEye</span>
          <span>bullseye-abm.com</span>
        </footer>
      </div>
    </div>
  );
}
