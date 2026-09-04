"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface EvolucionDia {
  fecha: string;
  porNumero: Record<string, { llamadas: number; conectadas: number }>;
}

export interface NumeroOption {
  numero: string;
  numero_nombre: string;
}

const COLORS = [
  "#62E0D8", "#3B7FD8", "#2B5FD8", "#5B3FB8", "#8B3FA8",
  "#AB47BC", "#BB5FCC", "#CB7FDC", "#DB9FEC", "#EF5350",
  "#FF7F7F", "#FFAF7F", "#FFA726", "#FFBF5F", "#FFCF8F",
];

// fecha es una fecha simple "YYYY-MM-DD" (día calendario de Chile) — se
// ancla a mediodía UTC para no correr el día al formatear en el navegador.
function formatDateShort(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function GraficoSaludTelefonica({
  resultadosPorDia,
  numeros,
}: {
  resultadosPorDia: EvolucionDia[];
  numeros: NumeroOption[];
}) {
  const colorByNumero = useMemo(() => {
    const map = new Map<string, string>();
    numeros.forEach((n, i) => map.set(n.numero, COLORS[i % COLORS.length]));
    return map;
  }, [numeros]);

  const chartData = useMemo(() => {
    return resultadosPorDia.map((dia) => {
      const row: Record<string, number | string | null> = { fecha: dia.fecha };
      for (const n of numeros) {
        const bucket = dia.porNumero[n.numero];
        // Sin llamadas ese día = sin dato (hueco en la línea), no 0% —
        // sino se leería como "se cayó a cero" en vez de "no marcó".
        row[n.numero] = bucket && bucket.llamadas > 0 ? (bucket.conectadas / bucket.llamadas) * 100 : null;
      }
      return row;
    });
  }, [resultadosPorDia, numeros]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="bg-[#251762] border border-[#62E0D8] p-3 rounded-lg shadow-xl text-xs max-w-xs">
        <p className="font-semibold text-white mb-1">{formatDateShort(label)}</p>
        {payload
          .filter((p: any) => p.value !== null && p.value !== undefined)
          .map((p: any) => (
            <p key={p.dataKey} style={{ color: p.color }}>
              {numeros.find((n) => n.numero === p.dataKey)?.numero_nombre || p.dataKey}: {p.value.toFixed(1)}%
            </p>
          ))}
      </div>
    );
  };

  if (numeros.length === 0) {
    return <div className="flex items-center justify-center py-12 text-ink-muted">No hay números para mostrar</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
        <XAxis dataKey="fecha" tickFormatter={formatDateShort} tick={{ fontSize: 12 }} />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 12 }}
          label={{ value: "Tasa de conexión", angle: -90, position: "insideLeft", fontSize: 12 }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value: string) => numeros.find((n) => n.numero === value)?.numero_nombre || value}
          wrapperStyle={{ fontSize: "12px" }}
        />
        {numeros.map((n) => (
          <Line
            key={n.numero}
            type="monotone"
            dataKey={n.numero}
            stroke={colorByNumero.get(n.numero)}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
