// Cuentas de cliente del módulo Células SDR.
//
// En la planilla API Reuniones varios clientes comparten el mismo "ID
// Cliente" (ej. Nisum, Nisum Colombia y Nisum Perú; CChC y CChC - Valle), y
// en la app son un solo registro de la tabla clients. Pero en la pestaña
// Asignación tienen metas separadas. Cuando un cliente de la app tiene más
// de un nombre en Asignación, se parte en "cuentas" (id `<cliente>~<nombre>`)
// y cada reunión / llamada se asigna a una:
//   1. por el nombre de la columna "Cliente" de la planilla (meetings.cliente_nombre);
//   2. si el nombre no alcanza (ej. "Nisum" calza con las tres), por país;
//   3. si no, la cuenta principal (la que se llama como el cliente de la app).
// Este archivo no importa nada de servidor: lo usa también el navegador
// (engine.ts) para repartir las llamadas de Allo y las actividades de HubSpot.

export type ClientAccount = {
  id: string;               // `${parent}~${norm}`
  parent: string;           // Client.id de la app
  name: string;             // nombre en Asignación
  norm: string;             // nombre canónico (canonClientName)
  country: string | null;   // país si el nombre lo trae ("Nisum Perú" → Perú)
  isDefault: boolean;
};

// Nombres que difieren más allá de mayúsculas/tildes entre la planilla, la
// pestaña Asignación y la tabla clients (forma canónica a la derecha).
const CLIENT_NAME_EQUIV: Record<string, string> = {
  cchc: "ccch",
  "cchc - valle": "ccch - valle",
};

export function normClientName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

export function canonClientName(s: string): string {
  const n = normClientName(s);
  return CLIENT_NAME_EQUIV[n] ?? n;
}

export function accountId(parent: string, norm: string): string {
  return `${parent}~${norm}`;
}

export function pickAccount(accs: ClientAccount[], name: string | null | undefined, country: string | null | undefined): ClientAccount {
  const def = accs.find((a) => a.isDefault) ?? accs[0];
  let cands = accs;
  if (name && name.trim()) {
    const c = canonClientName(name);
    const exact = accs.find((a) => a.norm === c);
    if (exact) return exact;
    const pref = accs.filter((a) => a.norm.startsWith(c) || c.startsWith(a.norm));
    if (pref.length === 1) return pref[0];
    if (pref.length) cands = pref;
  }
  if (country) {
    const byC = cands.filter((a) => a.country === country);
    if (byC.length === 1) return byC[0];
  }
  return cands.find((a) => a.isDefault) ?? cands.find((a) => !a.country) ?? def;
}
