"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconBuildingFactory2,
  IconUsers,
  IconCompass,
  IconMail,
  IconPhone,
  IconPhoneCall,
  IconMessage2,
  IconChartFunnel,
  IconReportAnalytics,
  IconBrain,
  IconSettings
} from "@tabler/icons-react";

type Item = { href: string; label: string; icon: any; disabled?: boolean };
type Section = { label: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    label: "Prospección",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
      { href: "/empresas",  label: "Empresas",  icon: IconBuildingFactory2 },
      { href: "/contactos", label: "Contactos", icon: IconUsers },
      { href: "/sales-navigator", label: "Sales Navigator", icon: IconCompass }
    ]
  },
  {
    label: "Outreach",
    items: [
      { href: "/campanas", label: "Campañas", icon: IconMail }
    ]
  },
  {
    label: "SDR",
    items: [
      { href: "/telefonos",  label: "Teléfonos",  icon: IconPhone },
      { href: "/llamadas",   label: "Llamadas",   icon: IconPhoneCall },
      { href: "/respuestas", label: "Respuestas", icon: IconMessage2 }
    ]
  },
  {
    label: "Ventas",
    items: [
      { href: "/funnel", label: "Funnel", icon: IconChartFunnel, disabled: true }
    ]
  },
  {
    label: "Análisis",
    items: [
      { href: "/reporteria",      label: "Reportería",      icon: IconReportAnalytics },
      { href: "/entrenar-modelo", label: "Entrenar modelo", icon: IconBrain }
    ]
  },
  {
    label: "Sistema",
    items: [
      { href: "/configuracion/icp", label: "Configuración", icon: IconSettings }
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      className="w-[230px] shrink-0 min-h-screen text-white px-3 py-5 sticky top-0"
      style={{ background: "#26215C" }}
    >
      <div className="px-3 mb-6">
        <div className="flex items-center gap-1 text-[20px] font-semibold tracking-tight leading-none">
          <span style={{ color: "rgba(255,255,255,0.9)" }}>we</span>
          <span
            style={{
              color: "#26215C",
              background: "#fff",
              padding: "1px 6px",
              borderRadius: 5
            }}
          >
            CAD
          </span>
          <span style={{ color: "rgba(255,255,255,0.9)" }}>4you</span>
        </div>
        <div className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          by SOi Digital
        </div>
      </div>

      <nav>
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="sb-section-label">{section.label}</div>
            {section.items.map((item) => {
              const active = pathname?.startsWith(item.href);
              const Icon = item.icon;
              if (item.disabled) {
                return (
                  <div
                    key={item.href}
                    className="sb-item opacity-60 cursor-not-allowed"
                    title="Próximamente"
                  >
                    <Icon size={16} stroke={1.5} />
                    <span>{item.label}</span>
                  </div>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="sb-item"
                  data-active={active || undefined}
                >
                  <Icon size={16} stroke={1.5} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
