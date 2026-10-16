// País del módulo Células SDR (confirmado con BullsEye):
// - Reuniones: columna "País" de la pestaña API Reuniones (meetings.pais).
// - Llamadas: el código telefónico de país del número de Allo que hizo la
//   llamada (BullsEye compra un número por cliente por país).
// Ambas fuentes se llevan a un mismo nombre canónico para que el filtro de
// país funcione igual en reuniones y en llamadas.
import { normalizeCountryKey, resolveCountryLabel } from "@/lib/sdrAnalytics";

const CANONICAL: Record<string, string> = {
  chile: "Chile", peru: "Perú", colombia: "Colombia", mexico: "México", argentina: "Argentina",
  ecuador: "Ecuador", usa: "USA", "estados unidos": "USA", brazil: "Brasil", brasil: "Brasil",
  guatemala: "Guatemala", "costa rica": "Costa Rica", panama: "Panamá", bolivia: "Bolivia",
  "republica dominicana": "República Dominicana", "el salvador": "El Salvador", uruguay: "Uruguay",
  paraguay: "Paraguay", espana: "España", venezuela: "Venezuela",
};

export function canonicalCountry(label: string | null | undefined): string | null {
  const raw = (label ?? "").trim();
  if (!raw) return null;
  const resolved = resolveCountryLabel(raw); // "CL" → "Chile", etc.
  const key = normalizeCountryKey(resolved);
  return CANONICAL[key] ?? resolved.charAt(0).toUpperCase() + resolved.slice(1);
}

// Prefijos E.164 (de más largo a más corto para que "+593" gane sobre "+5").
const PHONE_PREFIXES: [string, string][] = [
  ["+593", "Ecuador"], ["+591", "Bolivia"], ["+595", "Paraguay"], ["+598", "Uruguay"],
  ["+502", "Guatemala"], ["+503", "El Salvador"], ["+506", "Costa Rica"], ["+507", "Panamá"],
  ["+56", "Chile"], ["+51", "Perú"], ["+57", "Colombia"], ["+52", "México"], ["+54", "Argentina"],
  ["+55", "Brasil"], ["+58", "Venezuela"], ["+34", "España"], ["+1", "USA"],
];

export function countryFromPhone(number: string | null | undefined, fallbackLabel?: string | null): string {
  const n = (number ?? "").replace(/[^\d+]/g, "");
  const withPlus = n.startsWith("+") ? n : `+${n}`;
  for (const [p, c] of PHONE_PREFIXES) if (withPlus.startsWith(p)) return c;
  return canonicalCountry(fallbackLabel) ?? "Sin país";
}
