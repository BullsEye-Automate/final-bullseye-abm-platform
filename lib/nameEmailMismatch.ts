function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Heurística laxa: ¿el nombre o el apellido del contacto aparece de alguna
// forma reconocible en la parte local del email? Los emails enriquecidos
// (Lemlist/Clay) a veces devuelven la casilla de OTRA persona de la misma
// empresa (alias genéricos, roles compartidos, matches erróneos del waterfall).
// No es un chequeo estricto — solo marca casos donde NI el nombre NI el
// apellido aparecen, para que el SDR lo revise antes de mandar el mensaje.
export function detectNameEmailMismatch(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined
): { mismatch: boolean; reason?: string } {
  const localPart = email?.split("@")[0];
  if (!localPart) return { mismatch: false };

  const first = normalizeToken(firstName ?? "");
  const last = normalizeToken(lastName ?? "");
  if (!first && !last) return { mismatch: false };

  const local = normalizeToken(localPart);

  const firstMatches = first.length >= 2 && (local.includes(first) || local.includes(first.slice(0, 3)));
  const lastMatches = last.length >= 2 && (local.includes(last) || local.includes(last.slice(0, 3)));

  // Iniciales pegadas (ej. "jsmith" para John Smith)
  const initialsMatch =
    first.length > 0 && last.length > 0 && (local.includes(`${first[0]}${last}`) || local.includes(`${last}${first[0]}`));

  if (firstMatches || lastMatches || initialsMatch) return { mismatch: false };

  return {
    mismatch: true,
    reason: "El email no parece corresponder al nombre del contacto — puede ser de otra persona de la empresa.",
  };
}
