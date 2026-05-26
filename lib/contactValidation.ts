// Validación de contactos: detecta inconsistencias entre nombre y email.

export type NameEmailMismatchResult = {
  mismatch: boolean;
  reason?: string;
};

/**
 * Detecta si el email de un contacto no corresponde a su nombre.
 * Heurística simple: verifica que al menos uno de los tokens del nombre
 * (first_name o last_name) aparezca en la parte local del email.
 */
export function detectNameEmailMismatch(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined
): NameEmailMismatchResult {
  if (!email) return { mismatch: false };

  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (!localPart) return { mismatch: false };

  // Emails genéricos — no son personales, no tiene sentido validar
  const genericPrefixes = [
    "info", "contact", "hello", "hola", "sales", "admin", "support",
    "office", "team", "noreply", "no-reply", "mail", "marketing",
    "ventas", "comercial", "contacto"
  ];
  if (genericPrefixes.some((p) => localPart.startsWith(p))) {
    return { mismatch: false };
  }

  const tokens = [firstName, lastName]
    .filter(Boolean)
    .map((s) => s!.toLowerCase().replace(/[^a-z0-9]/g, ""));

  if (tokens.length === 0) return { mismatch: false };

  const normalizedLocal = localPart.replace(/[^a-z0-9]/g, "");

  // Si algún token del nombre aparece en la parte local, no hay mismatch
  const anyMatch = tokens.some(
    (t) => t.length >= 2 && normalizedLocal.includes(t)
  );

  if (anyMatch) return { mismatch: false };

  return {
    mismatch: true,
    reason: `El email "${email}" no parece corresponder a "${[firstName, lastName].filter(Boolean).join(" ")}"`,
  };
}
