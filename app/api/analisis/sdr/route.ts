import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Tipos ──────────────────────────────────────────────────────────────────

type SdrMetrics = {
  sdr_id: string;
  sdr_nombre: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
  tasa_conectadas_por_contacto: number;
  tasa_agendada_por_conectada: number;
  tasa_realizacion_reuniones: number;
};

type ResultadosDia = {
  fecha: string;
  llamadas_realizadas: number;
  reuniones_agendadas: number;
  reuniones_realizadas: number;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const MIN_REAL_CONVERSATION_SECONDS = 60;

function isConnected(duration: number, result: string | null): boolean {
  return (result === "ANSWERED" || result === "TRANSFERRED") && duration >= MIN_REAL_CONVERSATION_SECONDS;
}

function getDateRange(rangeKey: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startDate = new Date(today);
  let endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 1);

  switch (rangeKey) {
    case "hoy":
      break;
    case "semana":
      startDate.setDate(startDate.getDate() - startDate.getDay());
      endDate.setDate(endDate.getDate() + (7 - endDate.getDay()));
      break;
    case "mes":
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      break;
    case "trimestre":
      const quarter = Math.floor(today.getMonth() / 3);
      startDate = new Date(today.getFullYear(), quarter * 3, 1);
      endDate = new Date(today.getFullYear(), (quarter + 1) * 3, 1);
      break;
    case "año":
      startDate = new Date(today.getFullYear(), 0, 1);
      endDate = new Date(today.getFullYear() + 1, 0, 1);
      break;
    default:
      break;
  }

  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("client_id");
    const sdrId = request.nextUrl.searchParams.get("sdr_id");
    const rangeKey = request.nextUrl.searchParams.get("rangeKey") || "mes";

    if (!clientId) {
      return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
    }

    const { startDate, endDate } = getDateRange(rangeKey);

    // Obtener reuniones desde Supabase
    let meetingsQuery = supabase
      .from("meetings")
      .select("id, sdr_nombre, fecha_reunion, realizado")
      .eq("client_id", clientId)
      .gte("fecha_reunion", startDate)
      .lt("fecha_reunion", endDate);

    if (sdrId) {
      meetingsQuery = meetingsQuery.eq("sdr_id", sdrId);
    }

    const { data: meetings, error: meetingsError } = await meetingsQuery;

    if (meetingsError) {
      return NextResponse.json({ error: meetingsError.message }, { status: 500 });
    }

    // Agrupar reuniones por SDR
    const meetingsBySDR: Record<
      string,
      { reuniones_agendadas: number; reuniones_realizadas: number }
    > = {};

    for (const meeting of meetings || []) {
      const sdrName = meeting.sdr_nombre || "Sin SDR";
      if (!meetingsBySDR[sdrName]) {
        meetingsBySDR[sdrName] = {
          reuniones_agendadas: 0,
          reuniones_realizadas: 0,
        };
      }
      meetingsBySDR[sdrName].reuniones_agendadas++;
      if (meeting.realizado === "Si") {
        meetingsBySDR[sdrName].reuniones_realizadas++;
      }
    }

    // Obtener SDRs de la tabla users
    let sdrsQuery = supabase.from("users").select("id, name").eq("role", "sdr");

    if (sdrId) {
      sdrsQuery = sdrsQuery.eq("id", sdrId);
    }

    const { data: sdrs, error: sdrsError } = await sdrsQuery;

    if (sdrsError) {
      return NextResponse.json({ error: sdrsError.message }, { status: 500 });
    }

    // Construir datos de SDRs con métricas
    const sdrsData: SdrMetrics[] = (sdrs || []).map((sdr) => {
      const sdrName = sdr.name || sdr.id;
      const meetingData = meetingsBySDR[sdrName] || {
        reuniones_agendadas: 0,
        reuniones_realizadas: 0,
      };

      return {
        sdr_id: sdr.id,
        sdr_nombre: sdrName,
        llamadas_realizadas: 0, // Placeholder - se completará con datos de Allo
        reuniones_agendadas: meetingData.reuniones_agendadas,
        reuniones_realizadas: meetingData.reuniones_realizadas,
        tasa_conectadas_por_contacto: 0,
        tasa_agendada_por_conectada:
          meetingData.reuniones_agendadas > 0
            ? (meetingData.reuniones_realizadas / meetingData.reuniones_agendadas) * 100
            : 0,
        tasa_realizacion_reuniones:
          meetingData.reuniones_agendadas > 0
            ? (meetingData.reuniones_realizadas / meetingData.reuniones_agendadas) * 100
            : 0,
      };
    });

    // Construir datos de resultados por día
    const resultadosPorDia: ResultadosDia[] = [];
    const currentDate = new Date(startDate);
    while (currentDate < new Date(endDate)) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayMeetings = (meetings || []).filter((m) => m.fecha_reunion === dateStr);

      resultadosPorDia.push({
        fecha: dateStr,
        llamadas_realizadas: 0, // Placeholder
        reuniones_agendadas: dayMeetings.length,
        reuniones_realizadas: dayMeetings.filter((m) => m.realizado === "Si").length,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return NextResponse.json({
      sdrs_data: sdrsData,
      resultados_por_dia: resultadosPorDia,
    });
  } catch (err) {
    console.error("Error en /api/analisis/sdr:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Error interno" },
      { status: 500 }
    );
  }
}
