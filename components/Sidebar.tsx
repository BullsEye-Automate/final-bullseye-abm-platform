"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import {
  IconLayoutDashboard,
  IconBuildingFactory2,
  IconUsers,
  IconMail,
  IconPhone,
  IconHeadset,
  IconMessage2,
  IconReportAnalytics,
  IconBrain,
  IconSettings,
  IconBuilding,
  IconChevronDown,
  IconCheck,
  IconPlus,
  IconAdjustments,
  IconMapSearch,
  IconStethoscope,
  IconLoader2,
  IconMessageStar,
  IconChartBar
} from "@tabler/icons-react";
import { useClient, ALL_CLIENTS } from "@/lib/clientContext";
import { useGeneration } from "@/lib/generationContext";

type Item = { href: string; label: string; icon: any; disabled?: boolean };
type Section = { label: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    label: "Prospección",
    items: [
      { href: "/dashboard",       label: "Dashboard",       icon: IconLayoutDashboard },
      { href: "/empresas",        label: "Empresas",        icon: IconBuildingFactory2 },
      { href: "/contactos",       label: "Contactos",       icon: IconUsers },
      { href: "/sales-navigator", label: "Sales Navigator", icon: IconMapSearch }
    ]
  },
  {
    label: "Outreach",
    items: [
      { href: "/campanas",        label: "Campañas",        icon: IconMail  },
      { href: "/entrenar-modelo", label: "Entrenar modelo", icon: IconBrain },
    ]
  },
  {
    label: "SDR",
    items: [
      { href: "/telefonos",  label: "Teléfonos",  icon: IconPhone },
      { href: "/llamadas",   label: "Llamadas",   icon: IconHeadset },
      { href: "/respuestas", label: "Respuestas", icon: IconMessage2 }
    ]
  },
  {
    label: "Oportunidades",
    items: [
      { href: "/oportunidades/feedback",   label: "Feedback",    icon: IconMessageStar },
      { href: "/oportunidades/resultados", label: "Resultados",  icon: IconChartBar },
    ]
  },
  {
    label: "Análisis",
    items: [
      { href: "/reporteria",          label: "Reportería",          icon: IconReportAnalytics },
      { href: "/diagnostico-empresa", label: "Diagnóstico empresa", icon: IconStethoscope }
    ]
  },
  {
    label: "Sistema",
    items: [
      { href: "/clientes",                label: "Clientes",         icon: IconBuilding },
      { href: "/configuracion/cliente",   label: "Config. cliente",  icon: IconAdjustments },
      { href: "/configuracion/icp",       label: "ICP",              icon: IconSettings }
    ]
  }
];

function ClientSelector() {
  const { clients, currentClient, setCurrentClient, loading } = useClient();
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const ref      = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleOpen() {
    setOpen((v) => {
      if (!v) setTimeout(() => inputRef.current?.focus(), 50);
      else setQuery("");
      return !v;
    });
  }

  const filtered = query.trim()
    ? clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : clients;

  return (
    <div ref={ref} className="relative px-3 mb-5">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition"
        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.9)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <IconBuilding size={14} className="shrink-0" style={{ color: "#62E0D8" }} />
          <span className="truncate text-[12px]">
            {loading ? "Cargando..." : (currentClient?.name ?? "Seleccionar cliente")}
          </span>
        </div>
        <IconChevronDown
          size={13}
          className="shrink-0 transition-transform"
          style={{ opacity: 0.5, transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 top-full mt-1 rounded-lg py-1 z-50"
          style={{
            background: "#160e3a",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)"
          }}
        >
          {/* Buscador */}
          <div className="px-2 pt-1 pb-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-full rounded-md px-2.5 py-1.5 text-[12px] outline-none"
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.9)",
                border: "1px solid rgba(255,255,255,0.12)"
              }}
            />
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} className="mt-1">
            {/* Opción "Todos los clientes" */}
            {!query.trim() && (
              <button
                onClick={() => { setCurrentClient(ALL_CLIENTS); setOpen(false); setQuery(""); }}
                className="w-full flex items-center justify-between px-3 py-2 text-[12px] text-left transition hover:bg-white/10"
                style={{ color: currentClient?.id === ALL_CLIENTS.id ? "#62E0D8" : "rgba(255,255,255,0.6)" }}
              >
                <span className="flex items-center gap-1.5">
                  <span style={{ fontSize: 10, opacity: 0.7 }}>◈</span> Todos los clientes
                </span>
                {currentClient?.id === ALL_CLIENTS.id && <IconCheck size={13} className="shrink-0" />}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                {clients.length === 0 ? "Sin clientes aún" : "Sin resultados"}
              </p>
            ) : (
              filtered.map((c) => {
                const active = currentClient?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => { setCurrentClient(c); setOpen(false); setQuery(""); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-[12px] text-left transition hover:bg-white/10"
                    style={{ color: active ? "#62E0D8" : "rgba(255,255,255,0.8)" }}
                  >
                    <span className="truncate">{c.name}</span>
                    {active && <IconCheck size={13} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-1 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <Link
              href="/clientes"
              onClick={() => { setOpen(false); setQuery(""); }}
              className="flex items-center gap-1.5 px-3 py-2 text-[11px] transition hover:bg-white/10"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              <IconPlus size={12} />
              Gestionar clientes
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { isGenerating, genProgress, contacts } = useGeneration();

  return (
    <aside
      className="w-[230px] shrink-0 h-screen overflow-y-auto text-white px-3 py-5 sticky top-0 flex flex-col"
      style={{ background: "#251762" }}
    >
      {/* Logo */}
      <div className="px-3 mb-5">
        <div className="text-[22px] font-bold tracking-tight leading-none">
          <span style={{ color: "#fff" }}>Bulls</span>
          <span style={{ color: "#62E0D8" }}>Eye</span>
        </div>
        <div className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          B2B Prospecting Platform
        </div>
      </div>

      {/* Selector de cliente */}
      <ClientSelector />

      {/* Navegación */}
      <nav className="flex-1">
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
                    className="sb-item opacity-40 cursor-not-allowed"
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

      {/* Indicador flotante de generación en progreso */}
      {isGenerating && (
        <div className="px-3 pb-2">
          <Link
            href="/campanas/subir"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition hover:opacity-90"
            style={{
              background: "rgba(98,224,216,0.15)",
              color: "#62E0D8",
              border: "1px solid rgba(98,224,216,0.25)",
            }}
          >
            <IconLoader2 size={13} className="animate-spin shrink-0" />
            <span className="truncate">
              Generando mensajes… {genProgress}/{contacts.length}
            </span>
          </Link>
        </div>
      )}
    </aside>
  );
}
