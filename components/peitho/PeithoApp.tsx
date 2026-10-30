"use client";

// Vista de Peitho para un cliente que lo tiene contratado. Aquí se mostrará
// la app Peitho con el feedback automático de las reuniones (integración
// pendiente).
export default function PeithoApp({ clientName }: { clientName: string | null }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 text-center py-14 px-6">
      <img src="/peitho/logo.png" alt="Peitho" className="mx-auto h-28 w-auto" />
      <h2 className="text-lg font-semibold mt-4" style={{ color: "#160B52" }}>
        Peitho activo{clientName ? ` para ${clientName}` : ""}
      </h2>
      <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
        Aquí verás el análisis y feedback automático de cada reunión: preparación, desempeño, objeciones, compromisos y fit con el ICP.
        La conexión con Peitho está en desarrollo.
      </p>
    </div>
  );
}
