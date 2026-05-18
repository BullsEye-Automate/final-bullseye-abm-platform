// Detección de "name/email mismatch": cuando un contacto tiene email
// enriquecido por Lemlist (u otra fuente) pero el local-part del email no
// matchea el nombre del contacto. Síntoma típico del bug de enrichment de
// Lemlist donde un lead de Sales Nav termina con email/foto de otra persona
// (mismo rol + empresa) por una mala desambiguación de la API.
//
// Heurística laxa — busca que el local-part contenga el first_name (≥3
// chars), el last_name (≥3 chars), o combinaciones típicas (initial + last,
// first + initial). Si nada matchea, devolvemos mismatch=true. Falsos
// positivos esperados: emails genéricos (info@, sales@) y nicknames
// (Bob para Robert). En esos casos el SDR confirma a mano.

export type NameEmailMismatch = {
  mismatch: boolean;
  reason?: string;
};

export function detectNameEmailMismatch(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined
): NameEmailMismatch {
  if (!email) return { mismatch: false };
  if (!firstName && !lastName) return { mismatch: false };

  const at = email.indexOf("@");
  if (at < 1) return { mismatch: false };

  const localRaw = email.slice(0, at).toLowerCase();
  // Cortar antes de "+" (sufijo de tag de Gmail), normalizar a alphanumeric.
  const local = localRaw.split("+")[0].replace(/[^a-z0-9]/g, "");
  if (local.length < 3) return { mismatch: false };

  const norm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const fn = norm(firstName);
  const ln = norm(lastName);

  if (fn.length >= 3 && local.includes(fn)) return { mismatch: false };
  if (ln.length >= 3 && local.includes(ln)) return { mismatch: false };
  // "jsmith" para John Smith.
  if (fn.length >= 1 && ln.length >= 3 && local.includes(fn[0] + ln)) {
    return { mismatch: false };
  }
  // "johns" para John Smith.
  if (fn.length >= 3 && ln.length >= 1 && local.includes(fn + ln[0])) {
    return { mismatch: false };
  }
  // Primeros 3 chars del first (cubre apocopes tipo "alex" → "alexander").
  if (fn.length >= 3 && local.includes(fn.slice(0, 3))) {
    return { mismatch: false };
  }
  // Primeros 3 chars del last (cubre "fer" → "fernandez").
  if (ln.length >= 3 && local.includes(ln.slice(0, 3))) {
    return { mismatch: false };
  }

  const display = [firstName, lastName].filter(Boolean).join(" ").trim();
  return {
    mismatch: true,
    reason: `Email "${email}" no contiene el nombre "${display}".`
  };
}
