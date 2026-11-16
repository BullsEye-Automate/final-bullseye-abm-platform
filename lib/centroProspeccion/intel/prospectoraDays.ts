import { countryCodeFromName, holidaysOn } from "@/lib/feriados/calendar";
import { readDoc } from "../store";

// Días hábiles de cada prospectora (pedido de BullsEye, 16-nov-2026): sale del
// documento config/feriados del Centro de prospección, el mismo que usan el
// Plan semanal y el recordatorio de los jueves —{ paises: {correo: país},
// feriados: {país: [[fecha, nombre]]}, ausencias: [{email, desde, hasta, motivo}] }—
// y se completa con el calendario legal de la Alerta de feriados
// (lib/feriados/calendar.ts) por si el documento aún no tiene un año cargado.
// Así, editar los feriados o una ausencia en el Centro cambia también cuándo le
// llegan los correos a cada una.

type FeriadosDoc = {
  paises?: Record<string, string>;
  feriados?: Record<string, [string, string][]>;
  ausencias?: { email?: string; desde?: string; hasta?: string; motivo?: string }[];
};

export type ProspectoraCalendar = {
  /** País de la prospectora según el Centro (null si no figura). */
  country(email: string): string | null;
  /** Motivo si ese día no trabaja (feriado de su país o ausencia); null si es hábil para ella. */
  offReason(email: string, day: string): string | null;
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

export async function loadProspectoraCalendar(): Promise<ProspectoraCalendar> {
  const doc = (await readDoc("config", "feriados").catch(() => null))?.data as FeriadosDoc | undefined;
  const paises = new Map(Object.entries(doc?.paises ?? {}).map(([e, p]) => [e.trim().toLowerCase(), String(p)]));
  const byCountry = new Map<string, Map<string, string>>();
  for (const [pais, list] of Object.entries(doc?.feriados ?? {})) {
    const m = new Map<string, string>();
    for (const x of list ?? []) if (Array.isArray(x) && x[0]) m.set(String(x[0]), String(x[1] ?? "Feriado"));
    byCountry.set(norm(pais), m);
  }
  const ausencias = (doc?.ausencias ?? []).filter((a) => a?.email && a.desde);
  return {
    country: (email) => paises.get(email.toLowerCase()) ?? null,
    offReason(email, day) {
      const e = email.toLowerCase();
      for (const a of ausencias) {
        if (String(a.email).toLowerCase() !== e) continue;
        const hasta = a.hasta || a.desde!;
        if (day >= a.desde! && day <= hasta) return `ausencia${a.motivo ? ` (${a.motivo})` : ""}`;
      }
      const pais = paises.get(e);
      if (!pais) return null;
      const manual = byCountry.get(norm(pais))?.get(day);
      if (manual) return `feriado en ${pais}: ${manual}`;
      const code = countryCodeFromName(pais);
      const legal = code ? holidaysOn(day, code).find((h) => h.kind === "national") : null;
      return legal ? `feriado en ${pais}: ${legal.name}` : null;
    },
  };
}
