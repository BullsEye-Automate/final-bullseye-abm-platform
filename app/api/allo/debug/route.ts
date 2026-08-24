import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Diagnóstico temporal para el 401 de Allo: prueba distintos formatos de
// autenticación contra /v2/api/me usando la ALLO_API_KEY ya seteada en este
// ambiente, sin exponer la key completa. Borrar este endpoint una vez
// resuelto el problema de autenticación.
export async function GET() {
  const key = process.env.ALLO_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ALLO_API_KEY no está seteada en este ambiente" });
  }

  const trimmed = key.trim();
  const keyInfo = {
    length: key.length,
    trimmed_length: trimmed.length,
    has_surrounding_whitespace: key !== trimmed,
    starts_with: key.slice(0, 4),
    ends_with: key.slice(-4),
  };

  const variants: { label: string; headers: Record<string, string> }[] = [
    { label: "Authorization: Bearer <key>", headers: { Authorization: `Bearer ${trimmed}` } },
    { label: "Authorization: <key> (sin Bearer)", headers: { Authorization: trimmed } },
    { label: "X-Api-Key: <key>", headers: { "X-Api-Key": trimmed } },
    { label: "Api-Key: <key>", headers: { "Api-Key": trimmed } },
  ];

  const results = await Promise.all(
    variants.map(async (v) => {
      try {
        const res = await fetch("https://api.withallo.com/v2/api/me", {
          headers: v.headers,
          cache: "no-store",
        });
        const bodySnippet = (await res.text().catch(() => "")).slice(0, 300);
        return { variant: v.label, status: res.status, ok: res.ok, bodySnippet };
      } catch (e: any) {
        return { variant: v.label, status: null, ok: false, error: e.message };
      }
    })
  );

  return NextResponse.json({ key_info: keyInfo, results });
}
