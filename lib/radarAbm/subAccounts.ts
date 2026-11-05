import { canonicalCountry, knownCountry } from "@/lib/celulasSdr/country";

// Pulso ABM — varios clientes dentro de un mismo HubSpot (ej. el HubSpot de
// Nisum: Nisum Chile, Nisum Colombia, Nisum Perú y KI Technologies). Cada uno
// tiene sus propiedades "Status de la asignación - <nombre>", "SDR - <nombre>"…
// y su propio informe; el cliente de la app los ve en uno solo con un selector.
// Se configuran en Configuración → Cliente → Pulso ABM (properties.subAccounts).

export function parseSubs(raw: string | null | undefined): string[] {
  return Array.from(new Set((raw ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))).slice(0, 12);
}

const compact = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// País que nombra la cuenta ("Nisum Perú" → "Perú"); null si no nombra ninguno
export function subCountry(sub: string): string | null {
  const words = sub.trim().split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const c = knownCountry(words.slice(i).join(" "));
    if (c) return c;
  }
  return null;
}

// Cuenta a la que corresponde un registro según su nombre de cliente (columna
// "Cliente" de la planilla) y su país. Nombre igual > uno contiene al otro;
// empate (ej. "Nisum" frente a Chile / Colombia / Perú) se decide por el país.
// Sin nombre, solo por el país. null = no se puede asignar.
export function pickSub(subs: string[], name: string | null | undefined, country: string | null | undefined): string | null {
  const n = compact(name);
  const ctry = canonicalCountry(country ?? "") ?? null;
  const byCountry = (list: string[], allowPlain: boolean) => {
    if (!ctry) return list.length === 1 ? list[0] : null;
    const hit = list.filter((s) => subCountry(s) === ctry);
    if (hit.length === 1) return hit[0];
    // Cuenta sin país en el nombre dentro del empate (ej. "Nisum" a secas)
    const plain = list.filter((s) => !subCountry(s));
    return allowPlain && hit.length === 0 && plain.length === 1 ? plain[0] : null;
  };
  if (n) {
    const exact = subs.filter((s) => compact(s) === n);
    if (exact.length === 1) return exact[0];
    const partial = subs.filter((s) => { const c = compact(s); return c.length >= 3 && (c.startsWith(n) || n.startsWith(c)); });
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) return byCountry(partial, true);
    return null;
  }
  // Sin nombre (ej. llamadas de Allo, solo con el país del número): solo una
  // cuenta que nombre ese país
  return byCountry(subs, false);
}

export const subSlug = (sub: string) => compact(sub) || "cuenta";
