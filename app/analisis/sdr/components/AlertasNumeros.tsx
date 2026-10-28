"use client";

// Franja compacta de "Salud de números" en Análisis SDR: solo los conteos y
// un enlace a la página completa (/analisis/salud-numeros). Lee el reporte
// del día en caché, así que no frena la carga del resto de la página.
// Reglas en lib/phoneHealth/engine.ts.
import Link from "next/link";
import { useEffect, useState } from "react";
import { IconPhone, IconArrowRight, IconLoader2 } from "@tabler/icons-react";

type Counts = { red: number; yellow: number; watch: number; ok: number; low_volume: number };

export default function AlertasNumeros() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/analisis/alertas-numeros")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error);
        if (alive) setCounts(j.counts);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const pill = (n: number, label: string, cls: string) =>
    n > 0 ? (
      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${cls}`}>
        {n} {label}
      </span>
    ) : null;

  return (
    <section id="alertas-numeros" className="flex items-center gap-3 flex-wrap px-4 py-2.5 rounded-lg border bg-white">
      <IconPhone size={18} className="text-ink-muted shrink-0" />
      <span className="text-sm font-semibold">Salud de números</span>
      {!counts && !failed && (
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <IconLoader2 size={14} className="animate-spin" /> Evaluando…
        </span>
      )}
      {failed && <span className="text-xs text-ink-muted">No se pudo cargar el resumen</span>}
      {counts && (
        <>
          {pill(counts.red, "por reemplazar", "bg-red-50 text-red-800")}
          {pill(counts.yellow, "por revisar", "bg-amber-50 text-amber-800")}
          {pill(counts.watch, "vigilar", "bg-indigo-50 text-indigo-800")}
          {pill(counts.ok, counts.ok === 1 ? "sano" : "sanos", "bg-emerald-50 text-emerald-800")}
        </>
      )}
      <span className="flex-1" />
      <Link href="/analisis/salud-numeros" className="flex items-center gap-1 text-sm text-brand hover:underline">
        Ver detalle <IconArrowRight size={14} />
      </Link>
    </section>
  );
}
