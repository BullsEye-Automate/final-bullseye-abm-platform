// Clasifica un teléfono como celular según su formato (Base de contactos).
// Solo celulares (decisión de BullsEye, 25-nov-2026): los fijos y centrales no
// sirven al cambiar la persona de empresa. En Chile, Colombia, Perú y Argentina
// el número dice si es celular; en México no se distingue (queda «posible»).

export type PhoneKind = "mobile" | "maybe" | "other";
export type PhoneClass = { number: string; country: string | null; kind: PhoneKind };

const COUNTRY_HINT: [RegExp, string][] = [
  [/chile|^cl$/i, "Chile"], [/per[uú]|^pe$/i, "Perú"], [/colombia|^co$/i, "Colombia"],
  [/m[eé]xico|^mx$/i, "México"], [/argentina|^ar$/i, "Argentina"],
];

export function countryFromText(t: string | null | undefined): string | null {
  const s = (t ?? "").trim();
  if (!s) return null;
  for (const [re, c] of COUNTRY_HINT) if (re.test(s)) return c;
  return null;
}

export function classifyPhone(raw: string | null | undefined, hint?: string | null): PhoneClass | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length < 8) return null;
  const n = d.length;
  // Con código de país
  if (d.startsWith("56") && n === 11) return { number: `+${d}`, country: "Chile", kind: d[2] === "9" ? "mobile" : "other" };
  if (d.startsWith("57") && n === 12) return { number: `+${d}`, country: "Colombia", kind: d[2] === "3" ? "mobile" : "other" };
  if (d.startsWith("51") && n === 11) return { number: `+${d}`, country: "Perú", kind: d[2] === "9" ? "mobile" : "other" };
  if (d.startsWith("54") && (n === 12 || n === 13)) return { number: `+${d}`, country: "Argentina", kind: d[2] === "9" && n === 13 ? "mobile" : "other" };
  if (d.startsWith("52") && (n === 12 || n === 13)) return { number: `+${d}`, country: "México", kind: "maybe" };
  // Sin código de país: se usa el país del contacto si lo hay
  if (n === 9 && d[0] === "9") {
    const c = hint === "Perú" ? "Perú" : "Chile";
    return { number: `+${c === "Perú" ? "51" : "56"}${d}`, country: c, kind: "mobile" };
  }
  if (n === 10) {
    if (hint === "México") return { number: `+52${d}`, country: "México", kind: "maybe" };
    if (d[0] === "3") return { number: `+57${d}`, country: "Colombia", kind: "mobile" };
  }
  return { number: `+${d}`, country: hint ?? null, kind: "other" };
}

// "+56 9 •••• 1234": para mostrar en pantalla sin exponer el número completo
export function maskPhone(n: string): string {
  const d = n.replace(/\D/g, "");
  return d.length > 4 ? `+${d.slice(0, Math.min(3, d.length - 4))} •••• ${d.slice(-4)}` : "••••";
}
