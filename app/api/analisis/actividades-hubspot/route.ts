import { NextRequest, NextResponse } from "next/server";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { fetchHSOwners, fetchHSActivityCountsByCreator } from "@/lib/hubspot";
import { resolveSdrKey } from "@/lib/sdrAnalytics";

export const dynamic = "force-dynamic";
// Con el espaciado entre requests para no chocar con el rate limit de
// búsqueda de HubSpot (ver throttleHS en lib/hubspot.ts), traer varias
// páginas de emails/communications puede tardar más que el límite default.
export const maxDuration = 90;

// Actividades de Correo/LinkedIn/WhatsApp registradas en HubSpot por cada
// SDR, para sumar como columnas nuevas del Ranking SDR (ver
// app/analisis/sdr/components/TablaRankingSdr.tsx). A diferencia del resto
// del Ranking SDR (que sí filtra por el cliente seleccionado), esto es el
// TOTAL del SDR en todos los clientes — HubSpot todavía no tiene forma de
// saber a qué cliente de BullsEye pertenece cada actividad (confirmado con
// BullsEye: aceptable por ahora).

type ActividadSdr = {
  sdr_key: string;
  sdr_nombre: string;
  email: number;
  linkedin: number;
  whatsapp: number;
};

export async function GET(request: NextRequest) {
  try {
    const rangeKeyRaw = request.nextUrl.searchParams.get("rangeKey") || "this_month";
    const customFromParam = request.nextUrl.searchParams.get("custom_from");
    const customToParam = request.nextUrl.searchParams.get("custom_to");
    const isValidDateParam = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

    const effectiveRangeKey: RangeKey = isValidRangeKey(rangeKeyRaw) ? rangeKeyRaw : "this_month";
    let range = resolveRange(effectiveRangeKey);
    if (effectiveRangeKey === "custom" && isValidDateParam(customFromParam) && isValidDateParam(customToParam)) {
      range = {
        start: new Date(`${customFromParam}T00:00:00.000Z`),
        end: new Date(`${customToParam}T23:59:59.999Z`),
        label: "Fecha personalizada",
        previous: range.previous,
      };
    }

    const [owners, countsByUserId] = await Promise.all([
      fetchHSOwners(),
      fetchHSActivityCountsByCreator(range.start.getTime(), range.end.getTime()),
    ]);

    const bySdrKey = new Map<string, ActividadSdr>();
    for (const owner of owners) {
      if (owner.userId === undefined) continue;
      const counts = countsByUserId.get(String(owner.userId));
      if (!counts) continue;

      const displayName =
        [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() || owner.email || String(owner.userId);
      const key = resolveSdrKey(displayName);
      const existing = bySdrKey.get(key);
      bySdrKey.set(key, {
        sdr_key: key,
        sdr_nombre: existing?.sdr_nombre || displayName,
        email: (existing?.email || 0) + counts.email,
        linkedin: (existing?.linkedin || 0) + counts.linkedin,
        whatsapp: (existing?.whatsapp || 0) + counts.whatsapp,
      });
    }

    return NextResponse.json({ actividades: [...bySdrKey.values()] });
  } catch (err) {
    console.error("Error en /api/analisis/actividades-hubspot:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
